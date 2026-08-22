const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "var", "build", "dist");
const driverDist = path.join(root, "var", "build", "driver");

const requiredFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "Caddyfile.tunnel",
  "start-origin.cmd",
  "start-origin.ps1",
  "stop-origin.cmd",
  "stop-origin.ps1",
  "start-backend.ps1",
  "backend-supervisor.ps1",
  "stop-backend.ps1",
  "start-patap-tunnel.ps1",
  "stop-patap-tunnel.ps1",
  "server/auth/server.js",
  "server/auth/http-server.js",
  "server/auth/db.js",
  "server/auth/bootstrap-owner.js",
  "server/auth/backup-db.js",
  "server/auth/restore-db.js",
  "driver/index.html",
  "driver/styles.css",
  "driver/app.js",
  "driver/module-registry.json",
  "driver/shared/api.js",
  "driver/core/navigation.js",
  "driver/core/module-loader.mjs",
  "driver/map/index.js",
  "driver/gps/index.js",
  "driver/profile/index.js",
  "driver/chat/index.js",
  "server/driver/location.js",
  "server/driver/profile.js",
  "server/driver/routes.js",
  "server/driver/http-routes.js",
  "server/driver/runtime.js",
  "server/chat/repository.js",
  "server/chat/routes.js",
  "server/chat/realtime.js",
  "docs/PROJECT_CONTEXT.md",
  "docs/PROJECT_MAP.md",
  "docs/RUNBOOK.md",
  "docs/ARCHITECTURE.md",
  "docs/DRIVER_PATAP_DECISIONS.md",
  "docs/MODULE_SYSTEM.md",
  "docs/CORE.md",
  "docs/SERVICES.md",
  "features/README.md",
  "system/registry.json",
  "core/README.md",
  "services/README.md",
];

const requiredDistFiles = ["index.html", "styles.css", "app.js"];
const driverRegistryManifest = JSON.parse(fs.readFileSync(path.join(root, "driver", "module-registry.json"), "utf8"));
const requiredDriverModuleEntries = driverRegistryManifest.modules
  .filter((module) => module.enabled)
  .map((module) => String(module.entry).split("?")[0].replace(/^\.\//, ""));
const requiredDriverDistFiles = [
  "index.html", "styles.css", "app.js",
  "module-registry.json",
  "shared/api.js",
  "core/navigation.js", "core/module-loader.mjs",
  ...requiredDriverModuleEntries,
  "vendor/maplibre/maplibre-gl.js", "vendor/maplibre/maplibre-gl.css"
];
const forbiddenRootArtifacts = ["dist", "CLOUDFLARE_DEPLOY.md", "wrangler.toml", "_headers", "_redirects", "functions", ".cloudflared-patap-lab-token.txt"];
const forbiddenDistEntries = [
  "core", "services", "modules", "system", "data", "docs", "ops", "scripts", "server", "tests", "var",
  "package.json", "package-lock.json", "Caddyfile.tunnel", ".cloudflared-patap-lab-token.txt",
  "start-origin.ps1", "start-backend.ps1", "start-patap-tunnel.ps1"
];
const requiredCoreAreas = ["router", "navigation", "auth", "permissions", "config", "events", "ui", "storage"];
const requiredServices = ["ai", "filesystem", "logging", "notifications", "sync", "updates"];
const requiredModuleFiles = ["manifest.json", "index.html", "styles.css", "app.js", "assets", "config", "README.md"];
const allowedStatuses = new Set(["active-legacy", "architecture-only"]);
const allowedRoles = new Set(["Administrator", "Developer", "Researcher", "TruckDriver", "TaxiDriver", "Guest"]);
const mojibakeMarkers = ["Đ", "Ð", "Ñ", "Ń", "�"];
const textFiles = ["index.html", "app.js", "README.md", "docs/PROJECT_CONTEXT.md", "docs/CURRENT_STATUS.md", "docs/WORKSPACE_MAP.md", "docs/CLOUDFLARE_TUNNEL.md", "docs/RUNBOOK.md", "features/README.md"];

let failed = false;
function fail(message) {
  console.error(message);
  failed = true;
}
function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
function walkFiles(start) {
  if (!fs.existsSync(start)) return [];
  const result = [];
  for (const entry of fs.readdirSync(start, { withFileTypes: true })) {
    const full = path.join(start, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(full));
    else result.push(full);
  }
  return result;
}

try {
  execFileSync(process.execPath, [path.join(root, "scripts", "build.js")], { cwd: root, stdio: "inherit" });
} catch (error) {
  fail(`Build failed during verify: ${error.message}`);
}

for (const file of requiredFiles) if (!exists(file)) fail(`Missing required file: ${file}`);
for (const file of requiredDistFiles) if (!fs.existsSync(path.join(dist, file))) fail(`Missing dist file: var/build/dist/${file}`);
if (exists("assets/patap-lab-bg.png") && !fs.existsSync(path.join(dist, "assets", "patap-lab-bg.png"))) {
  fail("Patap Lab background exists locally but was not copied to the build");
}
for (const file of requiredDriverDistFiles) if (!fs.existsSync(path.join(driverDist, file))) fail(`Missing Driver dist file: var/build/driver/${file}`);
for (const file of forbiddenRootArtifacts) if (exists(file)) fail(`Unexpected leftover artifact in project root: ${file}`);
for (const entry of forbiddenDistEntries) if (fs.existsSync(path.join(dist, entry))) fail(`Private/internal entry leaked into dist: ${entry}`);
for (const file of walkFiles(dist)) {
  const name = path.basename(file).toLowerCase();
  if (name.endsWith(".ps1") || name.endsWith(".cmd") || name.endsWith(".md") || name.endsWith(".token") || name.endsWith(".secret") || name.endsWith(".sqlite")) {
    fail(`Forbidden file type leaked into dist: ${path.relative(dist, file)}`);
  }
}
for (const file of walkFiles(driverDist)) {
  const name = path.basename(file).toLowerCase();
  if (name.endsWith(".ps1") || name.endsWith(".cmd") || name.endsWith(".md") || name.endsWith(".token") || name.endsWith(".secret") || name.endsWith(".sqlite")) {
    fail(`Forbidden file type leaked into Driver dist: ${path.relative(driverDist, file)}`);
  }
}

const caddyfile = exists("Caddyfile.tunnel") ? read("Caddyfile.tunnel") : "";
[
  ["root * D:/WWW.PATAP.EU/var/build/dist", "Caddyfile.tunnel must serve only var/build/dist"],
  ["root * D:/WWW.PATAP.EU/var/build/driver", "Caddyfile.tunnel must serve the separate Driver build"],
  ["host driver.patap.eu", "Caddyfile.tunnel must route the Driver host separately"],
  ["Strict-Transport-Security", "Caddyfile.tunnel must set HSTS"],
  ["max-age=31536000; includeSubDomains", "Caddyfile.tunnel HSTS must include one-year includeSubDomains"],
  ["Content-Security-Policy", "Caddyfile.tunnel must set CSP"],
  ["redir @httpForwarded https://patap.eu{uri} 308", "Caddyfile.tunnel must redirect forwarded HTTP"],
  ["redir @wwwHost https://patap.eu{uri} 308", "Caddyfile.tunnel must redirect www"],
  ["handle /api/*", "Caddyfile.tunnel must route /api/*"],
  ["reverse_proxy 127.0.0.1:8091", "Caddyfile.tunnel must proxy API to auth backend"],
].forEach(([needle, message]) => { if (!caddyfile.includes(needle)) fail(message); });
if (caddyfile.includes("preload")) fail("Caddyfile.tunnel must not enable HSTS preload yet");

for (const area of requiredCoreAreas) if (!exists(path.join("core", area))) fail(`Missing core area: core/${area}`);
for (const service of requiredServices) if (!exists(path.join("services", service))) fail(`Missing service area: services/${service}`);

let registry = null;
try {
  registry = JSON.parse(read("system/registry.json"));
} catch (error) {
  fail(`Invalid registry: ${error.message}`);
}
if (registry) {
  const ids = new Set();
  const routes = new Set();
  const paths = new Set();
  for (const module of registry.modules || []) {
    if (ids.has(module.id)) fail(`Duplicate module id in registry: ${module.id}`);
    ids.add(module.id);
    if (typeof module.enabled !== "boolean") fail(`Registry module ${module.id} enabled must be boolean`);
    if (!module.route?.startsWith("/")) fail(`Registry module ${module.id} route must start with /`);
    if (routes.has(module.route)) fail(`Duplicate module route in registry: ${module.route}`);
    routes.add(module.route);
    if (paths.has(module.path)) fail(`Duplicate module path in registry: ${module.path}`);
    paths.add(module.path);
    if (!allowedStatuses.has(module.status)) fail(`Registry module ${module.id} has unsupported status: ${module.status}`);
    for (const role of module.roles || []) if (!allowedRoles.has(role)) fail(`Registry module ${module.id} has unsupported role: ${role}`);
    for (const file of requiredModuleFiles) if (!fs.existsSync(path.join(root, module.path, file))) fail(`Missing module file: ${module.path}/${file}`);
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, module.path, "manifest.json"), "utf8"));
      if (manifest.id !== module.id) fail(`Manifest id mismatch for ${module.path}`);
      if (manifest.route !== module.route) fail(`Manifest route mismatch for ${module.path}`);
    } catch (error) {
      fail(`Invalid manifest for ${module.path}: ${error.message}`);
    }
  }
}

for (const file of textFiles) {
  if (!exists(file)) continue;
  const content = read(file);
  const bad = mojibakeMarkers.filter((marker) => content.includes(marker));
  if (bad.length > 0) fail(`Possible mojibake in ${file}: ${bad.join(" ")}`);
}

const index = exists("index.html") ? read("index.html") : "";
const app = exists("app.js") ? read("app.js") : "";
const authEntrypoint = exists("server/auth/server.js") ? read("server/auth/server.js") : "";
const authServer = exists("server/auth/http-server.js") ? read("server/auth/http-server.js") : authEntrypoint;
const authDb = exists("server/auth/db.js") ? read("server/auth/db.js") : "";
const driverApp = exists("driver/app.js") ? read("driver/app.js") : "";
const driverIndex = exists("driver/index.html") ? read("driver/index.html") : "";
const driverApi = exists("driver/shared/api.js") ? read("driver/shared/api.js") : "";
const driverGps = exists("driver/gps/index.js") ? read("driver/gps/index.js") : "";
const driverLocation = exists("server/driver/location.js") ? read("server/driver/location.js") : "";
const driverRoutesFacade = exists("server/driver/routes.js") ? read("server/driver/routes.js") : "";
const driverRoutes = exists("server/driver/http-routes.js") ? read("server/driver/http-routes.js") : driverRoutesFacade;
const driverRuntime = exists("server/driver/runtime.js") ? read("server/driver/runtime.js") : "";
const chatRoutes = exists("server/chat/routes.js") ? read("server/chat/routes.js") : "";
const chatRoutesV2 = exists("server/chat/routes-v2.js") ? read("server/chat/routes-v2.js") : "";
const chatRepository = exists("server/chat/repository.js") ? read("server/chat/repository.js") : "";
const driverRegistry = exists("driver/module-registry.json") ? read("driver/module-registry.json") : "";
const scenarioChecks = [
  [index.includes("Серверная авторизация"), "UI must clearly say server authentication"],
  [index.includes("Email-подтверждение пока не включено"), "UI must say email verification is not enabled"],
  [index.includes("Не используйте пароль от других сервисов"), "Registration form must warn against reused passwords"],
  [index.includes("Сбросить локальный пароль"), "Reset flow must use local reset wording"],
  [!index.includes("Восстановить пароль"), "UI must not pretend email recovery exists"],
  [index.includes('name="confirmPassword"'), "Forms must include password confirmation"],
  [!index.includes("Patap Lab Online"), "UI must not claim Patap Lab Online"],
  [!index.includes('role="tablist"'), "Auth buttons must not use incomplete tablist ARIA"],
  [!app.includes("patapLabUsers") && !app.includes("patapLabSession"), "Browser code must not use localStorage auth users/session"],
  [app.includes('/api/register') && app.includes('/api/login') && app.includes('/api/logout'), "Frontend auth must call server APIs"],
  [app.includes("credentials: \"same-origin\""), "Frontend API calls must include same-origin cookies"],
  [app.includes("/api/password-reset/complete"), "Reset scenario must use server reset token endpoint"],
  [authDb.includes("crypto.scryptSync") && authDb.includes("password_hash"), "Backend must hash passwords server-side"],
  [authEntrypoint.includes('require("./http-server")') && authServer.includes("HttpOnly") && authServer.includes("Secure") && authServer.includes("SameSite=Lax"), "Backend must set secure session cookies through the auth implementation boundary"],
  [authServer.includes("csrf") && authServer.includes("x-csrf-token"), "Backend must enforce CSRF tokens"],
  [authServer.includes("rate_limits"), "Backend must use server-side rate limits"],
  [authServer.includes("audit_events"), "Backend must write audit events"],
  [authDb.includes("CREATE TABLE driver_profiles"), "Backend must migrate Driver profiles"],
  [driverRoutesFacade.includes('require("./http-routes")') && driverRoutes.includes("/api/driver/profile"), "Backend must expose the Driver profile API through the Driver implementation boundary"],
  [driverApp.includes('from "./shared/api.js?v=') && driverApi.includes("export async function api"), "Driver UI must use the shared ES module API client with a release URL"],
  [driverApp.includes("module-loader.mjs?v=") && driverApp.includes("loadDriverModuleRegistry"), "Driver UI must load its module registry at runtime"],
  [driverRegistry.includes('"id": "map"') && driverRegistry.includes('"id": "gps"') && driverRegistry.includes('"id": "chat"') && driverRegistry.includes('"id": "profile"'), "Driver registry must declare map, GPS, chat, and profile modules"],
  [driverApp.includes("/api/driver/profile") && driverApp.includes("/api/login"), "Driver UI must use the real profile and shared auth APIs"],
  [authDb.includes("CREATE TABLE driver_locations"), "Backend must migrate current Driver locations without route history"],
  [authDb.includes("gps_enabled") && driverRoutes.includes("/api/driver/gps"), "Backend must persist the single Driver GPS state"],
  [authDb.includes("CREATE TABLE chat_rooms") && authDb.includes("CREATE TABLE chat_messages"), "Backend must migrate persistent Driver chat"],
  [authDb.includes("CREATE TABLE chat_direct_pairs") && (chatRoutes.includes("/api/driver/chat/direct") || chatRoutesV2.includes("/api/driver/chat/direct")) && chatRepository.includes("createDirectRoom"), "Backend must provide unique Driver direct chats"],
  [authDb.includes("CREATE TABLE principal_owner"), "Backend must enforce one immutable principal Owner"],
  [driverRoutes.includes("/api/driver/location") && driverRoutes.includes("/api/driver/nearby"), "Backend must expose Driver location APIs through Driver routes"],
  [authServer.includes('require("../driver/routes")') && driverRoutes.includes('require("./location")') && driverRuntime.includes("createLocationRepository") && driverLocation.includes("createLocationRepository"), "Backend must keep Driver composition, routes, runtime, and location policy in explicit module boundaries"],
  [!authServer.includes("driver_profiles") && !authServer.includes("driver_locations"), "Auth composition root must not contain Driver profile or location SQL"],
  [driverGps.includes("watchPosition") && driverGps.includes("clearWatch"), "Driver UI must explicitly start and stop geolocation"],
  [!driverIndex.includes("visibility-toggle") && driverGps.includes("gpsEnabled") && driverGps.includes("body: { radius }"), "Driver UI must couple GPS, visibility, and nearby access in one persisted switch"],
  [driverGps.includes("SEND_THROTTLE_MS = 10_000"), "Driver UI must throttle location sends to ten seconds"],
  [app.includes("patapLabProjects"), "Project cards may keep harmless local project storage"],
  [app.includes("patapLabNotes"), "Library cards may keep harmless local note storage"],
  [app.includes("patapLabResearch"), "Research cards may keep harmless local research storage"],
];
for (const [ok, message] of scenarioChecks) if (!ok) fail(message);

if (failed) process.exit(1);
console.log("Patap Lab workspace verification passed.");
