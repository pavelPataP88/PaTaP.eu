const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const install = fs.readFileSync(path.join(root, "install-autostart.ps1"), "utf8");
const uninstall = fs.readFileSync(path.join(root, "uninstall-autostart.ps1"), "utf8");
const installCmd = fs.readFileSync(path.join(root, "install-autostart.cmd"), "utf8");
const uninstallCmd = fs.readFileSync(path.join(root, "uninstall-autostart.cmd"), "utf8");

test("Windows autostart uses a scoped Scheduled Task instead of copying a launcher into Startup", () => {
  assert.match(install, /Register-ScheduledTask/);
  assert.match(install, /New-ScheduledTaskTrigger\s+-AtLogOn/);
  assert.match(install, /New-ScheduledTaskPrincipal[\s\S]*-LogonType\s+Interactive[\s\S]*-RunLevel\s+Limited/);
  assert.match(install, /start-patap-stack\.ps1/);
  assert.match(install, /-StartWhenAvailable/);
  assert.match(install, /-RestartCount\s+3/);
  assert.match(install, /-MultipleInstances\s+IgnoreNew/);
  assert.match(install, /Patap Lab Stack\.cmd/);
  assert.match(install, /Remove-Item[\s\S]*legacyStartup/);
  assert.doesNotMatch(install, /Copy-Item[\s\S]*Startup/i);
});

test("autostart wrappers call the repository PowerShell installers and uninstall removes legacy state", () => {
  assert.match(installCmd, /install-autostart\.ps1/i);
  assert.match(uninstallCmd, /uninstall-autostart\.ps1/i);
  assert.match(uninstall, /Unregister-ScheduledTask/);
  assert.match(uninstall, /Patap Lab Stack\.cmd/);
  assert.match(uninstall, /Remove-Item[\s\S]*legacyStartup/);
});
