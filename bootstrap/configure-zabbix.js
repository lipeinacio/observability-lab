const endpoint = "http://zabbix-web:8080/api_jsonrpc.php";
const { hosts, triggers } = require("./zabbix-resources");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(method, params, auth) {
  const response = await fetch(endpoint, {
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

async function waitForApi() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      await api("apiinfo.version", {});
      return;
    } catch {
      console.log(`Aguardando Zabbix API (${attempt}/60)...`);
      await sleep(5000);
    }
  }
  throw new Error("Zabbix API não ficou disponível");
}

async function ensureGroup(auth, name) {
  const groups = await api("hostgroup.get", { filter: { name } }, auth);
  if (groups.length) return groups[0].groupid;
  return (await api("hostgroup.create", { name }, auth)).groupids[0];
}

async function ensureHost(auth, host, groupid, interfaces = []) {
  const existing = await api("host.get", { filter: { host: host.host } }, auth);
  if (existing.length) {
    await api("host.update", {
      hostid: existing[0].hostid,
      name: host.name,
      description: host.description,
      tags: host.tags,
    }, auth);
    return existing[0].hostid;
  }
  return (await api("host.create", {
    host: host.host,
    name: host.name,
    description: host.description,
    tags: host.tags,
    groups: [{ groupid }],
    interfaces,
  }, auth)).hostids[0];
}

async function getMainInterface(auth, hostid, type) {
  const interfaces = await api("hostinterface.get", {
    hostids: hostid,
    filter: { type, main: 1 },
  }, auth);
  if (!interfaces.length) throw new Error(`Interface tipo ${type} não encontrada`);
  return interfaces[0].interfaceid;
}

async function ensureItem(auth, hostid, interfaceid, item) {
  const items = await api("item.get", { hostids: hostid, filter: { key_: item.key_ } }, auth);
  if (!items.length) {
    await api("item.create", { hostid, interfaceid, ...item }, auth);
    return;
  }
  await api("item.update", {
    itemid: items[0].itemid,
    name: item.name,
    delay: item.delay,
    ...(item.units ? { units: item.units } : {}),
  }, auth);
}

async function ensureWebScenario(
  auth,
  hostid,
  name,
  stepName,
  url,
  delay = "10s",
) {
  const scenarios = await api("httptest.get", {
    hostids: hostid,
    filter: { name },
    output: ["httptestid", "name", "delay", "retries"],
    selectSteps: ["name", "url", "status_codes", "timeout"],
  }, auth);
  const definition = {
    name,
    delay,
    retries: 1,
    steps: [{
      name: stepName,
      no: 1,
      url,
      status_codes: "200",
      timeout: "5s",
    }],
  };
  if (scenarios.length) {
    const current = scenarios[0];
    const currentStep = current.steps[0];
    const desiredStep = definition.steps[0];
    const unchanged =
      current.delay === definition.delay &&
      Number(current.retries) === definition.retries &&
      currentStep?.name === desiredStep.name &&
      currentStep?.url === desiredStep.url &&
      currentStep?.status_codes === desiredStep.status_codes &&
      currentStep?.timeout === desiredStep.timeout;
    if (unchanged) return;
    await api("httptest.update", {
      httptestid: scenarios[0].httptestid,
      ...definition,
    }, auth);
    return;
  }
  await api("httptest.create", { hostid, ...definition }, auth);
}

async function ensureTrigger(auth, trigger) {
  const descriptions = [trigger.description, ...(trigger.aliases || [])];
  const existing = await api("trigger.get", {
    filter: { description: descriptions },
    output: ["triggerid", "description"],
  }, auth);
  const definition = {
    description: trigger.description,
    expression: trigger.expression,
    priority: trigger.priority,
    comments: trigger.comments,
    url: trigger.url,
    url_name: "Abrir runbook",
    opdata: "Último valor: {ITEM.LASTVALUE1}",
    tags: trigger.tags,
    manual_close: 0,
  };
  if (existing.length) {
    await api("trigger.update", {
      triggerid: existing[0].triggerid,
      ...definition,
    }, auth);
    return existing[0].triggerid;
  }
  return (await api("trigger.create", definition, auth)).triggerids[0];
}

async function reconcileDependencies(auth, triggerIds) {
  for (const [key, trigger] of Object.entries(triggers)) {
    const dependencies = (trigger.dependencyKeys || []).map((dependencyKey) => ({
      triggerid: triggerIds[dependencyKey],
    }));
    await api("trigger.update", {
      triggerid: triggerIds[key],
      dependencies,
    }, auth);
  }
}

async function main() {
  await waitForApi();
  const auth = await api("user.login", { username: "Admin", password: "zabbix" });
  const groupid = await ensureGroup(auth, "Observability Lab");
  const defaultHosts = await api("host.get", { filter: { host: "Zabbix server" } }, auth);
  if (defaultHosts.length && defaultHosts[0].status !== "1") {
    await api("host.update", { hostid: defaultHosts[0].hostid, status: 1 }, auth);
  }

  const appHost = await ensureHost(auth, hosts.application, groupid);
  await ensureWebScenario(
    auth,
    appHost,
    "App readiness",
    "Readiness endpoint",
    "http://app:18080/health/ready",
  );
  await ensureWebScenario(
    auth,
    appHost,
    "App work",
    "Work endpoint",
    "http://app:18080/work",
  );
  await ensureWebScenario(
    auth,
    appHost,
    "Business database health",
    "Database health endpoint",
    "http://app:18080/health/db",
    "5s",
  );
  await ensureWebScenario(
    auth,
    appHost,
    "Orders API",
    "List orders",
    "http://app:18080/api/orders",
  );
  const triggerIds = {};
  for (const [key, trigger] of Object.entries(triggers)) {
    triggerIds[key] = await ensureTrigger(auth, trigger);
  }
  await reconcileDependencies(auth, triggerIds);

  const agentHost = await ensureHost(auth, hosts.linux, groupid, [{
    type: 1, main: 1, useip: 0, ip: "", dns: "zabbix-agent2", port: "10050",
  }]);
  const agentInterface = await getMainInterface(auth, agentHost, 1);
  await ensureItem(auth, agentHost, agentInterface, {
    name: "Linux: carga média de CPU em 1 minuto",
    key_: "system.cpu.load[all,avg1]",
    type: 0,
    value_type: 0,
    delay: "10s",
  });
  await ensureItem(auth, agentHost, agentInterface, {
    name: "Linux: memória disponível",
    key_: "vm.memory.size[available]",
    type: 0,
    value_type: 3,
    units: "B",
    delay: "10s",
  });

  const snmpHost = await ensureHost(auth, hosts.snmp, groupid, [{
    type: 2,
    main: 1,
    useip: 0,
    ip: "",
    dns: "snmp-target",
    port: "1161",
    details: { version: 2, bulk: 1, community: "observability" },
  }]);
  const snmpInterface = await getMainInterface(auth, snmpHost, 2);
  await ensureItem(auth, snmpHost, snmpInterface, {
    name: "SNMP: nome do equipamento",
    key_: "snmp.sysName",
    type: 20,
    value_type: 1,
    snmp_oid: "1.3.6.1.2.1.1.5.0",
    delay: "30s",
  });
  await ensureItem(auth, snmpHost, snmpInterface, {
    name: "SNMP: tempo de atividade",
    key_: "snmp.sysUpTime",
    type: 20,
    value_type: 3,
    units: "uptime",
    snmp_oid: "1.3.6.1.2.1.1.3.0",
    delay: "30s",
  });

  console.log(
    "Zabbix reconciliado: hosts, itens, cenários, triggers, tags e correlação.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
