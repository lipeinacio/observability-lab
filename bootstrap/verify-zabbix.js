const endpoint = process.env.ZABBIX_URL || "http://127.0.0.1:8080/api_jsonrpc.php";

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

async function main() {
  const auth = await api("user.login", { username: "Admin", password: "zabbix" });
  const hosts = await api("host.get", {
    filter: { host: ["observability-lab", "lab-target", "lab-snmp-target"] },
    output: ["hostid", "host", "name", "description", "available", "snmp_available"],
    selectTags: "extend",
  }, auth);
  for (const host of hosts) {
    host.items = await api("item.get", {
      hostids: host.hostid,
      output: ["name", "key_", "lastvalue", "error", "state"],
      sortfield: "name",
    }, auth);
    host.webScenarios = await api("httptest.get", {
      hostids: host.hostid,
      output: ["name", "delay", "status"],
      selectSteps: ["name", "url", "status_codes", "timeout"],
      sortfield: "name",
    }, auth);
  }
  const triggers = await api("trigger.get", {
    hostids: hosts.map((host) => host.hostid),
    output: [
      "triggerid",
      "description",
      "value",
      "priority",
      "comments",
      "url",
      "url_name",
      "opdata",
    ],
    selectTags: "extend",
    selectDependencies: ["triggerid", "description"],
  }, auth);
  const problems = await api("problem.get", {
    output: ["name", "severity", "clock"],
    objectids: triggers.map((trigger) => trigger.triggerid),
    sortfield: ["eventid"],
    sortorder: "DESC",
    limit: 10,
  }, auth);

  console.log(JSON.stringify({ hosts, triggers, problems }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
