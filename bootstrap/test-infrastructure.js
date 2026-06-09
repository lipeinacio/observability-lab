const prometheusUrl =
  process.env.PROMETHEUS_URL || "http://127.0.0.1:9090";

async function query(expression) {
  const params = new URLSearchParams({ query: expression });
  const response = await fetch(`${prometheusUrl}/api/v1/query?${params}`);
  if (!response.ok) {
    throw new Error(`Prometheus respondeu HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body.status !== "success") {
    throw new Error(`Consulta falhou: ${JSON.stringify(body)}`);
  }
  return body.data.result;
}

async function requireSeries(name, expression, predicate) {
  const result = await query(expression);
  if (!result.length) {
    throw new Error(`${name}: nenhuma série encontrada`);
  }

  const value = Number(result[0].value[1]);
  if (!predicate(value)) {
    throw new Error(`${name}: valor inesperado ${value}`);
  }
  console.log(`${name}: ${value}`);
}

async function main() {
  await requireSeries(
    "node-exporter disponível",
    'up{job="node-exporter"}',
    (value) => value === 1,
  );
  await requireSeries(
    "memória total coletada",
    "node_memory_MemTotal_bytes",
    (value) => value > 0,
  );
  await requireSeries(
    "sonda HTTP disponível",
    'probe_success{job="blackbox-http"}',
    (value) => value === 1,
  );
  await requireSeries(
    "duração da sonda coletada",
    'probe_duration_seconds{job="blackbox-http"}',
    (value) => value >= 0,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
