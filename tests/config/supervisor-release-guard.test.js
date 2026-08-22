const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const supervisor = fs.readFileSync(path.join(root, "backend-supervisor.ps1"), "utf8");
const startBackend = fs.readFileSync(path.join(root, "start-backend.ps1"), "utf8");
const enterMaintenance = fs.readFileSync(path.join(root, "enter-backend-maintenance.ps1"), "utf8");
const resumeBackend = fs.readFileSync(path.join(root, "resume-backend.ps1"), "utf8");

function position(text, pattern) {
  const match = text.match(pattern);
  assert.ok(match, `missing ${pattern}`);
  return match.index;
}

test("supervisor honors an explicit maintenance flag before every backend start", () => {
  assert.match(supervisor, /patap-auth-maintenance\.flag/);
  assert.match(supervisor, /function Test-MaintenanceMode/);
  assert.match(supervisor, /Maintenance flag is active\. Supervisor will not start the backend/);
  assert.match(supervisor, /Maintenance flag detected\. Supervisor is exiting without restarting the backend/);
  assert.ok(
    position(supervisor, /if \(Test-MaintenanceMode\) \{ continue \}[\s\S]*Archive-Log/) <
      position(supervisor, /\$backend = Start-Process -FilePath "node\.exe"/),
    "maintenance check must occur before a new node process"
  );
});

test("supervisor opens a circuit breaker after bounded rapid backend crashes", () => {
  assert.match(supervisor, /\$quickExitThresholdSeconds = 15/);
  assert.match(supervisor, /\$quickExitWindowSeconds = 60/);
  assert.match(supervisor, /\$maximumQuickExits = 3/);
  assert.match(supervisor, /\$uptimeSeconds -lt \$quickExitThresholdSeconds/);
  assert.match(supervisor, /\$quickExitTimes\.Count -ge \$maximumQuickExits/);
  assert.match(supervisor, /Crash-loop circuit breaker OPEN\. Automatic restart stopped; manual inspection is required/);
  assert.match(supervisor, /finally \{[\s\S]*Remove-Item -LiteralPath \$backendPidFile[\s\S]*Remove-Item -LiteralPath \$supervisorPidFile/);
});

test("maintenance entry writes the guard before stopping only PATAP supervisor/backend processes", () => {
  const markerWrite = position(enterMaintenance, /Set-Content -LiteralPath \$maintenanceFlag/);
  const firstStop = position(enterMaintenance, /Stop-Process -Id \$process\.ProcessId/);
  assert.ok(markerWrite < firstStop, "maintenance marker must be durable before process stops begin");
  assert.match(enterMaintenance, /Name = 'powershell\.exe'/);
  assert.match(enterMaintenance, /CommandLine -like "\*backend-supervisor\.ps1\*"/);
  assert.match(enterMaintenance, /Name = 'node\.exe'/);
  assert.match(enterMaintenance, /CommandLine -like "\*server\*auth\*server\.js\*"/);
  assert.match(enterMaintenance, /Do not replace files or continue the release/);
});

test("normal start refuses maintenance and reports an unhealthy backend as failure", () => {
  const maintenanceCheck = position(startBackend, /Test-Path -LiteralPath \$maintenanceFlag/);
  const supervisorStart = position(startBackend, /Start-Process -FilePath "powershell\.exe"/);
  assert.ok(maintenanceCheck < supervisorStart);
  assert.match(startBackend, /Backend maintenance mode is active/);
  assert.match(startBackend, /if \(-not \$health\)[\s\S]*automatic restart may have been stopped by the crash-loop guard/);
  assert.match(startBackend, /exit 1/);
});

test("resume uses a child PowerShell and automatically relocks maintenance if start fails", () => {
  assert.match(resumeBackend, /if \(-not \(Test-Path -LiteralPath \$maintenanceFlag\)\)/);
  assert.match(resumeBackend, /Remove-Item -LiteralPath \$maintenanceFlag -Force/);
  assert.match(resumeBackend, /& powershell\.exe -NoProfile -ExecutionPolicy Bypass -File \$startScript/);
  assert.match(resumeBackend, /\$exitCode = \$LASTEXITCODE/);
  assert.match(resumeBackend, /automatic-relock-after-failed-resume/);
  assert.match(resumeBackend, /maintenance mode was re-enabled/);
});

test("release-control scripts never open or modify SQLite directly", () => {
  for (const [name, source] of Object.entries({ supervisor, startBackend, enterMaintenance, resumeBackend })) {
    assert.doesNotMatch(source, /patap-auth\.sqlite|DatabaseSync|sqlite3|server\\auth\\db|server\/auth\/db/i, `${name} must not touch SQLite directly`);
  }
});
