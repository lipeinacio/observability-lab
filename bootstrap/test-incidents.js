const zabbixUrl = "http://127.0.0.1:8080/api_jsonrpc.php";
const appUrl = "http://127.0.0.1:18080";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(method, params, auth) {
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
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
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

async function triggerValue(auth, description) {
  const triggers = await api("trigger.get", {
    filter: { description },
    output: ["description", "value"],
  }, auth);
  if (!triggers.length) throw new Error(`Trigger não encontrada: ${description}`);
  return triggers[0].value;
}

async function waitForTrigger(auth, description, expected, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const value = await triggerValue(auth, description);
    if (value === expected) return;
    await sleep(5000);
  }
  throw new Error(
    `Trigger "${description}" não chegou ao valor ${expected} em ${timeoutSeconds}s`,
  );
}

async function runScenario(auth, mode, trigger, timeoutSeconds = 45) {
  console.log(`\nCenário: ${mode}`);
  await setMode(mode);
  await waitForTrigger(auth, trigger, "1", timeoutSeconds);
  console.log(`ALERTA: ${trigger}`);

  await setMode("healthy");
  await waitForTrigger(auth, trigger, "0", timeoutSeconds);
  console.log("RECUPERAÇÃO: trigger normalizada");
}

async function main() {
  const auth = await api("user.login", { username: "Admin", password: "zabbix" });
  await setMode("healthy");

  await runScenario(
    auth,
    "unhealthy",
    "Observability Lab: aplicação indisponível",
  );
  await runScenario(
    auth,
    "error",
    "Observability Lab: operação principal com erro",
  );
  await runScenario(
    auth,
    "slow",
    "Observability Lab: operação principal acima de 2 segundos",
    70,
  );
  await runScenario(
    auth,
    "db-unavailable",
    "Observability Lab: banco de negócio indisponível",
    70,
  );
  await runScenario(
    auth,
    "db-error",
    "Observability Lab: API de pedidos com erro",
    70,
  );
  await runScenario(
    auth,
    "db-slow",
    "Observability Lab: consulta ao banco acima de 2 segundos",
    90,
  );

  console.log("\nTodos os cenários produziram alerta e recuperação.");
}

main().catch(async (error) => {
  console.error(error);
  try {
    await setMode("healthy");
  } catch {}
  process.exit(1);
});
