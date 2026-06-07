const appUrl = "http://127.0.0.1:18080";
const lokiUrl = "http://127.0.0.1:3100";

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

async function provokeDatabaseError() {
  const response = await fetch(`${appUrl}/api/orders`);
  if (response.status !== 500) {
    throw new Error(`Esperava HTTP 500, recebeu ${response.status}`);
  }
  const requestId = response.headers.get("x-request-id");
  if (!requestId) throw new Error("Resposta não trouxe x-request-id");
  return requestId;
}

async function findLog(requestId) {
  const query = `{compose_service="app"} |= "${requestId}"`;
  const params = new URLSearchParams({
    query,
    limit: "20",
    direction: "backward",
  });
  const response = await fetch(`${lokiUrl}/loki/api/v1/query_range?${params}`);
  if (!response.ok) throw new Error(`Loki respondeu HTTP ${response.status}`);
  const body = await response.json();
  return body.data.result.flatMap((stream) => stream.values);
}

async function main() {
  await setMode("db-error");
  const requestId = await provokeDatabaseError();
  console.log(`request_id capturado: ${requestId}`);

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const logs = await findLog(requestId);
    if (logs.length >= 2) {
      console.log(`Loki encontrou ${logs.length} logs correlacionados.`);
      console.log(logs.map((entry) => entry[1]).join("\n"));
      await setMode("healthy");
      return;
    }
    await sleep(1000);
  }

  throw new Error(`request_id ${requestId} não chegou ao Loki`);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await setMode("healthy");
  } catch {}
  process.exit(1);
});
