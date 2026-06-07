const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const mysql = require("mysql2/promise");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 18080);
const stateFile =
  process.env.STATE_FILE || path.join(__dirname, "..", "data", "failure-mode");
const dbRequired = process.env.DB_REQUIRED !== "false";
const allowedModes = new Set([
  "healthy",
  "unhealthy",
  "error",
  "slow",
  "db-unavailable",
  "db-slow",
  "db-error",
]);

const dbConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || "orders_app",
  user: process.env.DB_USER || "orders_app",
  password: process.env.DB_PASSWORD || "",
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 20,
  connectTimeout: 1500,
};

const pool = mysql.createPool(dbConfig);
const unavailablePool = mysql.createPool({
  ...dbConfig,
  port: Number(process.env.DB_UNAVAILABLE_PORT || 3307),
  connectionLimit: 2,
});

const metrics = {
  requests: 0,
  errors: 0,
  dbQueries: 0,
  dbErrors: 0,
  dbLastDurationSeconds: 0,
  dbAvailable: 0,
  startedAt: Date.now(),
};

function log(level, message, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      service: "observability-lab",
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

function sendJson(response, status, body, requestId) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...(requestId ? { "x-request-id": requestId } : {}),
  });
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
      "# HELP lab_errors_total Total de respostas com erro.",
      "# TYPE lab_errors_total counter",
      `lab_errors_total ${metrics.errors}`,
      "# HELP lab_process_uptime_seconds Tempo de vida do processo.",
      "# TYPE lab_process_uptime_seconds gauge",
      `lab_process_uptime_seconds ${uptimeSeconds}`,
      "# HELP lab_db_queries_total Total de consultas ao banco de pedidos.",
      "# TYPE lab_db_queries_total counter",
      `lab_db_queries_total ${metrics.dbQueries}`,
      "# HELP lab_db_errors_total Total de erros do banco de pedidos.",
      "# TYPE lab_db_errors_total counter",
      `lab_db_errors_total ${metrics.dbErrors}`,
      "# HELP lab_db_query_duration_seconds Duracao da ultima operacao no banco.",
      "# TYPE lab_db_query_duration_seconds gauge",
      `lab_db_query_duration_seconds ${metrics.dbLastDurationSeconds}`,
      "# HELP lab_db_available Disponibilidade da ultima verificacao do banco.",
      "# TYPE lab_db_available gauge",
      `lab_db_available ${metrics.dbAvailable}`,
      "",
    ].join("\n"),
  );
}

async function executeDatabaseOperation(mode, requestId, operation) {
  const startedAt = process.hrtime.bigint();
  const activePool = mode === "db-unavailable" ? unavailablePool : pool;
  metrics.dbQueries += 1;

  try {
    if (mode === "db-slow") {
      await activePool.query("SELECT SLEEP(3)");
    }
    if (mode === "db-error") {
      await activePool.query("SELECT missing_column FROM missing_table");
    }
    const result = await operation(activePool);
    metrics.dbAvailable = 1;
    return result;
  } catch (error) {
    metrics.dbErrors += 1;
    metrics.dbAvailable = 0;
    log("error", "database operation failed", {
      request_id: requestId,
      failure_mode: mode,
      error_code: error.code,
      error: error.message,
    });
    throw error;
  } finally {
    metrics.dbLastDurationSeconds =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
  }
}

async function databaseHealth(mode, requestId) {
  if (!dbRequired) return { available: true, skipped: true };
  await executeDatabaseOperation(mode, requestId, (activePool) =>
    activePool.query("SELECT 1"),
  );
  return { available: true };
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
    main { max-width: 1180px; margin: auto; padding: 32px 20px 64px; }
    h1,h2 { margin-bottom: 6px; } .sub,.muted { color: #8fa5c2; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(190px,1fr)); gap: 14px; margin: 24px 0; }
    .card { background: #111d2e; border: 1px solid #263750; border-radius: 14px; padding: 18px; }
    .label { color: #8fa5c2; font-size: 13px; text-transform: uppercase; }
    .value { font-size: 26px; font-weight: 700; margin-top: 8px; }
    .ok { color: #54e18a; } .bad { color: #ff6577; } .warn { color: #ffc857; }
    button { border: 0; border-radius: 9px; padding: 11px 16px; margin: 5px; font-weight: 700; cursor: pointer; }
    button[data-mode=healthy] { background:#2dc76d; }
    button[data-mode=unhealthy],button[data-mode=db-unavailable] { background:#ff6577; }
    button[data-mode=error],button[data-mode=db-error] { background:#ff934f; }
    button[data-mode=slow],button[data-mode=db-slow] { background:#ffc857; color:#18202b; }
    a { color: #75b7ff; } code { color:#b9d7ff; }
    input { background:#08111f; color:#e8eef7; border:1px solid #3b4e69; border-radius:8px; padding:10px; margin:4px; }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    th,td { text-align:left; border-bottom:1px solid #263750; padding:10px 6px; }
    .row { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
  </style>
</head>
<body>
<main>
  <h1>Observability Lab</h1>
  <p class="sub">Aplicação de pedidos com incidentes controlados e observabilidade</p>
  <div class="grid">
    <div class="card"><div class="label">Modo atual</div><div id="mode" class="value">...</div></div>
    <div class="card"><div class="label">Readiness</div><div id="ready" class="value">...</div></div>
    <div class="card"><div class="label">Banco de pedidos</div><div id="database" class="value">...</div></div>
    <div class="card"><div class="label">API de pedidos</div><div id="ordersApi" class="value">...</div></div>
    <div class="card"><div class="label">Latência observada</div><div id="latency" class="value">...</div></div>
  </div>

  <div class="card">
    <div class="label">Incidentes da aplicação</div>
    <button data-mode="healthy">Restaurar tudo</button>
    <button data-mode="unhealthy">Readiness 503</button>
    <button data-mode="error">Erro HTTP 500</button>
    <button data-mode="slow">Latência geral 3s</button>
  </div>

  <div class="card" style="margin-top:14px">
    <div class="label">Incidentes do banco de negócio</div>
    <button data-mode="db-unavailable">Banco indisponível</button>
    <button data-mode="db-slow">Consulta lenta</button>
    <button data-mode="db-error">Erro SQL</button>
    <p class="muted">O processo da aplicação continua ativo. O impacto aparece na API de pedidos.</p>
  </div>

  <div class="card" style="margin-top:14px">
    <h2>Pedidos</h2>
    <form id="orderForm" class="row">
      <input id="customer" required maxlength="120" placeholder="Cliente">
      <input id="description" required maxlength="255" placeholder="Descrição do pedido">
      <button type="submit">Criar pedido</button>
    </form>
    <div id="orderMessage" class="muted"></div>
    <table>
      <thead><tr><th>ID</th><th>Cliente</th><th>Descrição</th><th>Status</th><th>Criado em</th></tr></thead>
      <tbody id="orders"></tbody>
    </table>
  </div>

  <div class="card" style="margin-top:14px">
    <div class="label">Ferramentas</div>
    <p><a href="http://localhost:8080" target="_blank">Zabbix</a> ·
    <a href="http://localhost:3000" target="_blank">Grafana</a> ·
    <a href="http://localhost:9090" target="_blank">Prometheus</a> ·
    <a href="http://localhost:9093" target="_blank">Alertmanager</a> ·
    <a href="http://localhost:18082" target="_blank">Notificações</a> ·
    <a href="/metrics" target="_blank">Métricas</a></p>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  })[character]);
}
function setState(id, text, state) {
  $(id).textContent = text;
  $(id).className = 'value ' + state;
}
async function loadOrders() {
  const started = performance.now();
  try {
    const response = await fetch('/api/orders');
    const data = await response.json();
    const latency = Math.round(performance.now() - started);
    setState('ordersApi', response.status, response.ok ? 'ok' : 'bad');
    setState('latency', latency + ' ms', latency > 2000 ? 'warn' : 'ok');
    if (!response.ok) throw new Error(data.error || 'Falha na API');
    $('orders').innerHTML = data.orders.map(order =>
      '<tr><td>'+escapeHtml(order.id)+'</td><td>'+escapeHtml(order.customer_name)+'</td><td>'+escapeHtml(order.description)+
      '</td><td>'+escapeHtml(order.status)+'</td><td>'+escapeHtml(new Date(order.created_at).toLocaleString())+'</td></tr>'
    ).join('');
    $('orderMessage').textContent = data.orders.length + ' pedido(s) carregado(s)';
  } catch (error) {
    $('orders').innerHTML = '';
    $('orderMessage').textContent = error.message;
    setState('ordersApi', 'ERRO', 'bad');
  }
}
async function refresh() {
  const status = await fetch('/api/status').then(r => r.json());
  setState('mode', status.mode, status.mode === 'healthy' ? 'ok' : status.mode.includes('slow') ? 'warn' : 'bad');
  const ready = await fetch('/health/ready');
  setState('ready', ready.status, ready.ok ? 'ok' : 'bad');
  const database = await fetch('/health/db');
  setState('database', database.status, database.ok ? 'ok' : 'bad');
  await loadOrders();
}
document.querySelectorAll('button[data-mode]').forEach(button => button.onclick = async () => {
  await fetch('/api/control', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({mode:button.dataset.mode})});
  refresh();
});
$('orderForm').onsubmit = async (event) => {
  event.preventDefault();
  const response = await fetch('/api/orders', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({customer_name:$('customer').value, description:$('description').value})
  });
  const data = await response.json();
  $('orderMessage').textContent = response.ok ? 'Pedido criado: #' + data.order.id : data.error;
  if (response.ok) event.target.reset();
  loadOrders();
};
refresh(); setInterval(refresh, 10000);
</script>
</body></html>`;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function databaseErrorResponse(error, requestId) {
  const unavailableCodes = new Set([
    "ECONNREFUSED",
    "ETIMEDOUT",
    "PROTOCOL_CONNECTION_LOST",
  ]);
  return {
    status: unavailableCodes.has(error.code) ? 503 : 500,
    body: {
      error: unavailableCodes.has(error.code)
        ? "database unavailable"
        : "database operation failed",
      code: error.code || "UNKNOWN",
      request_id: requestId,
    },
  };
}

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  const mode = failureMode();
  const requestId = request.headers["x-request-id"] || randomUUID();
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  metrics.requests += 1;

  try {
    if (mode === "slow" && !url.pathname.startsWith("/api/control")) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    if (url.pathname === "/" || url.pathname === "/dashboard") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(dashboardHtml());
    } else if (url.pathname === "/api/status") {
      sendJson(
        response,
        200,
        { mode, pid: process.pid, uptime: process.uptime() },
        requestId,
      );
    } else if (url.pathname === "/api/control" && request.method === "POST") {
      const body = await readJson(request);
      if (!allowedModes.has(body.mode)) {
        sendJson(response, 400, { error: "invalid mode" }, requestId);
      } else {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        if (body.mode === "healthy") fs.rmSync(stateFile, { force: true });
        else fs.writeFileSync(stateFile, `${body.mode}\n`);
        log("warn", "failure mode changed", {
          request_id: requestId,
          new_mode: body.mode,
        });
        sendJson(response, 200, { mode: body.mode }, requestId);
      }
    } else if (url.pathname === "/health/live") {
      sendJson(response, 200, { status: "alive", pid: process.pid }, requestId);
    } else if (url.pathname === "/health/db") {
      try {
        await databaseHealth(mode, requestId);
        sendJson(response, 200, { status: "available", mode }, requestId);
      } catch (error) {
        metrics.errors += 1;
        const result = databaseErrorResponse(error, requestId);
        sendJson(response, result.status, result.body, requestId);
      }
    } else if (url.pathname === "/health/ready") {
      if (mode === "unhealthy") {
        metrics.errors += 1;
        sendJson(response, 503, { status: "not-ready", mode }, requestId);
      } else {
        try {
          await databaseHealth(mode, requestId);
          sendJson(response, 200, { status: "ready", mode }, requestId);
        } catch (error) {
          metrics.errors += 1;
          sendJson(
            response,
            503,
            { status: "not-ready", dependency: "business-db", mode },
            requestId,
          );
        }
      }
    } else if (url.pathname === "/metrics") {
      sendMetrics(response);
    } else if (url.pathname === "/work") {
      if (mode === "error") {
        metrics.errors += 1;
        sendJson(
          response,
          500,
          { error: "simulated application failure" },
          requestId,
        );
      } else {
        sendJson(response, 200, { result: "work completed", mode }, requestId);
      }
    } else if (url.pathname === "/api/orders" && request.method === "GET") {
      try {
        const [orders] = await executeDatabaseOperation(
          mode,
          requestId,
          (activePool) =>
            activePool.query(
              "SELECT id, customer_name, description, status, created_at FROM orders ORDER BY id DESC LIMIT 50",
            ),
        );
        sendJson(response, 200, { orders }, requestId);
      } catch (error) {
        metrics.errors += 1;
        const result = databaseErrorResponse(error, requestId);
        sendJson(response, result.status, result.body, requestId);
      }
    } else if (url.pathname === "/api/orders" && request.method === "POST") {
      const body = await readJson(request);
      if (!body.customer_name || !body.description) {
        sendJson(
          response,
          400,
          { error: "customer_name and description are required" },
          requestId,
        );
      } else {
        try {
          const [result] = await executeDatabaseOperation(
            mode,
            requestId,
            (activePool) =>
              activePool.execute(
                "INSERT INTO orders (customer_name, description) VALUES (?, ?)",
                [
                  String(body.customer_name).slice(0, 120),
                  String(body.description).slice(0, 255),
                ],
              ),
          );
          const [rows] = await pool.execute(
            "SELECT id, customer_name, description, status, created_at FROM orders WHERE id = ?",
            [result.insertId],
          );
          sendJson(response, 201, { order: rows[0] }, requestId);
        } catch (error) {
          metrics.errors += 1;
          const result = databaseErrorResponse(error, requestId);
          sendJson(response, result.status, result.body, requestId);
        }
      }
    } else {
      sendJson(response, 404, { error: "not found" }, requestId);
    }
  } catch (error) {
    metrics.errors += 1;
    log("error", "unhandled request error", {
      request_id: requestId,
      error: error.message,
    });
    if (!response.headersSent) {
      sendJson(
        response,
        500,
        { error: "internal server error", request_id: requestId },
        requestId,
      );
    } else {
      response.end();
    }
  } finally {
    log("info", "request completed", {
      request_id: requestId,
      method: request.method,
      path: url.pathname,
      status: response.statusCode,
      duration_ms: Date.now() - startedAt,
      failure_mode: mode,
    });
  }
});

server.listen(port, host, () => {
  log("info", "service started", {
    host,
    port,
    database_host: dbConfig.host,
    database_name: dbConfig.database,
  });
});

async function shutdown(signal) {
  log("info", "shutdown requested", { signal });
  server.close(async (error) => {
    await Promise.allSettled([pool.end(), unavailablePool.end()]);
    if (error) {
      log("error", "shutdown failed", { error: error.message });
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
