const { REQUIRED_REGISTRY_FIELDS, REQUIRED_MODULE_FIELDS } = require("./runtime-schema");

function validateRegistryShape(registry) {
  const errors = [];

  for (const field of REQUIRED_REGISTRY_FIELDS) {
    if (!(field in registry)) {
      errors.push(`Registry missing field: ${field}`);
    }
  }

  if (!Array.isArray(registry.modules)) {
    errors.push("Registry modules must be an array.");
    return errors;
  }

  const seen = new Set();
  for (const moduleEntry of registry.modules) {
    for (const field of REQUIRED_MODULE_FIELDS) {
      if (!(field in moduleEntry)) {
        errors.push(`Registry module missing field: ${field}`);
      }
    }

    if (moduleEntry.id) {
      if (seen.has(moduleEntry.id)) {
        errors.push(`Duplicate registry module id: ${moduleEntry.id}`);
      }
      seen.add(moduleEntry.id);
    }
  }

  return errors;
}

class RegistryLoader {
  constructor(source, registryPath = "system/registry.json") {
    this.source = source;
    this.registryPath = registryPath;
  }

  load() {
    const registry = this.source.readJson(this.registryPath);
    const errors = validateRegistryShape(registry);

    return {
      ok: errors.length === 0,
      registry,
      errors,
    };
  }
}

module.exports = { RegistryLoader, validateRegistryShape };
