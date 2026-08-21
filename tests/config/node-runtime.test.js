const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SUPPORTED_NODE_MAJOR,
  parseNodeMajor,
  isSupportedNode,
  assertSupportedNode
} = require("../../runtime/node-policy");

const root = path.resolve(__dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "verify.yml"), "utf8");
const supervisor = fs.readFileSync(path.join(root, "backend-supervisor.ps1"), "utf8");
const nvmrc = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
const nodeVersion = fs.readFileSync(path.join(root, ".node-version"), "utf8").trim();

test("Node policy accepts only the supported LTS major", () => {
  assert.equal(SUPPORTED_NODE_MAJOR, 24);
  assert.equal(parseNodeMajor("v24.19.0"), 24);
  assert.equal(parseNodeMajor("24.16.0"), 24);
  assert.equal(parseNodeMajor("bad"), null);
  assert.equal(isSupportedNode("22.23.2"), false);
  assert.equal(isSupportedNode("24.0.0"), true);
  assert.equal(isSupportedNode("24.99.1"), true);
  assert.equal(isSupportedNode("25.0.0"), false);
  assert.throws(() => assertSupportedNode("22.23.2"), (error) => error?.code === "PATAP_UNSUPPORTED_NODE_RUNTIME");
});

test("repository metadata, CI and verification agree on Node 24", () => {
  assert.equal(pkg.engines.node, ">=24 <25");
  assert.equal(nvmrc, "24");
  assert.equal(nodeVersion, "24");
  assert.match(pkg.scripts.verify, /^npm run runtime:check &&/);
  assert.match(pkg.scripts["auth:start"], /^npm run runtime:check &&/);
  const nodePins = [...workflow.matchAll(/node-version:\s*['"]?(\d+)/g)].map((match) => Number(match[1]));
  assert.ok(nodePins.length >= 2);
  assert.deepEqual([...new Set(nodePins)], [24]);
});

test("Windows supervisor fails once instead of restart-looping on a wrong Node major", () => {
  assert.match(supervisor, /\$supportedNodeMajor\s*=\s*24/);
  assert.match(supervisor, /Test-SupportedNodeRuntime/);
  assert.match(supervisor, /Supervisor will not start a restart loop/);
  assert.match(supervisor, /if \(-not \(Test-SupportedNodeRuntime\)\)[\s\S]*exit 1/);
});

test("the runtime executing this mandatory suite is Node 24", () => {
  assert.equal(parseNodeMajor(process.versions.node), 24, `tests are running under unsupported Node ${process.version}`);
  assert.equal(assertSupportedNode(), true);
});
