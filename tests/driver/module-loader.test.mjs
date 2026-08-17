import test from "node:test";
import assert from "node:assert/strict";
import { resolveDriverModuleOrder, validateDriverModuleRegistry } from "../../driver/core/module-loader.mjs";

const validRegistry = {
  version: 1,
  modules: [
    { id: "map", label: "Map", view: "map", entry: "./map/index.js", enabled: true, dependsOn: [] },
    { id: "gps", entry: "./gps/index.js", enabled: true, dependsOn: ["map"] },
    { id: "chat", label: "Chat", view: "chat", entry: "./chat/index.js", enabled: true, dependsOn: [] }
  ]
};

test("Driver registry validates and orders dependencies before dependants", () => {
  assert.deepEqual(resolveDriverModuleOrder(validRegistry).map((module) => module.id), ["map", "gps", "chat"]);
  assert.equal(validateDriverModuleRegistry(validRegistry).length, 3);
});

test("Driver registry rejects unsafe entries and invalid dependency graphs", () => {
  assert.throws(() => validateDriverModuleRegistry({ ...validRegistry, modules: [{ ...validRegistry.modules[0], entry: "../map/index.js" }] }), /invalid_module_entry/);
  assert.throws(() => resolveDriverModuleOrder({ ...validRegistry, modules: [{ ...validRegistry.modules[0], dependsOn: ["gps"] }, validRegistry.modules[1]] }), /module_dependency_cycle/);
  assert.throws(() => resolveDriverModuleOrder({ ...validRegistry, modules: [{ ...validRegistry.modules[1] }] }), /missing_module_dependency/);
});
