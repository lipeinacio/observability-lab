const http = require("node:http");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 18082);
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || "";
const telegramChatId = process.env.TELEGRAM_CHAT_ID || "";
const history = [];

function log(level, message, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      service: "alert-webhook",
      ...fields,
    })}\n`,
  );
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function alertMessage(payload) {
  const status = payload.status === "resolved" ? "RESOLVIDO" : "DISPARADO";
  const lines = [`[${status}] Observability Lab`];

  for (const alert of payload.alerts || []) {
    const labels = alert.labels || {};
    const annotations = alert.annotations || {};
    lines.push(
      "",
      `Alerta: ${labels.alertname || "sem nome"}`,
      `Severidade: ${labels.severity || "não informada"}`,
      `Serviço: ${labels.service || "não informado"}`,
      `Componente: ${labels.component || "não informado"}`,
      `Resumo: ${annotations.summary || "não informado"}`,
      `Impacto: ${annotations.impact || "não informado"}`,
      `Ação: ${annotations.action || "não informada"}`,
      `Dashboard: ${annotations.dashboard_url || "não informado"}`,
      `Runbook: ${annotations.runbook_url || "não informado"}`,
    );
  }

  return lines.join("\n");
}

async function sendTelegram(text) {
  if (!telegramBotToken || !telegramChatId) {
    return { enabled: false, sent: false };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text,
        disable_web_page_preview: true,
      }),
    },
  );
  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(`Telegram HTTP ${response.status}: ${body.description}`);
  }
  return { enabled: true, sent: true };
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Alert Webhook</title>
  <style>
    body{font-family:system-ui;background:#08111f;color:#e8eef7;max-width:1000px;margin:auto;padding:30px}
    .card{background:#111d2e;border:1px solid #263750;border-radius:12px;padding:16px;margin:12px 0}
    .firing{border-left:5px solid #ff6577}.resolved{border-left:5px solid #54e18a}
    pre{white-space:pre-wrap}a{color:#75b7ff}.muted{color:#8fa5c2}
  </style>
</head>
<body>
  <h1>Alert Webhook</h1>
  <p class="muted">Histórico local das notificações recebidas do Alertmanager</p>
  <p>Telegram: <strong>${telegramBotToken && telegramChatId ? "configurado" : "não configurado"}</strong></p>
  <div id="alerts">Carregando...</div>
  <script>
    async function refresh() {
      const response = await fetch('/api/history');
      const data = await response.json();
      document.getElementById('alerts').innerHTML = data.events.map(event =>
        '<div class="card '+event.status+'"><strong>'+event.status.toUpperCase()+
        '</strong><div class="muted">'+new Date(event.received_at).toLocaleString()+
        '</div><pre>'+event.message.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+
        '</pre></div>'
      ).join('') || '<div class="card">Nenhuma notificação recebida.</div>';
    }
    refresh(); setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/health") {
      sendJson(response, 200, {
        status: "ready",
        telegram_configured: Boolean(telegramBotToken && telegramChatId),
      });
    } else if (url.pathname === "/api/history") {
      sendJson(response, 200, { events: history });
    } else if (url.pathname === "/alerts" && request.method === "POST") {
      const payload = await readJson(request);
      const message = alertMessage(payload);
      const event = {
        received_at: new Date().toISOString(),
        status: payload.status,
        group_key: payload.groupKey,
        alerts: payload.alerts,
        message,
        telegram: { enabled: Boolean(telegramBotToken && telegramChatId), sent: false },
      };

      try {
        event.telegram = await sendTelegram(message);
      } catch (error) {
        event.telegram = { enabled: true, sent: false, error: error.message };
        log("error", "telegram delivery failed", { error: error.message });
      }

      history.unshift(event);
      history.splice(100);
      log("info", "alert notification received", {
        status: payload.status,
        alerts: payload.alerts?.map((alert) => alert.labels?.alertname),
        telegram_sent: event.telegram.sent,
      });
      sendJson(response, 200, { accepted: true, telegram: event.telegram });
    } else if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(dashboardHtml());
    } else {
      sendJson(response, 404, { error: "not found" });
    }
  } catch (error) {
    log("error", "request failed", { error: error.message });
    sendJson(response, 500, { error: "internal server error" });
  }
});

server.listen(port, host, () => {
  log("info", "alert webhook started", {
    host,
    port,
    telegram_configured: Boolean(telegramBotToken && telegramChatId),
  });
});
