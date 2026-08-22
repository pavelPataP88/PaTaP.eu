const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const watch = fs.readFileSync(path.join(root, "watch-patap-health.ps1"), "utf8");
const startWatch = fs.readFileSync(path.join(root, "start-patap-health-watch.ps1"), "utf8");
const stopWatch = fs.readFileSync(path.join(root, "stop-patap-health-watch.ps1"), "utf8");
const startStack = fs.readFileSync(path.join(root, "start-patap-stack.ps1"), "utf8");

test("continuous health watch is observable, bounded and maintenance-aware", () => {
  assert.match(watch, /status-patap-stack\.ps1/);
  assert.match(watch, /patap-health-watch\.json/);
  assert.match(watch, /patap-health-watch\.log/);
  assert.match(watch, /FailureThreshold\s*=\s*3/);
  assert.match(watch, /consecutiveUnhealthy/);
  assert.match(watch, /effective\s*=\s*"ALERT"/);
  assert.match(watch, /patap-auth-maintenance\.flag/);
  assert.match(watch, /overall\s*=\s*"MAINTENANCE"/);
  assert.match(watch, /Move-Item[\s\S]*latestFile[\s\S]*-Force/);
  assert.match(watch, /maxArchivedLogs\s*=\s*5/);
});

test("health watch observes only and never competes with the backend supervisor", () => {
  assert.doesNotMatch(watch, /start-backend\.ps1|start-origin\.ps1|start-patap-tunnel\.ps1/i);
  assert.doesNotMatch(watch, /Restart-Service|Stop-Service|Stop-Process|Start-Process/i);
  assert.match(startWatch, /watch-patap-health\.ps1/);
  assert.match(stopWatch, /refusing to stop it/);
  assert.match(stopWatch, /Stop-Process\s+-Id\s+\$watchPid/);
});

test("normal PaTaP stack startup also starts and reports the health watch", () => {
  assert.match(startStack, /start-patap-health-watch\.ps1/);
  assert.match(startStack, /HealthWatchRunning/);
  assert.match(startStack, /Test-HealthWatchProcess/);
});
