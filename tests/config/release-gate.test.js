const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "verify.yml"), "utf8");
const browser = fs.readFileSync(path.join(root, "scripts", "run-browser-test.js"), "utf8");
const driverE2e = fs.readFileSync(path.join(root, "scripts", "run-driver-e2e.js"), "utf8");
const publicSmoke = fs.readFileSync(path.join(root, "scripts", "run-public-smoke.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("candidate branches and pull requests receive a deterministic release gate", () => {
  assert.match(workflow, /- main/);
  assert.match(workflow, /chatgpt\/\*\*/);
  assert.match(workflow, /codex\/\*\*/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /npm run verify:release/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /permissions:\s*[\s\S]*contents:\s*read/);
  assert.doesNotMatch(workflow, /\b(deploy|scp|rsync|cloudflared tunnel run|Start-Process|restart-service)\b/i);
});

test("CI action runtimes stay on the reviewed v7 majors", () => {
  const checkoutUses = [...workflow.matchAll(/actions\/checkout@(v\d+)/g)].map((match) => match[1]);
  const setupNodeUses = [...workflow.matchAll(/actions\/setup-node@(v\d+)/g)].map((match) => match[1]);
  assert.ok(checkoutUses.length >= 2);
  assert.ok(setupNodeUses.length >= 2);
  assert.deepEqual([...new Set(checkoutUses)], ["v7"]);
  assert.deepEqual([...new Set(setupNodeUses)], ["v7"]);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v[1-6]\b/);
});

test("release verification requires Driver E2E plus isolated browser scenarios without public internet", () => {
  assert.equal(pkg.scripts["test:browser:local"], "node scripts/run-browser-test.js --local-only");
  assert.equal(pkg.scripts["test:driver-e2e"], "node scripts/build.js && node scripts/run-driver-e2e.js");
  assert.equal(pkg.scripts["verify:release"], "npm run verify && npm run test:driver-e2e && npm run test:browser:local");
  assert.match(browser, /process\.argv\.includes\("--local-only"\)/);
  assert.match(browser, /if \(!localOnly\)[\s\S]*https:\/\/patap\.eu/);
  assert.match(browser, /Public patap\.eu smoke skipped; running deterministic local browser scenarios only/);
  assert.match(driverE2e, /browser\.newContext\(/);
  assert.match(driverE2e, /permissions:\s*\["geolocation"\]/);
  assert.match(driverE2e, /Driver E2E PASS:/);
  assert.match(workflow, /windows-driver-e2e:/);
  assert.match(workflow, /runs-on:\s*windows-2025/);
  assert.match(workflow, /Windows Driver E2E[\s\S]*npm run test:driver-e2e/);
  const quiesceAt = driverE2e.indexOf("await quiescePagesForBackendRestart([pageA, pageB])");
  const stopAt = driverE2e.indexOf("await stopChild(auth.child)");
  const restoreAt = driverE2e.indexOf("await restorePagesAfterBackendRestart([pageA, pageB], localUrl)");
  assert.ok(quiesceAt >= 0 && quiesceAt < stopAt, "planned backend restart must quiesce browser streams before stop");
  assert.ok(stopAt < restoreAt, "browser sessions must restore only after the restarted backend is healthy");
  assert.match(driverE2e, /setTimeout\(resolve, 3500\)/);
  assert.match(driverE2e, /assert\.deepEqual\(errors, \[\]/);
  assert.doesNotMatch(driverE2e, /https:\/\/(?:patap\.eu|driver\.patap\.eu)/);
});

test("public availability remains visible as a separate non-blocking signal", () => {
  assert.equal(pkg.scripts["test:public-smoke"], "node scripts/run-public-smoke.js");
  assert.match(workflow, /public-smoke-nonblocking/);
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /node scripts\/run-public-smoke\.js/);
  assert.match(publicSmoke, /https:\/\/patap\.eu/);
  assert.match(publicSmoke, /https:\/\/driver\.patap\.eu/);
  assert.match(publicSmoke, /PUBLIC_SMOKE/);
  assert.match(publicSmoke, /"PASS"/);
  assert.match(publicSmoke, /"FAIL"/);
  assert.match(publicSmoke, /PUBLIC_SMOKE SUMMARY/);
});