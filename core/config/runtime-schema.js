const REQUIRED_REGISTRY_FIELDS = ["platform", "version", "modules"];
const REQUIRED_MODULE_FIELDS = ["id", "name", "path", "route", "enabled"];
const REQUIRED_MANIFEST_FIELDS = ["id", "name", "version", "status", "route", "entry"];
const REQUIRED_MODULE_FILES = ["manifest.json", "index.html", "styles.css", "app.js", "README.md"];

module.exports = {
  REQUIRED_REGISTRY_FIELDS,
  REQUIRED_MODULE_FIELDS,
  REQUIRED_MANIFEST_FIELDS,
  REQUIRED_MODULE_FILES,
};
