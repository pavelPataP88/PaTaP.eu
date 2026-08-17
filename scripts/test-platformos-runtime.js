const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { PlatformOSRuntime } = require("../core/runtime");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "var", "test-runtime");

function resetFixture() {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(fixtureRoot, "system"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "modules"), { recursive: true });
}

function writeJson(relativePath, value) {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(relativePath, value = "") {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value, "utf8");
}

function createModule(id, options = {}) {
  const modulePath = `modules/${id}`;
  const route = options.route || `/${id}`;
  const manifest = {
    id,
    name: options.name || id,
    version: "0.1.0",
    status: options.status || "test",
    route,
    entry: "index.html",
    roles: ["Administrator"],
    permissions: [`${id}:open`],
    storage: ["modules"],
    description: `${id} test module`,
    ...options.manifestPatch,
  };

  if (!options.skipManifest) {
    writeJson(`${modulePath}/manifest.json`, manifest);
  }
  if (!options.skipIndex) writeText(`${modulePath}/index.html`, `<h1>${id}</h1>`);
  if (!options.skipStyles) writeText(`${modulePath}/styles.css`, "");
  if (!options.skipApp) writeText(`${modulePath}/app.js`, "");
  if (!options.skipReadme) writeText(`${modulePath}/README.md`, `# ${id}\n`);
}

function registry(modules) {
  writeJson("system/registry.json", {
    platform: "PlatformOS",
    version: "test",
    modules,
  });
}

function startFixture() {
  const runtime = new PlatformOSRuntime({ root: fixtureRoot });
  const snapshot = runtime.start();
  return { runtime, snapshot };
}

function testCurrentProject() {
  const runtime = new PlatformOSRuntime({ root });
  const snapshot = runtime.start();

  assert.deepStrictEqual(snapshot.enabledModules, ["lab"]);
  assert.deepStrictEqual(snapshot.disabledModules.sort(), ["library", "research", "transport"]);
  assert.strictEqual(snapshot.errors.length, 0);
  assert.strictEqual(snapshot.launcher.length, 1);
  assert.strictEqual(snapshot.launcher[0].id, "lab");

  const opened = runtime.openModule("lab");
  assert.strictEqual(opened.ok, true);
  assert.strictEqual(opened.module.entry, "modules/lab/index.html");

  const disabledOpen = runtime.openModule("transport");
  assert.strictEqual(disabledOpen.ok, false);
}

function testMissingModuleContinues() {
  resetFixture();
  createModule("good");
  registry([
    { id: "good", name: "Good", path: "modules/good", route: "/good", enabled: true },
    { id: "missing", name: "Missing", path: "modules/missing", route: "/missing", enabled: true },
  ]);

  const { runtime, snapshot } = startFixture();
  assert.deepStrictEqual(snapshot.enabledModules, ["good"]);
  assert.strictEqual(snapshot.errors.length > 0, true);
  assert.strictEqual(runtime.openModule("good").ok, true);
  assert.strictEqual(runtime.openModule("missing").ok, false);
}

function testBrokenManifestContinues() {
  resetFixture();
  createModule("good");
  writeText("modules/broken/manifest.json", "{ broken json");
  writeText("modules/broken/index.html", "");
  writeText("modules/broken/styles.css", "");
  writeText("modules/broken/app.js", "");
  writeText("modules/broken/README.md", "");
  registry([
    { id: "broken", name: "Broken", path: "modules/broken", route: "/broken", enabled: true },
    { id: "good", name: "Good", path: "modules/good", route: "/good", enabled: true },
  ]);

  const { runtime, snapshot } = startFixture();
  assert.deepStrictEqual(snapshot.enabledModules, ["good"]);
  assert.strictEqual(snapshot.errors.some((error) => error.moduleId === "broken"), true);
  assert.strictEqual(runtime.openModule("good").ok, true);
}

function testDuplicateRegistryStopsCleanly() {
  resetFixture();
  createModule("one");
  registry([
    { id: "one", name: "One", path: "modules/one", route: "/one", enabled: true },
    { id: "one", name: "One Again", path: "modules/one", route: "/one-again", enabled: true },
  ]);

  const { runtime, snapshot } = startFixture();
  assert.strictEqual(snapshot.enabledModules.length, 0);
  assert.strictEqual(snapshot.errors.some((error) => error.message.includes("Duplicate registry module id")), true);
  assert.strictEqual(runtime.openModule("one").ok, false);
}

function testDisabledModuleHandling() {
  resetFixture();
  createModule("enabled");
  createModule("disabled");
  registry([
    { id: "enabled", name: "Enabled", path: "modules/enabled", route: "/enabled", enabled: true },
    { id: "disabled", name: "Disabled", path: "modules/disabled", route: "/disabled", enabled: false },
  ]);

  const { runtime, snapshot } = startFixture();
  assert.deepStrictEqual(snapshot.enabledModules, ["enabled"]);
  assert.deepStrictEqual(snapshot.disabledModules, ["disabled"]);
  assert.strictEqual(snapshot.launcher.some((item) => item.id === "disabled"), false);
  assert.strictEqual(runtime.openModule("disabled").ok, false);
}

testCurrentProject();
testMissingModuleContinues();
testBrokenManifestContinues();
testDuplicateRegistryStopsCleanly();
testDisabledModuleHandling();

fs.rmSync(fixtureRoot, { recursive: true, force: true });

console.log("PlatformOS runtime tests passed.");
