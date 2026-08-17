const { FileSource } = require("./storage/file-source");
const { RegistryLoader } = require("./config/registry-loader");
const { ManifestLoader } = require("./config/manifest-loader");
const { ModuleLauncher } = require("./navigation/module-launcher");
const { ModuleRouter } = require("./router/module-router");
const { RuntimeEvents } = require("./events/runtime-events");

class PlatformOSRuntime {
  constructor({ root, source, registryPath } = {}) {
    this.source = source || new FileSource(root || process.cwd());
    this.registryPath = registryPath || "system/registry.json";
    this.events = new RuntimeEvents();
    this.state = {
      registry: null,
      modules: [],
      disabledModules: [],
      errors: [],
      launcher: [],
      router: new ModuleRouter([]),
    };
  }

  start() {
    this.events.record("runtime:start");

    const registryResult = new RegistryLoader(this.source, this.registryPath).load();
    this.state.registry = registryResult.registry;

    if (!registryResult.ok) {
      this.state.errors.push(...registryResult.errors.map((message) => ({ scope: "registry", message })));
      this.events.record("runtime:registry-invalid", { errors: registryResult.errors });
      this.state.router = new ModuleRouter([]);
      return this.snapshot();
    }

    this.events.record("runtime:registry-loaded", {
      modules: registryResult.registry.modules.length,
    });

    const manifestLoader = new ManifestLoader(this.source);
    const loadedModules = [];
    const disabledModules = [];

    for (const registryEntry of registryResult.registry.modules) {
      const manifestResult = manifestLoader.load(registryEntry);

      if (!manifestResult.ok) {
        this.state.errors.push(...manifestResult.errors.map((message) => ({
          scope: "module",
          moduleId: registryEntry.id,
          message,
        })));
        this.events.record("runtime:module-error", {
          moduleId: registryEntry.id,
          errors: manifestResult.errors,
        });
        continue;
      }

      const moduleRecord = {
        registryEntry,
        manifest: manifestResult.manifest,
      };

      if (registryEntry.enabled) {
        loadedModules.push(moduleRecord);
        this.events.record("runtime:module-enabled", { moduleId: registryEntry.id });
      } else {
        disabledModules.push(moduleRecord);
        this.events.record("runtime:module-disabled", { moduleId: registryEntry.id });
      }
    }

    this.state.modules = loadedModules;
    this.state.disabledModules = disabledModules;
    this.state.launcher = new ModuleLauncher().build(loadedModules);
    this.state.router = new ModuleRouter(loadedModules);
    this.events.record("runtime:ready", {
      enabled: loadedModules.length,
      disabled: disabledModules.length,
      errors: this.state.errors.length,
    });

    return this.snapshot();
  }

  openModule(target) {
    const result = this.state.router.openModule(target);
    this.events.record(result.ok ? "runtime:module-opened" : "runtime:module-open-failed", {
      target,
      error: result.error,
    });
    return result;
  }

  snapshot() {
    return {
      ok: this.state.errors.length === 0,
      registry: this.state.registry,
      launcher: this.state.launcher,
      enabledModules: this.state.modules.map((moduleRecord) => moduleRecord.manifest.id),
      disabledModules: this.state.disabledModules.map((moduleRecord) => moduleRecord.manifest.id),
      errors: [...this.state.errors],
      events: this.events.list(),
    };
  }
}

module.exports = { PlatformOSRuntime };
