class ModuleLauncher {
  build(loadedModules) {
    return loadedModules.map((moduleRecord) => ({
      id: moduleRecord.manifest.id,
      name: moduleRecord.manifest.name,
      route: moduleRecord.manifest.route,
      status: moduleRecord.manifest.status,
      description: moduleRecord.registryEntry.description || moduleRecord.manifest.description || "",
      roles: moduleRecord.manifest.roles || moduleRecord.registryEntry.roles || [],
    }));
  }
}

module.exports = { ModuleLauncher };
