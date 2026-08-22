const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultConnectSrc = "https://tile.openstreetmap.org";

function fail(message) {
  const error = new Error(message);
  error.code = "map_provider_preflight_failed";
  throw error;
}

function requiredOrigins(tiles) {
  const origins = new Set();
  for (const template of tiles) {
    if (template.startsWith("/") && !template.startsWith("//")) continue;
    const sample = template.replaceAll("{z}", "0").replaceAll("{x}", "0").replaceAll("{y}", "0");
    origins.add(new URL(sample).origin);
  }
  return [...origins].sort();
}

function allowedOrigins(raw) {
  const values = String(raw || defaultConnectSrc).trim().split(/\s+/).filter(Boolean);
  if (!values.length) fail("PATAP_MAP_CONNECT_SRC must allow every external tile origin");
  for (const value of values) {
    if (value === "*" || value === "https:" || value.includes("*")) fail("PATAP_MAP_CONNECT_SRC must use exact reviewed origins");
    let url;
    try { url = new URL(value); } catch { fail(`Invalid PATAP_MAP_CONNECT_SRC origin: ${value}`); }
    if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) fail(`Unsafe PATAP_MAP_CONNECT_SRC origin: ${value}`);
  }
  return [...new Set(values)].sort();
}

async function main() {
  const { validateMapProvider } = await import("../driver/map/provider-config.mjs");
  const configRoot = process.env.PATAP_MAP_CONFIG_ROOT
    ? path.resolve(process.env.PATAP_MAP_CONFIG_ROOT)
    : path.join(root, "driver");
  const configPath = path.join(configRoot, "map-provider.json");
  if (!fs.existsSync(configPath)) fail(`Map provider config not found: ${configPath}`);
  const provider = validateMapProvider(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const required = requiredOrigins(provider.tiles);
  const allowed = allowedOrigins(process.env.PATAP_MAP_CONNECT_SRC);
  const missing = required.filter((origin) => !allowed.includes(origin));
  if (missing.length) fail(`CSP does not allow configured map origin(s): ${missing.join(", ")}`);
  console.log(`Map provider PASS: ${provider.id} (${provider.mode}); external origins: ${required.length ? required.join(", ") : "same-origin"}`);
}

main().catch((error) => {
  console.error(`Map provider FAIL: ${error.message}`);
  process.exitCode = 1;
});
