const zabbixUrl = "http://127.0.0.1:8080/api_jsonrpc.php";
const appUrl = "http://127.0.0.1:18080";
const { triggers } = require("./zabbix-resources");

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

async function activeProblems(auth) {
  const problems = await api("problem.get", {
    output: ["name", "suppressed"],
    recent: false,
    selectSuppressionData: "extend",
  }, auth);
  return problems;
}

async function assertProblemVisibility(auth, expected, suppressed = []) {
  await sleep(2000);
  const problems = await activeProblems(auth);
  const visible = problems
    .filter((problem) => problem.suppressed === "0")
    .map((problem) => problem.name);
  const suppressedProblems = problems
    .filter((problem) => problem.suppressed === "1")
    .map((problem) => problem.name);
  for (const description of expected) {
    if (!visible.includes(description)) {
      throw new Error(
        `Problema esperado não está visível: ${description}. Visíveis: ${visible.join(", ")}`,
      );
    }
  }
  for (const description of suppressed) {
    if (visible.includes(description)) {
      throw new Error(`Sintoma deveria estar suprimido: ${description}`);
    }
  }
  console.log(`PROBLEMAS VISÍVEIS: ${visible.join(", ")}`);
  if (suppressedProblems.length) {
    console.log(`PROBLEMAS SUPRIMIDOS: ${suppressedProblems.join(", ")}`);
  }
}

async function runScenario(
  auth,
  mode,
  trigger,
  timeoutSeconds = 45,
  suppressed = [],
) {
  console.log(`\nCenário: ${mode}`);
  await setMode(mode);
  await waitForTrigger(auth, trigger, "1", timeoutSeconds);
  console.log(`ALERTA: ${trigger}`);
  for (const description of suppressed) {
    await waitForTrigger(auth, description, "0", 20);
  }
  await assertProblemVisibility(auth, [trigger], suppressed);

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
    triggers.appReadinessUnavailable.description,
  );
  await runScenario(
    auth,
    "error",
    triggers.appWorkError.description,
  );
  await runScenario(
    auth,
    "slow",
    triggers.appWorkSlow.description,
    70,
  );
  await runScenario(
    auth,
    "db-unavailable",
    triggers.databaseUnavailable.description,
    70,
    [
      triggers.appReadinessUnavailable.description,
      triggers.ordersApiError.description,
    ],
  );
  await runScenario(
    auth,
    "db-error",
    triggers.databaseError.description,
    70,
    [
      triggers.appReadinessUnavailable.description,
      triggers.ordersApiError.description,
    ],
  );
  await runScenario(
    auth,
    "db-slow",
    triggers.databaseSlow.description,
    90,
    [triggers.appReadinessSlow.description],
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
