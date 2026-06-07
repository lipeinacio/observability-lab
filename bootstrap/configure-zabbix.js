const endpoint = "http://zabbix-web:8080/api_jsonrpc.php";

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
  const hosts = await api("host.get", { filter: { host } }, auth);
  if (hosts.length) return hosts[0].hostid;
  return (await api("host.create", {
    host,
    name: host,
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
  if (!items.length) await api("item.create", { hostid, interfaceid, ...item }, auth);
}

async function ensureWebScenario(auth, hostid, name, stepName, url) {
  const scenarios = await api("httptest.get", { hostids: hostid, filter: { name } }, auth);
  if (scenarios.length) return;
  await api("httptest.create", {
    name,
    hostid,
    delay: "10s",
    steps: [{
      name: stepName,
      no: 1,
      url,
      status_codes: "200",
      timeout: "5s",
    }],
  }, auth);
}

async function ensureTrigger(auth, description, expression, priority) {
  const triggers = await api("trigger.get", { filter: { description } }, auth);
  if (!triggers.length) {
    await api("trigger.create", { description, expression, priority }, auth);
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

  const appHost = await ensureHost(auth, "observability-lab", groupid);
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
  );
  await ensureWebScenario(
    auth,
    appHost,
    "Orders API",
    "List orders",
    "http://app:18080/api/orders",
  );
  await ensureTrigger(
    auth,
    "Observability Lab: aplicação indisponível",
    "last(/observability-lab/web.test.fail[App readiness])<>0",
    4,
  );
  await ensureTrigger(
    auth,
    "Observability Lab: operação principal com erro",
    "last(/observability-lab/web.test.fail[App work])<>0",
    4,
  );
  await ensureTrigger(
    auth,
    "Observability Lab: latência acima de 2 segundos",
    "avg(/observability-lab/web.test.time[App readiness,Readiness endpoint,resp],30s)>2",
    3,
  );
  await ensureTrigger(
    auth,
    "Observability Lab: operação principal acima de 2 segundos",
    "avg(/observability-lab/web.test.time[App work,Work endpoint,resp],30s)>2",
    3,
  );
  await ensureTrigger(
    auth,
    "Observability Lab: banco de negócio indisponível",
    "last(/observability-lab/web.test.fail[Business database health])<>0",
    4,
  );
  await ensureTrigger(
    auth,
    "Observability Lab: API de pedidos com erro",
    "last(/observability-lab/web.test.fail[Orders API])<>0",
    4,
  );
  await ensureTrigger(
    auth,
    "Observability Lab: consulta ao banco acima de 2 segundos",
    "avg(/observability-lab/web.test.time[Business database health,Database health endpoint,resp],30s)>2",
    3,
  );

  const agentHost = await ensureHost(auth, "lab-target", groupid, [{
    type: 1, main: 1, useip: 0, ip: "", dns: "zabbix-agent2", port: "10050",
  }]);
  const agentInterface = await getMainInterface(auth, agentHost, 1);
  await ensureItem(auth, agentHost, agentInterface, {
    name: "CPU load 1 minute",
    key_: "system.cpu.load[all,avg1]",
    type: 0,
    value_type: 0,
    delay: "10s",
  });
  await ensureItem(auth, agentHost, agentInterface, {
    name: "Available memory",
    key_: "vm.memory.size[available]",
    type: 0,
    value_type: 3,
    units: "B",
    delay: "10s",
  });

  const snmpHost = await ensureHost(auth, "lab-snmp-target", groupid, [{
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
    name: "SNMP system name",
    key_: "snmp.sysName",
    type: 20,
    value_type: 1,
    snmp_oid: "1.3.6.1.2.1.1.5.0",
    delay: "30s",
  });
  await ensureItem(auth, snmpHost, snmpInterface, {
    name: "SNMP uptime",
    key_: "snmp.sysUpTime",
    type: 20,
    value_type: 3,
    units: "uptime",
    snmp_oid: "1.3.6.1.2.1.1.3.0",
    delay: "30s",
  });

  console.log("Zabbix configurado: aplicação, agente, SNMP, web scenario e triggers.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
