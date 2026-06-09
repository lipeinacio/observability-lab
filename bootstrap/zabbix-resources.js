const RUNBOOK_BASE =
  "https://github.com/lipeinacio/observability-lab/blob/main/runbooks";

const hosts = {
  application: {
    host: "observability-lab",
    name: "APP-LAB-ORDERS",
    description:
      "Aplicação de pedidos monitorada por cenários HTTP. Ponto inicial para incidentes de API e dependência MySQL.",
    tags: [
      { tag: "environment", value: "lab" },
      { tag: "service", value: "orders-api" },
      { tag: "owner", value: "application" },
    ],
  },
  linux: {
    host: "lab-target",
    name: "SRV-LAB-LINUX",
    description:
      "Servidor Linux do laboratório monitorado pelo Zabbix Agent 2.",
    tags: [
      { tag: "environment", value: "lab" },
      { tag: "layer", value: "operating-system" },
      { tag: "escalation", value: "sistemas" },
    ],
  },
  snmp: {
    host: "lab-snmp-target",
    name: "NET-LAB-SNMP",
    description:
      "Equipamento de rede simulado, monitorado por SNMP v2c.",
    tags: [
      { tag: "environment", value: "lab" },
      { tag: "layer", value: "network" },
      { tag: "escalation", value: "netsec" },
    ],
  },
};

const triggers = {
  appReadinessUnavailable: {
    description: "Orders API: readiness indisponível",
    aliases: ["Observability Lab: aplicação indisponível"],
    expression: [
      "last(/observability-lab/web.test.rspcode[App readiness,Readiness endpoint])=503",
      "and",
      "last(/observability-lab/web.test.rspcode[Business database health,Database health endpoint])=200",
    ].join(" "),
    priority: 4,
    comments: [
      "Impacto: a aplicação não está pronta para atender requisições.",
      "Triagem: confirmar /health/live, /health/ready e dependências.",
      "Escalonamento provável: Aplicação ou Sistemas; DBA quando a falha vier do MySQL.",
    ].join("\n"),
    url: `${RUNBOOK_BASE}/API_DE_PEDIDOS_INDISPONIVEL.md`,
    tags: [
      { tag: "service", value: "orders-api" },
      { tag: "layer", value: "application" },
      { tag: "impact", value: "unavailable" },
      { tag: "escalation", value: "application" },
    ],
  },
  appEndpointUnavailable: {
    description: "Orders API: endpoint inacessível",
    aliases: ["Orders API: endpoint sem resposta"],
    expression: [
      "last(/observability-lab/web.test.fail[App work])<>0",
      "and",
      "last(/observability-lab/web.test.rspcode[App work,Work endpoint])<>500",
    ].join(" "),
    priority: 4,
    comments: [
      "Impacto: o Zabbix não consegue estabelecer uma resposta HTTP com a aplicação.",
      "Triagem: separar DNS, conexão recusada, timeout e processo parado.",
      "Escalonamento provável: Sistemas ou Redes.",
    ].join("\n"),
    url: `${RUNBOOK_BASE}/APLICACAO_INACESSIVEL_PELA_REDE.md`,
    tags: [
      { tag: "service", value: "orders-api" },
      { tag: "layer", value: "network" },
      { tag: "impact", value: "unavailable" },
      { tag: "escalation", value: "sistemas-netsec" },
    ],
  },
  appWorkError: {
    description: "Orders API: operação principal com erro",
    aliases: ["Observability Lab: operação principal com erro"],
    expression:
      "last(/observability-lab/web.test.rspcode[App work,Work endpoint])=500",
    priority: 4,
    comments: [
      "Impacto: a operação principal retorna erro ao cliente.",
      "Triagem: confirmar o status HTTP e correlacionar logs pelo request_id.",
      "Escalonamento provável: Aplicação.",
    ].join("\n"),
    url: `${RUNBOOK_BASE}/CORRELACIONAR_ERRO_POR_REQUEST_ID.md`,
    tags: [
      { tag: "service", value: "orders-api" },
      { tag: "layer", value: "application" },
      { tag: "impact", value: "error" },
      { tag: "escalation", value: "application" },
    ],
  },
  appReadinessSlow: {
    description: "Orders API: readiness acima de 2 segundos",
    aliases: ["Observability Lab: latência acima de 2 segundos"],
    expression: [
      "avg(/observability-lab/web.test.time[App readiness,Readiness endpoint,resp],30s)>2",
      "and",
      "avg(/observability-lab/web.test.time[Business database health,Database health endpoint,resp],30s)<=2",
    ].join(" "),
    priority: 3,
    comments: [
      "Impacto: degradação perceptível na verificação de prontidão.",
      "Triagem: correlacionar latência da aplicação e das dependências.",
      "Escalonamento provável: Aplicação, DBA ou Redes conforme a evidência.",
    ].join("\n"),
    url: `${RUNBOOK_BASE}/API_DE_PEDIDOS_INDISPONIVEL.md`,
    tags: [
      { tag: "service", value: "orders-api" },
      { tag: "layer", value: "application" },
      { tag: "impact", value: "degraded" },
      { tag: "escalation", value: "application" },
    ],
  },
  appWorkSlow: {
    description: "Orders API: operação principal acima de 2 segundos",
    aliases: ["Observability Lab: operação principal acima de 2 segundos"],
    expression:
      "avg(/observability-lab/web.test.time[App work,Work endpoint,resp],30s)>2",
    priority: 3,
    comments: [
      "Impacto: operação principal responde com degradação.",
      "Triagem: comparar tempo HTTP, recursos do host e logs.",
      "Escalonamento provável: Aplicação ou Sistemas.",
    ].join("\n"),
    url: `${RUNBOOK_BASE}/API_DE_PEDIDOS_INDISPONIVEL.md`,
    tags: [
      { tag: "service", value: "orders-api" },
      { tag: "layer", value: "application" },
      { tag: "impact", value: "degraded" },
      { tag: "escalation", value: "application" },
    ],
  },
  databaseUnavailable: {
    description: "Orders MySQL: dependência indisponível",
    aliases: ["Observability Lab: banco de negócio indisponível"],
    expression:
      "last(/observability-lab/web.test.rspcode[Business database health,Database health endpoint])=503",
    priority: 4,
    comments: [
      "Impacto: usuários não conseguem consultar ou criar pedidos.",
      "Triagem: confirmar processo da aplicação vivo e falha exclusiva em /health/db.",
      "Escalonamento provável: DBA.",
    ].join("\n"),
    url: `${RUNBOOK_BASE}/BANCO_DE_PEDIDOS_INDISPONIVEL.md`,
    tags: [
      { tag: "service", value: "orders-api" },
      { tag: "layer", value: "database" },
      { tag: "impact", value: "unavailable" },
      { tag: "escalation", value: "dba" },
    ],
  },
  ordersApiError: {
    description: "Orders API: consulta de pedidos com erro",
    aliases: ["Observability Lab: API de pedidos com erro"],
    expression: [
      "last(/observability-lab/web.test.rspcode[Orders API,List orders])=500",
      "and",
      "last(/observability-lab/web.test.rspcode[Business database health,Database health endpoint])=200",
    ].join(" "),
    priority: 4,
    comments: [
      "Impacto: usuários não conseguem listar pedidos.",
      "Triagem: verificar /api/orders, /health/db e logs pelo request_id.",
      "Escalonamento provável: Aplicação ou DBA conforme o erro.",
    ].join("\n"),
    url: `${RUNBOOK_BASE}/CORRELACIONAR_ERRO_POR_REQUEST_ID.md`,
    tags: [
      { tag: "service", value: "orders-api" },
      { tag: "layer", value: "application" },
      { tag: "impact", value: "error" },
      { tag: "escalation", value: "application" },
    ],
  },
  databaseError: {
    description: "Orders MySQL: operação com erro",
    expression:
      "last(/observability-lab/web.test.rspcode[Business database health,Database health endpoint])=500",
    priority: 4,
    comments: [
      "Impacto: operações dependentes do MySQL falham por erro de execução.",
      "Triagem: correlacionar código HTTP, erro SQL e request_id.",
      "Escalonamento provável: DBA ou Aplicação conforme a consulta.",
    ].join("\n"),
    url: `${RUNBOOK_BASE}/CORRELACIONAR_ERRO_POR_REQUEST_ID.md`,
    tags: [
      { tag: "service", value: "orders-api" },
      { tag: "layer", value: "database" },
      { tag: "impact", value: "error" },
      { tag: "escalation", value: "dba" },
    ],
  },
  databaseSlow: {
    description: "Orders MySQL: consulta acima de 2 segundos",
    aliases: ["Observability Lab: consulta ao banco acima de 2 segundos"],
    expression:
      "avg(/observability-lab/web.test.time[Business database health,Database health endpoint,resp],30s)>2",
    priority: 3,
    comments: [
      "Impacto: operações dependentes do MySQL apresentam degradação.",
      "Triagem: correlacionar duração, erros e consumo antes de intervir.",
      "Escalonamento provável: DBA.",
    ].join("\n"),
    url: `${RUNBOOK_BASE}/BANCO_DE_PEDIDOS_INDISPONIVEL.md`,
    tags: [
      { tag: "service", value: "orders-api" },
      { tag: "layer", value: "database" },
      { tag: "impact", value: "degraded" },
      { tag: "escalation", value: "dba" },
    ],
  },
};

module.exports = { hosts, triggers };
