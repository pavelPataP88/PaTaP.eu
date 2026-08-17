const path = require("path");
const { REQUIRED_MANIFEST_FIELDS, REQUIRED_MODULE_FILES } = require("./runtime-schema");

function validateManifestShape(registryEntry, manifest) {
  const errors = [];

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in manifest)) {
      errors.push(`Manifest missing field: ${field}`);
    }
  }

  if (manifest.id && registryEntry.id && manifest.id !== registryEntry.id) {
    errors.push(`Manifest id mismatch: ${manifest.id} != ${registryEntry.id}`);
  }

  if (manifest.route && registryEntry.route && manifest.route !== registryEntry.route) {
    errors.push(`Manifest route mismatch: ${manifest.route} != ${registryEntry.route}`);
  }

  return errors;
}

class ManifestLoader {
  constructor(source) {
    this.source = source;
  }

  load(registryEntry) {
    const manifestPath = path.join(registryEntry.path, "manifest.json").replace(/\\/g, "/");
    const missingFiles = REQUIRED_MODULE_FILES.filter((file) => {
      const relativePath = path.join(registryEntry.path, file).replace(/\\/g, "/");
      return !this.source.exists(relativePath);
    });

    if (missingFiles.length > 0) {
      return {
        ok: false,
        registryEntry,
        manifest: null,
        errors: missingFiles.map((file) => `Module ${registryEntry.id} missing file: ${file}`),
      };
    }

    try {
      const manifest = this.source.readJson(manifestPath);
      const errors = validateManifestShape(registryEntry, manifest);

      return {
        ok: errors.length === 0,
        registryEntry,
        manifest,
        errors,
      };
    } catch (error) {
      return {
        ok: false,
        registryEntry,
        manifest: null,
        errors: [`Module ${registryEntry.id} manifest failed to load: ${error.message}`],
      };
    }
  }
}

module.exports = { ManifestLoader, validateManifestShape };
