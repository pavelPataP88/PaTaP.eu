const MODULE_ID = /^[a-z][a-z0-9-]{1,31}$/;

function error(message) {
  const value = new Error(message);
  value.code = "driver_module_registry_invalid";
  return value;
}

export function validateDriverModuleRegistry(registry) {
  if (!registry || registry.version !== 1 || !Array.isArray(registry.modules)) throw error("invalid_registry_shape");
  const ids = new Set();
  const views = new Set();
  const modules = registry.modules.map((item) => ({ ...item, dependsOn: item.dependsOn || [] }));
  for (const module of modules) {
    if (!MODULE_ID.test(module.id || "")) throw error("invalid_module_id");
    if (ids.has(module.id)) throw error("duplicate_module_id");
    ids.add(module.id);
    if (typeof module.enabled !== "boolean" || typeof module.entry !== "string" || !module.entry.startsWith("./") || module.entry.includes("..")) {
      throw error("invalid_module_entry");
    }
    if (module.view !== undefined) {
      if (!MODULE_ID.test(module.view) || !module.label || views.has(module.view)) throw error("invalid_module_view");
      views.add(module.view);
    }
    if (!Array.isArray(module.dependsOn) || module.dependsOn.some((dependency) => !MODULE_ID.test(dependency))) {
      throw error("invalid_module_dependencies");
    }
  }
  for (const module of modules) {
    if (module.dependsOn.some((dependency) => !ids.has(dependency))) throw error("missing_module_dependency");
  }
  return modules;
}

export function resolveDriverModuleOrder(registry) {
  const modules = validateDriverModuleRegistry(registry).filter((module) => module.enabled);
  const byId = new Map(modules.map((module) => [module.id, module]));
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  function visit(module) {
    if (visited.has(module.id)) return;
    if (visiting.has(module.id)) throw error("module_dependency_cycle");
    visiting.add(module.id);
    for (const dependency of module.dependsOn) {
      const target = byId.get(dependency);
      if (!target) throw error("disabled_module_dependency");
      visit(target);
    }
    visiting.delete(module.id);
    visited.add(module.id);
    ordered.push(module);
  }
  for (const module of modules) visit(module);
  return ordered;
}

export async function loadDriverModuleRegistry(url) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw error("module_registry_unavailable");
  return response.json();
}

export async function createDriverModuleRuntime({ registry, context, onModuleError = () => {} }) {
  const ordered = resolveDriverModuleOrder(registry);
  const instances = new Map();
  const loaded = [];
  for (const module of ordered) {
    try {
      if (module.dependsOn.some((dependency) => !instances.has(dependency))) {
        throw error("module_dependency_unavailable");
      }
      const baseUrl = globalThis.location?.href || import.meta.url;
      const source = await import(new URL(module.entry, baseUrl).href);
      if (typeof source.createDriverModule !== "function") throw error("missing_module_factory");
      const instance = await source.createDriverModule({ ...context, getModule: (id) => instances.get(id) });
      instances.set(module.id, instance || {});
      loaded.push(module);
    } catch (cause) {
      onModuleError(module, cause);
    }
  }
  return {
    modules: () => [...loaded],
    get(id) { return instances.get(id); },
    async invoke(method, payload) {
      for (const module of loaded) {
        const action = instances.get(module.id)?.[method];
        if (typeof action === "function") await action(payload);
      }
    },
    async activate(view) {
      const module = loaded.find((item) => item.view === view);
      const action = module && instances.get(module.id)?.activate;
      if (typeof action === "function") await action();
    }
  };
}
