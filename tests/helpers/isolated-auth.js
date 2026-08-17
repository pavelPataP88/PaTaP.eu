const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..", "..");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const { port } = socket.address();
      socket.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await waitForExit(child, 3000);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child, 3000);
  }
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test auth server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test auth server did not become healthy");
}

async function createIsolatedAuth() {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "patap-auth-test-"));
  const port = await getFreePort();
  const runId = `${Date.now().toString(36)}${process.pid.toString(36)}`;
  const env = {
    ...process.env,
    PATAP_DB_PATH: path.join(runDir, "auth.sqlite"),
    PATAP_AUTH_SECRET_PATH: path.join(runDir, "auth-secret.key"),
    PATAP_AUTH_PORT: String(port),
    PATAP_TEST_RUN_ID: runId,
    PATAP_TEST_PARENT_PID: String(process.pid)
  };
  const child = spawn(process.execPath, [path.join(root, "server", "auth", "server.js")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("exit", (code) => {
    if (code !== 0 && stderr.trim()) console.error(`Isolated auth backend exited (${code}): ${stderr.trim()}`);
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, child);
  } catch (error) {
    await stopChild(child);
    fs.rmSync(runDir, { recursive: true, force: true });
    throw new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ""}`);
  }
  let cleaned = false;
  return {
    root, runDir, runId, port, baseUrl, env, child,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await stopChild(child);
      fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

module.exports = { createIsolatedAuth, getFreePort, stopChild };
