const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content, "utf8");
}

function replaceOnce(relativePath, before, after) {
  const current = read(relativePath);
  if (current.includes(after)) return false;
  const count = current.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${relativePath}: expected exactly one patch target, found ${count}`);
  }
  write(relativePath, current.replace(before, after));
  return true;
}

const changed = [];
function patch(relativePath, before, after) {
  if (replaceOnce(relativePath, before, after)) changed.push(relativePath);
}

// 1. Invalid JSON is a client error, not an internal server failure.
patch(
  "server/auth/server.js",
  '  if (chunks.length === 0) return {};\n  return JSON.parse(Buffer.concat(chunks).toString("utf8"));',
  '  if (chunks.length === 0) return {};\n  try {\n    return JSON.parse(Buffer.concat(chunks).toString("utf8"));\n  } catch {\n    const error = new Error("invalid_json");\n    error.status = 400;\n    throw error;\n  }'
);

// 2. Load the heavy MapLibre JavaScript only when an authenticated user actually opens the map.
patch(
  "driver/index.html",
  '  <script src="/vendor/maplibre/maplibre-gl.js?v=20260714-8" defer></script>\n  <script type="module" src="/app.js?v=20260817-guest-1"></script>',
  '  <script type="module" src="/app.js?v=20260817-guest-1"></script>'
);

patch(
  "driver/map/index.js",
  'import { countryFlag } from "../shared/countries.js?v=20260714-10";\n\nexport function createMapController',
  `import { countryFlag } from "../shared/countries.js?v=20260714-10";\n\nlet mapLibrePromise = null;\n\nfunction ensureMapLibre() {\n  if (window.maplibregl) return Promise.resolve(window.maplibregl);\n  if (mapLibrePromise) return mapLibrePromise;\n  mapLibrePromise = new Promise((resolve, reject) => {\n    const script = document.createElement("script");\n    script.src = "/vendor/maplibre/maplibre-gl.js?v=20260714-8";\n    script.defer = true;\n    script.addEventListener("load", () => {\n      if (window.maplibregl) resolve(window.maplibregl);\n      else reject(new Error("maplibre_unavailable"));\n    }, { once: true });\n    script.addEventListener("error", () => reject(new Error("maplibre_load_failed")), { once: true });\n    document.head.append(script);\n  }).catch((error) => {\n    mapLibrePromise = null;\n    throw error;\n  });\n  return mapLibrePromise;\n}\n\nexport function createMapController`
);

patch(
  "driver/map/index.js",
  '  function init() {\n    if (map) return true;\n    if (!window.maplibregl) {\n      setState("Не удалось загрузить карту.", "error");\n      return false;\n    }',
  '  async function init() {\n    if (map) return true;\n    if (!window.maplibregl) {\n      try {\n        await ensureMapLibre();\n      } catch {\n        setState("Не удалось загрузить карту. Чат, контакты и профиль продолжают работать.", "error");\n        return false;\n      }\n    }'
);

patch(
  "driver/map/index.js",
  '    activate() {\n      controller.init();\n      window.setTimeout(() => controller.resize(), 0);\n    }',
  '    async activate() {\n      await controller.init();\n      window.setTimeout(() => controller.resize(), 0);\n    }'
);

// 3. Add a tiny repository-owned favicon and make both builds publish it.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <rect width="64" height="64" rx="16" fill="#10231e"/>\n  <path d="M19 49V15h15c9 0 15 5 15 13s-6 13-15 13h-7v8H19zm8-16h7c5 0 8-2 8-5s-3-5-8-5h-7v10z" fill="#68e0ad"/>\n</svg>\n`;
const faviconPath = path.join(root, "favicon.svg");
if (!fs.existsSync(faviconPath) || fs.readFileSync(faviconPath, "utf8") !== favicon) {
  fs.writeFileSync(faviconPath, favicon, "utf8");
  changed.push("favicon.svg");
}

patch(
  "index.html",
  '    <title>Patap Lab</title>\n    <link rel="stylesheet" href="styles.css?v=20260817-guest-1">',
  '    <title>Patap Lab</title>\n    <link rel="icon" href="/favicon.svg" type="image/svg+xml">\n    <link rel="stylesheet" href="styles.css?v=20260817-guest-1">'
);

patch(
  "driver/index.html",
  '  <title>Driver Patap</title>\n  <link rel="stylesheet" href="/vendor/maplibre/maplibre-gl.css?v=20260714-8">',
  '  <title>Driver Patap</title>\n  <link rel="icon" href="/favicon.svg" type="image/svg+xml">\n  <link rel="stylesheet" href="/vendor/maplibre/maplibre-gl.css?v=20260714-8">'
);

patch(
  "scripts/build.js",
  'const entries = ["index.html", "styles.css", "app.js"];',
  'const entries = ["index.html", "styles.css", "app.js", "favicon.svg"];'
);

patch(
  "scripts/build.js",
  'const driverEntries = ["index.html", "styles.css", "app.js", "module-registry.json", "shared", "core", ...driverModuleDirectories];',
  'const driverEntries = ["index.html", "styles.css", "app.js", "module-registry.json", "shared", "core", ...driverModuleDirectories];'
);

// Driver uses the same favicon from the repository root.
patch(
  "scripts/build.js",
  'for (const entry of driverEntries) {\n  copyRequiredFile(path.join(root, "driver", entry), path.join(driverDist, entry), `driver/${entry}`);\n}\n\nconst mapLibreSource',
  'for (const entry of driverEntries) {\n  copyRequiredFile(path.join(root, "driver", entry), path.join(driverDist, entry), `driver/${entry}`);\n}\ncopyRequiredFile(path.join(root, "favicon.svg"), path.join(driverDist, "favicon.svg"), "favicon.svg");\n\nconst mapLibreSource'
);

console.log(changed.length ? `Applied improvements to: ${[...new Set(changed)].join(", ")}` : "All improvements are already applied.");
