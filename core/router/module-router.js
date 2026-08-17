class ModuleRouter {
  constructor(loadedModules) {
    this.byId = new Map();
    this.byRoute = new Map();

    for (const moduleRecord of loadedModules) {
      this.byId.set(moduleRecord.manifest.id, moduleRecord);
      this.byRoute.set(moduleRecord.manifest.route, moduleRecord);
    }
  }

  openModule(target) {
    const moduleRecord = this.byId.get(target) || this.byRoute.get(target);

    if (!moduleRecord) {
      return {
        ok: false,
        error: `Enabled module not found: ${target}`,
        module: null,
      };
    }

    return {
      ok: true,
      error: null,
      module: {
        id: moduleRecord.manifest.id,
        name: moduleRecord.manifest.name,
        route: moduleRecord.manifest.route,
        entry: `${moduleRecord.registryEntry.path}/${moduleRecord.manifest.entry}`,
        status: moduleRecord.manifest.status,
      },
    };
  }
}

module.exports = { ModuleRouter };
