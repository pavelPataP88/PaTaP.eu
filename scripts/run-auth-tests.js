const path = require("path");
const { spawn } = require("child_process");
const { createIsolatedAuth, stopChild } = require("../tests/helpers/isolated-auth");

let environment;
let testProcess;
let cleaning = false;
const timeout = setTimeout(() => {
  console.error("Auth test run exceeded 120 seconds.");
  cleanup().finally(() => process.exit(1));
}, 120000);

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  await stopChild(testProcess);
  if (environment) await environment.cleanup();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => cleanup().finally(() => process.exit(128)));
}

(async () => {
  let exitCode = 1;
  try {
    environment = await createIsolatedAuth();
    testProcess = spawn(process.execPath, [
      "--test-concurrency=1",
      "--test",
      path.join("tests", "auth", "migration-atomicity.test.js"),
      path.join("tests", "auth", "api.test.js"),
      path.join("tests", "auth", "disaster-recovery.test.js"),
      path.join("tests", "auth", "session-touch.test.js"),
      path.join("tests", "auth", "chat-reactions.test.js"),
      path.join("tests", "auth", "chat-console.test.js"),
      path.join("tests", "auth", "people-communities.test.js"),
      path.join("tests", "auth", "location-privacy.test.js"),
      path.join("tests", "auth", "parking-network.test.js"),
      path.join("tests", "auth", "event-outbox-deadletter.test.js"),
      path.join("tests", "auth", "event-center.test.js"),
      path.join("tests", "auth", "radio-reliability.test.js"),
      path.join("tests", "auth", "radio-console.test.js"),
      path.join("tests", "auth", "radio-moderation.test.js"),
      path.join("tests", "auth", "road-reports.test.js")
    ], {
      cwd: environment.root,
      env: { ...environment.env, PATAP_AUTH_BASE_URL: environment.baseUrl },
      stdio: "inherit",
      windowsHide: true
    });
    exitCode = await new Promise((resolve, reject) => {
      testProcess.once("error", reject);
      testProcess.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    });
  } catch (error) {
    console.error(error);
  } finally {
    clearTimeout(timeout);
    await cleanup();
  }
  process.exitCode = exitCode;
})();
