const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const projectDir = path.join(__dirname, "..");
const port = 18081;

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start");
}

test("distinguishes liveness from readiness", async (context) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "observability-lab-"));
  const stateFile = path.join(tempDir, "failure-mode");
  const child = spawn("node", ["src/server.js"], {
    cwd: projectDir,
    env: {
      ...processEnv(),
      PORT: String(port),
      STATE_FILE: stateFile,
      DB_REQUIRED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout.on("data", (data) => {
    childOutput += data;
  });
  child.stderr.on("data", (data) => {
    childOutput += data;
  });

  context.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 1000);
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  try {
    await waitForServer();
  } catch (error) {
    throw new Error(`${error.message}\n${childOutput}`);
  }

  const live = await fetch(`http://127.0.0.1:${port}/health/live`);
  assert.equal(live.status, 200);

  fs.writeFileSync(stateFile, "unhealthy\n");

  const unhealthyLive = await fetch(`http://127.0.0.1:${port}/health/live`);
  const unhealthyReady = await fetch(`http://127.0.0.1:${port}/health/ready`);
  assert.equal(unhealthyLive.status, 200);
  assert.equal(unhealthyReady.status, 503);
});

function processEnv() {
  return globalThis.process.env;
}
