const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("whole-machine backup is maintenance-gated and resumes only maintenance it entered", () => {
  const script = read("backup-machine-recovery.ps1");
  assert.match(script, /PATAP_MACHINE_DR_EXPORT_DIR/);
  assert.match(script, /PATAP_DR_KEY_FILE/);
  assert.match(script, /enter-backend-maintenance\.ps1/);
  assert.match(script, /export-machine-recovery\.js/);
  assert.match(script, /if \(\$enteredMaintenance\)[\s\S]*resume-backend\.ps1/);
  assert.doesNotMatch(script, /Remove-Item[\s\S]*data\\/i, "backup wrapper must not clean user data");
});

test("whole-machine restore is explicit, non-overwriting and never activates public traffic automatically", () => {
  const restore = read("scripts/restore-machine-recovery.js");
  const core = read("server/recovery/machine-dr.js");
  assert.match(restore, /PATAP_RECOVERY_TARGET_ROOT/);
  assert.match(core, /PATAP_MACHINE_RECOVERY_CONFIRM/);
  assert.match(core, /machine_recovery_refuses_overwrite/);
  assert.match(core, /publicActivationRequired:\s*true/);
  assert.match(core, /const required = \["package\.json", "start-patap-stack\.ps1", "Caddyfile\.tunnel"\]/);
  assert.doesNotMatch(core, /child_process|spawnSync|\bspawn\s*\(|execFile|execSync|Start-Process|powershell(?:\.exe)?\s+-/i);
});

test("whole-machine recovery preserves the private continuity boundary instead of committing it to GitHub", () => {
  const core = read("server/recovery/machine-dr.js");
  const ignore = read(".gitignore");
  assert.match(core, /data\/auth\/patap-auth\.sqlite/);
  assert.match(core, /data\/config\/auth-secret\.key/);
  assert.match(core, /external\/cloudflare\/patap-lab-token\.txt/);
  assert.match(core, /collectDataFiles/);
  assert.match(ignore, /^data\/$/m);
  assert.match(ignore, /^var\/$/m);
});
