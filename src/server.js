const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 18080);
const stateFile =
  process.env.STATE_FILE || path.join(__dirname, "..", "data", "failure-mode");
const allowedModes = new Set(["healthy", "unhealthy", "error", "slow"]);

const metrics = {
  requests: 0,
  errors: 0,
  startedAt: Date.now(),
};

function log(level, message, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      pid: process.pid,
      ...fields,
    })}\n`,
  );
}

function failureMode() {
  try {
    return fs.readFileSync(stateFile, "utf8").trim() || "healthy";
  } catch (error) {
    if (error.code !== "ENOENT") {
      log("error", "could not read failure mode", { error: error.message });
    }
    return "healthy";
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}

function sendMetrics(response) {
  const uptimeSeconds = Math.floor((Date.now() - metrics.startedAt) / 1000);
  response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
  response.end(
    [
      "# HELP lab_requests_total Total de requisicoes recebidas.",
      "# TYPE lab_requests_total counter",
      `lab_requests_total ${metrics.requests}`,
      "# HELP lab_errors_total Total de respostas com erro simulado.",
      "# TYPE lab_errors_total counter",
      `lab_errors_total ${metrics.errors}`,
      "# HELP lab_process_uptime_seconds Tempo de vida do processo.",
      "# TYPE lab_process_uptime_seconds gauge",
      `lab_process_uptime_seconds ${uptimeSeconds}`,
      "",
    ].join("\n"),
  );
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Observability Lab</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; background: #08111f; color: #e8eef7; }
    main { max-width: 1100px; margin: auto; padding: 32px 20px; }
    h1 { margin-bottom: 6px; } .sub { color: #8fa5c2; margin-top: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(210px,1fr)); gap: 14px; margin: 24px 0; }
    .card { background: #111d2e; border: 1px solid #263750; border-radius: 14px; padding: 18px; }
    .label { color: #8fa5c2; font-size: 13px; text-transform: uppercase; }
    .value { font-size: 26px; font-weight: 700; margin-top: 8px; }
    .ok { color: #54e18a; } .bad { color: #ff6577; } .warn { color: #ffc857; }
    button { border: 0; border-radius: 9px; padding: 11px 16px; margin: 5px; font-weight: 700; cursor: pointer; }
    button[data-mode=healthy] { background:#2dc76d; }
    button[data-mode=unhealthy] { background:#ff6577; }
    button[data-mode=error] { background:#ff934f; }
    button[data-mode=slow] { background:#ffc857; color:#18202b; }
    a { color: #75b7ff; } code { color:#b9d7ff; }
  </style>
</head>
<body>
<main>
  <h1>Observability Lab</h1>
  <p class="sub">Centro de controle da demonstração de incidentes</p>
  <div class="grid">
    <div class="card"><div class="label">Estado atual</div><div id="mode" class="value">...</div></div>
    <div class="card"><div class="label">Readiness</div><div id="ready" class="value">...</div></div>
    <div class="card"><div class="label">Operação /work</div><div id="work" class="value">...</div></div>
    <div class="card"><div class="label">Latência</div><div id="latency" class="value">...</div></div>
  </div>
  <div class="card">
    <div class="label">Injetar falha controlada</div>
    <p>O processo permanece ativo. Você altera o comportamento e observa Zabbix, Prometheus e Grafana.</p>
    <button data-mode="healthy">Restaurar</button>
    <button data-mode="unhealthy">Readiness 503</button>
    <button data-mode="error">Erro HTTP 500</button>
    <button data-mode="slow">Latência 3s</button>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="label">Ferramentas</div>
    <p><a href="http://localhost:8080" target="_blank">Zabbix</a> ·
    <a href="http://localhost:3000" target="_blank">Grafana</a> ·
    <a href="http://localhost:9090" target="_blank">Prometheus</a> ·
    <a href="/metrics" target="_blank">Métricas da aplicação</a></p>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
async function refresh() {
  const started = performance.now();
  const [status, ready, work] = await Promise.all([
    fetch('/api/status').then(r => r.json()),
    fetch('/health/ready').then(r => ({code:r.status})),
    fetch('/work').then(r => ({code:r.status}))
  ]);
  const latency = Math.round(performance.now() - started);
  $('mode').textContent = status.mode;
  $('mode').className = 'value ' + (status.mode === 'healthy' ? 'ok' : status.mode === 'slow' ? 'warn' : 'bad');
  $('ready').textContent = ready.code;
  $('ready').className = 'value ' + (ready.code === 200 ? 'ok' : 'bad');
  $('work').textContent = work.code;
  $('work').className = 'value ' + (work.code === 200 ? 'ok' : 'bad');
  $('latency').textContent = latency + ' ms';
  $('latency').className = 'value ' + (latency > 2000 ? 'warn' : 'ok');
}
document.querySelectorAll('button').forEach(button => button.onclick = async () => {
  await fetch('/api/control', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({mode:button.dataset.mode})});
  refresh();
});
refresh(); setInterval(refresh, 5000);
</script>
</body></html>`;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  const mode = failureMode();
  metrics.requests += 1;

  if (mode === "slow" && !request.url.startsWith("/api/control")) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (request.url === "/" || request.url === "/dashboard") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(dashboardHtml());
  } else if (request.url === "/api/status") {
    sendJson(response, 200, { mode, pid: process.pid, uptime: process.uptime() });
  } else if (request.url === "/api/control" && request.method === "POST") {
    try {
      const body = await readJson(request);
      if (!allowedModes.has(body.mode)) {
        sendJson(response, 400, { error: "invalid mode" });
      } else {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        if (body.mode === "healthy") fs.rmSync(stateFile, { force: true });
        else fs.writeFileSync(stateFile, `${body.mode}\n`);
        log("warn", "failure mode changed", { new_mode: body.mode });
        sendJson(response, 200, { mode: body.mode });
      }
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
  } else if (request.url === "/health/live") {
    sendJson(response, 200, { status: "alive", pid: process.pid });
  } else if (request.url === "/health/ready") {
    if (mode === "unhealthy") {
      metrics.errors += 1;
      sendJson(response, 503, { status: "not-ready", mode });
    } else {
      sendJson(response, 200, { status: "ready", mode });
    }
  } else if (request.url === "/metrics") {
    sendMetrics(response);
  } else if (request.url === "/work") {
    if (mode === "error") {
      metrics.errors += 1;
      sendJson(response, 500, { error: "simulated dependency failure" });
    } else {
      sendJson(response, 200, { result: "work completed", mode });
    }
  } else {
    sendJson(response, 404, { error: "not found" });
  }

  log("info", "request completed", {
    method: request.method,
    path: request.url,
    status: response.statusCode,
    duration_ms: Date.now() - startedAt,
    failure_mode: mode,
  });
});

server.listen(port, host, () => {
  log("info", "service started", { host, port });
});

function shutdown(signal) {
  log("info", "shutdown requested", { signal });
  server.close((error) => {
    if (error) {
      log("error", "shutdown failed", { error: error.message });
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
