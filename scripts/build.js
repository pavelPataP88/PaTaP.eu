const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "var", "build", "dist");
const driverDist = path.join(root, "var", "build", "driver");
const entries = ["index.html", "styles.css", "app.js"];
const driverRegistry = JSON.parse(fs.readFileSync(path.join(root, "driver", "module-registry.json"), "utf8"));
const driverModuleDirectories = [...new Set(driverRegistry.modules.map((module) => {
  const entry = String(module.entry || "").split("?")[0];
  return entry.replace(/^\.\//, "").split("/")[0];
}))];
const driverEntries = ["index.html", "styles.css", "app.js", "module-registry.json", "shared", "core", ...driverModuleDirectories];
const assetEntries = ["patap-lab-bg.png"];

function copyRequiredFile(source, target, label) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing required build file: ${label}`);
  }

  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.cpSync(source, target, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

for (const entry of entries) {
  const source = path.join(root, entry);
  if (!fs.existsSync(source)) throw new Error(`Missing required build file: ${entry}`);
}
for (const entry of driverEntries) {
  const source = path.join(root, "driver", entry);
  if (!fs.existsSync(source)) throw new Error(`Missing required build file: driver/${entry}`);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.rmSync(driverDist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(driverDist, { recursive: true });

for (const entry of entries) {
  copyRequiredFile(path.join(root, entry), path.join(dist, entry), entry);
}

for (const entry of driverEntries) {
  copyRequiredFile(path.join(root, "driver", entry), path.join(driverDist, entry), `driver/${entry}`);
}

const mapLibreSource = path.join(root, "node_modules", "maplibre-gl", "dist");
const mapLibreTarget = path.join(driverDist, "vendor", "maplibre");
for (const entry of ["maplibre-gl.js", "maplibre-gl.css"]) {
  copyRequiredFile(path.join(mapLibreSource, entry), path.join(mapLibreTarget, entry), `maplibre-gl/dist/${entry}`);
}

const sourceAssets = path.join(root, "assets");
const targetAssets = path.join(dist, "assets");
fs.mkdirSync(targetAssets, { recursive: true });

for (const entry of assetEntries) {
  copyRequiredFile(path.join(sourceAssets, entry), path.join(targetAssets, entry), `assets/${entry}`);
}

console.log(`Built Patap Lab into ${path.relative(root, dist)}`);
console.log(`Built Driver Patap into ${path.relative(root, driverDist)}`);
