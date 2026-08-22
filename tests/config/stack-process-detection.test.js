const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");
const helper = fs.readFileSync(path.join(root, "patap-processes.ps1"), "utf8");
const stack = fs.readFileSync(path.join(root, "start-patap-stack.ps1"), "utf8");
const tunnel = fs.readFileSync(path.join(root, "start-patap-tunnel.ps1"), "utf8");
const origin = fs.readFileSync(path.join(root, "start-origin.ps1"), "utf8");

test("PaTaP tunnel detection requires tunnel run and the exact token-file argument", () => {
  assert.match(helper, /function Get-PatapTunnelProcess/);
  assert.match(helper, /tunnel\\s\+run/);
  assert.match(helper, /Test-PatapCommandLineArgumentPath \$command '--token-file' \$TokenFile/);
  assert.match(helper, /\[string\]::Equals\([\s\S]*OrdinalIgnoreCase/);
  assert.match(stack, /Get-PatapTunnelProcess \$tokenFile/);
  assert.doesNotMatch(stack, /Get-Process cloudflared/);
  assert.doesNotMatch(stack, /return \[bool\]\(Get-Process cloudflared/);
});

test("tunnel startup verifies the exact launched PID instead of any cloudflared process", () => {
  assert.match(tunnel, /Start-Process[\s\S]*-PassThru/);
  assert.match(tunnel, /Get-PatapTunnelProcess \$tokenFile/);
  assert.match(tunnel, /\$exact\.ProcessId -ne \$started\.Id/);
  assert.doesNotMatch(tunnel, /Get-Process cloudflared -ErrorAction Stop \|/);
});

test("PaTaP Caddy detection is bound to the repository config and rejects a foreign port owner", () => {
  assert.match(helper, /function Get-PatapCaddyProcess/);
  assert.match(helper, /Test-PatapCommandLineArgumentPath \$command '--config' \$ConfigFile/);
  assert.match(stack, /Get-PatapCaddyProcess \$caddyConfig/);
  assert.match(origin, /Get-NetTCPConnection -LocalPort 8090 -State Listen/);
  assert.match(origin, /Port 8090 is already occupied by PID/);
  assert.match(origin, /\$existing\.ProcessId -ne \$started\.Id/);
});

test("Caddy resolution is portable and contains no user-specific Windows profile path", () => {
  assert.match(helper, /PATAP_CADDY_EXE/);
  assert.match(helper, /Get-Command caddy\.exe/);
  assert.match(helper, /\$env:LOCALAPPDATA/);
  assert.match(helper, /Microsoft\\WinGet\\Packages\\CaddyServer\.Caddy/);
  for (const source of [helper, stack, tunnel, origin]) {
    assert.doesNotMatch(source, /C:\\Users\\Biuro/i);
  }
});

test("cloudflared resolution supports explicit override, PATH, and standard Program Files locations", () => {
  assert.match(helper, /PATAP_CLOUDFLARED_EXE/);
  assert.match(helper, /Get-Command cloudflared\.exe/);
  assert.match(helper, /ProgramFiles\(x86\)/);
  assert.match(helper, /ProgramFiles/);
});
