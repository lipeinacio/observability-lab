const fs = require("node:fs");
const path = require("node:path");
const { triggers } = require("./zabbix-resources");

const appUrl = process.env.APP_URL || "http://127.0.0.1:18080";
const zabbixUrl =
  process.env.ZABBIX_URL || "http://127.0.0.1:8080/api_jsonrpc.php";
const prometheusUrl =
  process.env.PROMETHEUS_URL || "http://127.0.0.1:9090";
const outputDir =
  process.env.INCIDENT_OUTPUT_DIR ||
  path.join(__dirname, "..", "incidents", "generated");

const ACKNOWLEDGE = 2;
const ADD_MESSAGE = 4;
const databaseTrigger = triggers.databaseUnavailable.description;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString();
}

function localTimestamp(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function incidentId(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Sao_Paulo",
  })
    .formatToParts(new Date(value))
    .reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `INC-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}-DBA`;
}

function summarizeBody(endpoint, body) {
  if (endpoint === "/api/orders" && Array.isArray(body?.orders)) {
    return { orders_count: body.orders.length };
  }
  return body;
}

async function zabbixApi(method, params, auth) {
  const response = await fetch(zabbixUrl, {
    method: "POST",
    headers: { "content-type": "application/json-rpc" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: 1,
      ...(auth ? { auth } : {}),
    }),
  });
  const body = await response.json();
  if (body.error) {
    throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  }
  return body.result;
}

async function setMode(mode) {
  const response = await fetch(`${appUrl}/api/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error(`Não foi possível ativar ${mode}`);
}

async function inspectEndpoint(endpoint) {
  const startedAt = Date.now();
  const response = await fetch(`${appUrl}${endpoint}`);
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return {
    endpoint,
    status: response.status,
    duration_ms: Date.now() - startedAt,
    request_id: response.headers.get("x-request-id"),
    body: summarizeBody(endpoint, body),
  };
}

async function prometheusQuery(query) {
  const params = new URLSearchParams({ query });
  const response = await fetch(`${prometheusUrl}/api/v1/query?${params}`);
  if (!response.ok) {
    throw new Error(`Prometheus respondeu HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.data.result.map((entry) => ({
    metric: entry.metric,
    value: Number(entry.value[1]),
  }));
}

async function waitForMetric(query, predicate, timeoutSeconds = 20) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const result = await prometheusQuery(query);
    if (result.length && predicate(result[0].value)) return result;
    await sleep(1000);
  }
  throw new Error(`Métrica não atingiu o valor esperado: ${query}`);
}

function requireStatus(entries, endpoint, expected) {
  const entry = entries.find((candidate) => candidate.endpoint === endpoint);
  if (!entry || entry.status !== expected) {
    throw new Error(
      `${endpoint}: esperava HTTP ${expected}, recebeu ${entry?.status || "sem resposta"}`,
    );
  }
}

async function findTrigger(auth) {
  const result = await zabbixApi("trigger.get", {
    filter: { description: databaseTrigger },
    output: ["triggerid", "description", "priority", "comments", "url"],
    selectTags: "extend",
  }, auth);
  if (!result.length) throw new Error(`Trigger não encontrada: ${databaseTrigger}`);
  return result[0];
}

async function findActiveProblem(auth, triggerId) {
  const problems = await zabbixApi("problem.get", {
    objectids: [triggerId],
    output: ["eventid", "name", "clock", "severity", "acknowledged", "opdata"],
    selectTags: "extend",
    recent: false,
  }, auth);
  return problems[0];
}

async function waitForProblem(auth, triggerId, timeoutSeconds = 60) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const problem = await findActiveProblem(auth, triggerId);
    if (problem) return problem;
    await sleep(2000);
  }
  throw new Error(`Problema não abriu em ${timeoutSeconds}s`);
}

async function waitForRecovery(auth, triggerId, timeoutSeconds = 60) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (!(await findActiveProblem(auth, triggerId))) return;
    await sleep(2000);
  }
  throw new Error(`Problema não recuperou em ${timeoutSeconds}s`);
}

async function updateEvent(auth, eventId, message, acknowledge = false) {
  await zabbixApi("event.acknowledge", {
    eventids: [eventId],
    action: ADD_MESSAGE | (acknowledge ? ACKNOWLEDGE : 0),
    message,
  }, auth);
}

async function eventDetails(auth, eventId) {
  const events = await zabbixApi("event.get", {
    eventids: [eventId],
    output: ["eventid", "name", "clock", "r_eventid", "severity", "acknowledged"],
    selectAcknowledges: ["clock", "message", "action", "username"],
    selectTags: "extend",
  }, auth);
  return events[0];
}

function addTimeline(timeline, action, result) {
  timeline.push({ at: timestamp(), action, result });
}

function markdown(report) {
  const endpointTable = report.evidence.endpoints
    .map(
      (entry) =>
        `| \`${entry.endpoint}\` | ${entry.status} | ${entry.duration_ms} ms | \`${entry.request_id || "-"}\` |`,
    )
    .join("\n");
  const recoveryTable = report.recovery.endpoints
    .map(
      (entry) =>
        `| \`${entry.endpoint}\` | ${entry.status} | ${entry.duration_ms} ms |`,
    )
    .join("\n");
  const timeline = report.timeline
    .map(
      (entry) =>
        `| ${localTimestamp(entry.at)} | ${entry.action} | ${entry.result} |`,
    )
    .join("\n");
  const updates = report.zabbix.event.acknowledges
    .map(
      (entry) =>
        `- ${localTimestamp(Number(entry.clock) * 1000)} — ${entry.message}`,
    )
    .join("\n");

  return `# ${report.id} — Banco de pedidos indisponível

> Exercício simulado em laboratório. Nenhuma equipe corporativa real foi
> acionada.

## Identificação

- severidade: alta;
- início: ${localTimestamp(report.started_at)};
- recuperação: ${localTimestamp(report.recovered_at)};
- host: \`APP-LAB-ORDERS\`;
- serviço: \`orders-api\`;
- problema no Zabbix: \`${report.zabbix.problem.name}\`;
- event ID: \`${report.zabbix.problem.eventid}\`;
- responsável: Observabilidade Lab.

## Impacto confirmado

Usuários não conseguem consultar nem criar pedidos. O processo da aplicação
permanece vivo, mas readiness e função de negócio falham porque a dependência
MySQL está indisponível.

## Timeline

| Horário | Fato, decisão ou ação | Resultado |
|---|---|---|
${timeline}

## Evidências

| Endpoint | HTTP | Duração | Request ID |
|---|---:|---:|---|
${endpointTable}

Métricas Prometheus:

\`\`\`json
${JSON.stringify(report.evidence.metrics, null, 2)}
\`\`\`

## Hipótese

A aplicação está viva e acessível, mas perdeu conexão com o MySQL de pedidos.
A causa provável pertence à camada de banco, não ao processo HTTP.

## Escalonamento simulado para DBA

\`\`\`text
${report.escalation.message}
\`\`\`

## Atualizações registradas no Zabbix

${updates}

## Recuperação

A ação simulada do DBA foi restaurar a disponibilidade da dependência no
controle do laboratório.

| Endpoint | HTTP | Duração |
|---|---:|---:|
${recoveryTable}

O problema recuperou automaticamente no Zabbix. Não houve fechamento manual.

Métricas após recuperação:

\`\`\`json
${JSON.stringify(report.recovery.metrics, null, 2)}
\`\`\`

## Comunicação

### Inicial

\`\`\`text
${report.communication.initial}
\`\`\`

### Atualização

\`\`\`text
${report.communication.update}
\`\`\`

### Encerramento

\`\`\`text
${report.communication.resolved}
\`\`\`

## Melhoria proposta

Manter a coleta do health check do banco em intervalo menor que os sintomas da
API e preservar a correlação por código HTTP, evitando múltiplos problemas
para uma única causa.
`;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const timeline = [];
  await setMode("healthy");

  const auth = await zabbixApi("user.login", {
    username: "Admin",
    password: "zabbix",
  });
  const trigger = await findTrigger(auth);
  const startedAt = timestamp();
  const id = incidentId(startedAt);

  addTimeline(timeline, "Falha controlada ativada", "Modo db-unavailable");
  await setMode("db-unavailable");

  const problem = await waitForProblem(auth, trigger.triggerid);
  addTimeline(
    timeline,
    "Problema detectado no Zabbix",
    `${problem.name}, eventid ${problem.eventid}`,
  );

  const initialMessage =
    "Triagem iniciada. Impacto em validação. Verificando função de negócio, processo e dependência MySQL.";
  await updateEvent(auth, problem.eventid, initialMessage, true);
  addTimeline(timeline, "Problema reconhecido", initialMessage);

  const endpoints = await Promise.all([
    inspectEndpoint("/health/live"),
    inspectEndpoint("/health/ready"),
    inspectEndpoint("/health/db"),
    inspectEndpoint("/api/orders"),
  ]);
  requireStatus(endpoints, "/health/live", 200);
  requireStatus(endpoints, "/health/ready", 503);
  requireStatus(endpoints, "/health/db", 503);
  requireStatus(endpoints, "/api/orders", 503);
  const metrics = {
    database_available: await waitForMetric(
      "lab_db_available",
      (value) => value === 0,
    ),
    database_errors_total: await prometheusQuery("lab_db_errors_total"),
    process_up: await waitForMetric(
      'up{job="observability-lab"}',
      (value) => value === 1,
    ),
  };
  addTimeline(
    timeline,
    "Impacto confirmado",
    "Processo vivo; readiness, banco e pedidos indisponíveis",
  );

  const escalationMessage = [
    `[SIMULAÇÃO] ${id}`,
    `Severidade: alta`,
    `Início: ${localTimestamp(startedAt)}`,
    "Host/serviço: APP-LAB-ORDERS / orders-api",
    "Impacto: usuários não conseguem consultar ou criar pedidos.",
    "Sintoma: /health/live=200; /health/ready=503; /health/db=503; /api/orders=503.",
    "Evidências: Zabbix indica camada database e escalation=dba; lab_db_available=0.",
    "Testes executados: processo, readiness, health do banco, API e métricas.",
    "Hipótese: conexão da aplicação com o MySQL de pedidos indisponível.",
    "Ação solicitada: validar instância business-db e conexões na porta 3306.",
    "Contato: operador do Observability Lab.",
  ].join("\n");
  const updateMessage =
    "Fato: processo e endpoint HTTP permanecem ativos; /health/db e /api/orders retornam 503. Interpretação: falha isolada na dependência MySQL. Ação: escalonamento simulado para DBA com evidências.";
  await updateEvent(auth, problem.eventid, updateMessage);
  addTimeline(timeline, "Escalonamento simulado para DBA", updateMessage);

  await sleep(2000);
  await setMode("healthy");
  addTimeline(
    timeline,
    "Ação simulada do DBA",
    "Disponibilidade da dependência restaurada",
  );
  await waitForRecovery(auth, trigger.triggerid);

  const recoveryEndpoints = await Promise.all([
    inspectEndpoint("/health/live"),
    inspectEndpoint("/health/ready"),
    inspectEndpoint("/health/db"),
    inspectEndpoint("/api/orders"),
  ]);
  requireStatus(recoveryEndpoints, "/health/live", 200);
  requireStatus(recoveryEndpoints, "/health/ready", 200);
  requireStatus(recoveryEndpoints, "/health/db", 200);
  requireStatus(recoveryEndpoints, "/api/orders", 200);
  const recoveryMetrics = {
    database_available: await waitForMetric(
      "lab_db_available",
      (value) => value === 1,
    ),
    process_up: await waitForMetric(
      'up{job="observability-lab"}',
      (value) => value === 1,
    ),
  };
  const recoveredAt = timestamp();
  addTimeline(
    timeline,
    "Recuperação validada",
    "Zabbix recuperado e endpoints críticos em HTTP 200",
  );

  const event = await eventDetails(auth, problem.eventid);
  if (event.acknowledged !== "1" || event.acknowledges.length < 2) {
    throw new Error("Reconhecimento e atualizações não foram registrados no Zabbix");
  }
  const communication = {
    initial: `[INCIDENTE EM ANÁLISE]\nInício: ${localTimestamp(startedAt)}\nServiço: orders-api\nImpacto confirmado: consultas e criação de pedidos indisponíveis.\nAlerta: ${problem.name}\nAções: validação de aplicação e dependência em andamento.\nResponsável: Observabilidade Lab.`,
    update: `[ATUALIZAÇÃO]\nEstado: aplicação viva com dependência MySQL indisponível.\nEvidências: live=200, ready=503, db=503, orders=503, lab_db_available=0.\nAção: escalonamento simulado para DBA.\nRisco: indisponibilidade total do fluxo de pedidos.`,
    resolved: `[INCIDENTE RESOLVIDO]\nInício: ${localTimestamp(startedAt)}\nRecuperação: ${localTimestamp(recoveredAt)}\nImpacto: consultas e criação de pedidos indisponíveis durante o exercício.\nCausa: indisponibilidade controlada da conexão com o MySQL.\nValidação: Zabbix recuperado e endpoints críticos em HTTP 200.\nPendência: manter correlação e runbook atualizados.`,
  };

  const report = {
    id,
    simulated: true,
    started_at: startedAt,
    recovered_at: recoveredAt,
    zabbix: { trigger, problem, event },
    evidence: { endpoints, metrics },
    escalation: { tower: "DBA", message: escalationMessage },
    recovery: { endpoints: recoveryEndpoints, metrics: recoveryMetrics },
    communication,
    timeline,
  };
  const basename = `${id}-BANCO-DE-PEDIDOS-INDISPONIVEL`;
  const jsonPath = path.join(outputDir, `${basename}.json`);
  const markdownPath = path.join(outputDir, `${basename}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown(report));

  console.log(`Incidente concluído: ${id}`);
  console.log(`Relatório: ${markdownPath}`);
  console.log(`Dados: ${jsonPath}`);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await setMode("healthy");
  } catch {}
  process.exitCode = 1;
});
