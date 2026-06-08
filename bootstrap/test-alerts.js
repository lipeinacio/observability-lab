const appUrl = "http://127.0.0.1:18080";
const webhookUrl = "http://127.0.0.1:18082";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setMode(mode) {
  const response = await fetch(`${appUrl}/api/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error(`Não foi possível ativar ${mode}`);
}

async function events() {
  const response = await fetch(`${webhookUrl}/api/history`);
  if (!response.ok) throw new Error(`Webhook respondeu HTTP ${response.status}`);
  return (await response.json()).events;
}

async function waitForStatus(status, since, timeoutSeconds = 60) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const event = (await events()).find(
      (candidate) =>
        candidate.status === status &&
        Date.parse(candidate.received_at) >= since &&
        candidate.alerts?.some(
          (alert) => alert.labels?.alertname === "BusinessDatabaseUnavailable",
        ),
    );
    if (event) return event;
    await sleep(2000);
  }
  throw new Error(`Notificação ${status} não chegou em ${timeoutSeconds}s`);
}

async function ensureNoRedundantApplicationAlert(since) {
  await sleep(8000);
  const redundant = (await events()).find(
    (candidate) =>
      candidate.status === "firing" &&
      Date.parse(candidate.received_at) >= since &&
      candidate.alerts?.some(
        (alert) => alert.labels?.alertname === "ApplicationErrorsDetected",
      ),
  );
  if (redundant) {
    throw new Error(
      "ApplicationErrorsDetected foi enviado para um incidente já explicado pelo banco",
    );
  }
}

function verifyTelegram(event) {
  if (event.telegram?.enabled && !event.telegram.sent) {
    throw new Error(
      `Telegram configurado, mas a entrega falhou: ${event.telegram.error || "erro desconhecido"}`,
    );
  }
  return event.telegram?.enabled ? "Telegram: enviado" : "Telegram: desabilitado";
}

async function main() {
  await setMode("healthy");
  const startedAt = Date.now();
  await setMode("db-unavailable");
  await fetch(`${appUrl}/health/db`);

  const firing = await waitForStatus("firing", startedAt);
  console.log("FIRING recebido:");
  console.log(firing.message);
  console.log(verifyTelegram(firing));

  await setMode("healthy");
  await fetch(`${appUrl}/health/db`);
  const resolved = await waitForStatus("resolved", startedAt);
  console.log("\nRESOLVED recebido:");
  console.log(resolved.message);
  console.log(verifyTelegram(resolved));

  await ensureNoRedundantApplicationAlert(startedAt);
  console.log("Sem notificação redundante de erro da aplicação.");
}

main().catch(async (error) => {
  console.error(error);
  try {
    await setMode("healthy");
  } catch {}
  process.exit(1);
});
