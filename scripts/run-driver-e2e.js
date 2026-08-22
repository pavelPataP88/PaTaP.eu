const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const assert = require("node:assert/strict");
const { createIsolatedAuth, getFreePort, stopChild } = require("../tests/helpers/isolated-auth");

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

function startDriverServer(root, port, authPort) {
  const driverRoot = path.join(root, "var", "build", "driver");
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      const proxy = http.request({
        hostname: "127.0.0.1",
        port: authPort,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${authPort}`,
          origin: "http://127.0.0.1:8090"
        }
      }, (upstream) => {
        res.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(res);
      });
      proxy.on("error", (error) => {
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      });
      req.pipe(proxy);
      return;
    }

    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = path.resolve(driverRoot, relative);
    if (!file.startsWith(`${driverRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Cache-Control": "no-store" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Restarted auth server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Restarted auth server did not become healthy");
}

function spawnAuth(root, env) {
  const child = spawn(process.execPath, [path.join(root, "server", "auth", "server.js")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("exit", (code) => {
    if (code !== 0 && stderr.trim()) console.error(`Restarted auth backend exited (${code}): ${stderr.trim()}`);
  });
  return child;
}

async function browserApi(page, pathname, { method = "GET", body } = {}) {
  return page.evaluate(async ({ pathname, method, body, mutation }) => {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (mutation) {
      const pair = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("patap_csrf="));
      const csrf = pair ? decodeURIComponent(pair.slice("patap_csrf=".length)) : "";
      if (csrf) headers["X-CSRF-Token"] = csrf;
    }
    const response = await fetch(pathname, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data };
  }, { pathname, method, body, mutation: MUTATION_METHODS.has(method) });
}

async function browserBinaryUpload(page, pathname, bytes, headers = {}) {
  return page.evaluate(async ({ pathname, values, headers }) => {
    const pair = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("patap_csrf="));
    const csrf = pair ? decodeURIComponent(pair.slice("patap_csrf=".length)) : "";
    const response = await fetch(pathname, {
      method: "POST",
      credentials: "same-origin",
      headers: { ...headers, ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
      body: new Uint8Array(values)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data };
  }, { pathname, values: Array.from(bytes), headers });
}

async function browserBinaryRead(page, pathname) {
  return page.evaluate(async (pathname) => {
    const response = await fetch(pathname, { credentials: "same-origin" });
    return { status: response.status, values: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, pathname);
}

async function waitUntil(label, probe, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await probe();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out${last instanceof Error ? `: ${last.message}` : ""}`);
}

async function installDeterministicMap(context) {
  await context.route(/https:\/\/[^/]*tile\.openstreetmap\.org\/.*\.png(?:\?.*)?$/i, (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: TRANSPARENT_PNG
  }));
}

function collectPageErrors(page, label, target) {
  page.on("pageerror", (error) => target.push(`${label}: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) target.push(`${label}: HTTP ${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() !== "error" || text.startsWith("Failed to load resource:")) return;
    target.push(`${label}: console ${text}`);
  });
}

async function registerDriver(page, localUrl, { username, email, password, nickname, driverType }) {
  await page.goto(localUrl, { waitUntil: "networkidle" });
  await page.locator("#guest-view").waitFor({ state: "visible" });
  await page.locator("#guest-map-login").click();
  await page.locator("#show-driver-register").click();
  const form = page.locator("#driver-register-form");
  await form.locator("[name=username]").fill(username);
  await form.locator("[name=email]").fill(email);
  await form.locator("[name=password]").fill(password);
  await form.locator("[name=confirmPassword]").fill(password);
  await form.locator("[name=nickname]").fill(nickname);
  await form.locator("[name=driverType]").selectOption(driverType);
  await form.locator("button[type=submit]").click();
  await page.locator("#profile-view").waitFor({ state: "visible" });
  await page.locator('[data-driver-target="map"]').waitFor({ state: "visible" });
  assert.equal(await page.locator("#driver-nav [data-driver-target]").count(), 6, "Driver bottom navigation must remain six views");
  await page.locator('[data-driver-target="map"]').click();
  await page.locator("#map-view").waitFor({ state: "visible" });
  await page.locator("#gps-toggle").waitFor({ state: "attached" });
  assert.equal(await page.locator("#gps-toggle").isDisabled(), false, "GPS toggle is disabled after Driver registration");
}

async function loginDriver(page, username, password) {
  await page.locator("#login-view").waitFor({ state: "visible" });
  await page.locator("#login-form [name=identifier]").fill(username);
  await page.locator("#login-form [name=password]").fill(password);
  await page.locator("#login-form button[type=submit]").click();
  await page.locator("#profile-view").waitFor({ state: "visible" });
}

async function enableGps(page) {
  const toggle = page.locator("#gps-toggle");
  if (!(await toggle.isChecked())) {
    const layersButton = page.locator('[data-map-experience="layers"]');
    const layersPanel = page.locator(".map-layers-panel");
    const switchRow = page.locator("label.switch-row").filter({ has: toggle });
    await layersButton.waitFor({ state: "visible" });
    if (await layersPanel.isHidden()) await layersButton.click();
    await switchRow.waitFor({ state: "visible" });
    await switchRow.click();
    if (!(await layersPanel.isHidden())) await layersButton.click();
  }
  await waitUntil("GPS upload", async () => {
    const text = await page.locator("#gps-state").textContent();
    return /Driver включён/.test(text || "") ? text : false;
  }, 12000);
}

async function searchAndOpen(page, nickname) {
  await page.locator('[data-driver-target="map"]').click();
  await page.locator("#driver-search-input").fill(nickname);
  await page.locator("#driver-search-form button[type=submit]").click();
  const result = page.locator("#driver-search-results button", { hasText: nickname }).first();
  await result.waitFor({ state: "visible" });
  await result.click();
  await page.locator("#driver-card").waitFor({ state: "visible" });
  assert.equal((await page.locator("#driver-card-name").textContent())?.trim(), nickname);
}

let auth;
let replacementAuth = null;
let web;
let browser;
let cleaning = false;

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  if (browser) await browser.close().catch(() => {});
  await closeServer(web);
  await stopChild(replacementAuth);
  if (auth) await auth.cleanup();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => cleanup().finally(() => process.exit(128)));
}

const timeout = setTimeout(() => {
  console.error("Driver E2E exceeded 240 seconds.");
  cleanup().finally(() => process.exit(1));
}, 240000);

(async () => {
  const errors = [];
  try {
    const { chromium } = require("playwright");
    auth = await createIsolatedAuth();
    Object.assign(process.env, auth.env);
    const { openDb, nowIso } = require("../server/auth/db");
    const webPort = await getFreePort();
    web = await startDriverServer(auth.root, webPort, auth.port);
    const localUrl = `http://127.0.0.1:${webPort}`;

    browser = await chromium.launch({ headless: true });
    const contextA = await browser.newContext({
      viewport: { width: 390, height: 844 },
      geolocation: { latitude: 50.26490, longitude: 19.02378, accuracy: 12 },
      permissions: ["geolocation"]
    });
    const contextB = await browser.newContext({
      viewport: { width: 390, height: 844 },
      geolocation: { latitude: 50.26525, longitude: 19.02410, accuracy: 16 },
      permissions: ["geolocation"]
    });
    await Promise.all([installDeterministicMap(contextA), installDeterministicMap(contextB)]);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    collectPageErrors(pageA, "driver-a", errors);
    collectPageErrors(pageB, "driver-b", errors);

    const suffix = auth.runId.slice(-8).replace(/[^a-z0-9]/gi, "");
    const a = { username: `e2ea_${suffix}`, email: `e2ea_${suffix}@patap.test`, password: "e2e-driver-password-123", nickname: `E2EA_${suffix}`, driverType: "TAXI" };
    const b = { username: `e2eb_${suffix}`, email: `e2eb_${suffix}@patap.test`, password: "e2e-driver-password-123", nickname: `E2EB_${suffix}`, driverType: "DELIVERY" };

    await registerDriver(pageA, localUrl, a);
    await registerDriver(pageB, localUrl, b);
    await Promise.all([enableGps(pageA), enableGps(pageB)]);

    let result = await browserApi(pageA, "/api/driver/nearby", { method: "POST", body: { radius: 5 } });
    assert.equal(result.status, 200);
    const stranger = result.data.drivers.find((item) => item.nickname === b.nickname);
    assert.ok(stranger, "Second Driver is missing from nearby result");
    assert.notEqual(Number(stranger.latitude), 50.26525, "Stranger received exact latitude");
    assert.notEqual(Number(stranger.longitude), 19.02410, "Stranger received exact longitude");

    await searchAndOpen(pageA, b.nickname);
    await pageA.locator("#driver-card-contact").click();
    await waitUntil("outgoing contact request", async () => (await pageA.locator("#driver-card-status").textContent() || "").includes("Запрос отправлен"));

    const overviewAfterRequest = await waitUntil("Event Center contact projection", async () => {
      const overview = await browserApi(pageB, "/api/driver/events/overview");
      return overview.status === 200 && Number(overview.data?.counts?.unread || 0) > 0 ? overview : false;
    });
    assert.ok(overviewAfterRequest.data.events.some((event) => event.category === "PEOPLE"), "Contact request did not reach Event Center");
    assert.equal(await pageB.locator("#event-center-button").count(), 1, "Event Center bell is missing");

    await searchAndOpen(pageB, a.nickname);
    assert.match(await pageB.locator("#driver-card-contact").textContent(), /Принять запрос/);
    await pageB.locator("#driver-card-contact").click();
    await waitUntil("accepted contact", async () => (await pageB.locator("#driver-card-status").textContent() || "").includes("Контакт"));

    result = await browserApi(pageA, "/api/driver/nearby", { method: "POST", body: { radius: 5 } });
    assert.equal(result.status, 200);
    const contact = result.data.drivers.find((item) => item.nickname === b.nickname);
    assert.ok(contact, "Accepted contact disappeared from nearby result");
    assert.ok(Number(contact.accuracy) >= 100, "Normal contact unexpectedly received precise GPS accuracy");

    await pageA.locator('[data-driver-target="map"]').click();
    await pageA.locator('[data-road-reports="start"]').click();
    await pageA.locator('[data-road-type="OBSTACLE"]').click();
    await pageA.getByRole("button", { name: "Создать дорожное событие в текущей GPS-позиции" }).click();
    const reportMarker = pageA.locator("[data-road-report-marker]").first();
    await reportMarker.waitFor({ state: "visible" });
    const reportId = Number(await reportMarker.getAttribute("data-road-report-marker"));
    assert.ok(Number.isSafeInteger(reportId) && reportId > 0);

    result = await browserApi(pageB, `/api/driver/road-reports/${reportId}/confirm`, { method: "POST", body: { status: "ACTIVE" } });
    assert.equal(result.status, 200);
    assert.ok(Number(result.data.report?.activeConfirmations || 0) >= 1);

    await searchAndOpen(pageA, b.nickname);
    await pageA.locator("#driver-card-chat").click();
    await pageA.locator("#chat-view").waitFor({ state: "visible" });
    const directText = `E2E direct ${suffix}`;
    await pageA.locator("#chat-message-input").fill(directText);
    await pageA.locator("#chat-form button[type=submit]").click();
    await pageA.locator("#chat-messages", { hasText: directText }).waitFor({ state: "visible" });

    await searchAndOpen(pageB, a.nickname);
    await pageB.locator("#driver-card-chat").click();
    await pageB.locator("#chat-view").waitFor({ state: "visible" });
    await pageB.locator("#chat-messages", { hasText: directText }).waitFor({ state: "visible" });

    await searchAndOpen(pageA, b.nickname);
    await waitUntil("radio contact relationship", async () => !(await pageA.locator("#driver-card-radio").isDisabled()));
    await pageA.locator("#driver-card-radio").click();
    await pageA.locator("#radio-view").waitFor({ state: "visible" });

    result = await browserApi(pageA, "/api/driver/radio/direct", { method: "POST", body: { nickname: b.nickname } });
    assert.ok([200, 201].includes(result.status));
    const channelId = Number(result.data.channel.id);
    result = await browserApi(pageA, `/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
    assert.equal(result.status, 201);
    const transmissionId = Number(result.data.transmissionId);
    const uploadToken = result.data.uploadToken;
    const radioBytes = Buffer.from(`driver-e2e-radio-${suffix}`, "utf8");
    result = await browserBinaryUpload(pageA, `/api/driver/radio/transmissions/${transmissionId}/audio`, radioBytes, {
      "Content-Type": "audio/webm",
      "X-Radio-Upload-Token": uploadToken
    });
    assert.equal(result.status, 201);
    result = await browserApi(pageB, `/api/driver/radio/channels/${channelId}/transmissions`);
    assert.equal(result.status, 200);
    assert.ok(result.data.transmissions.some((item) => Number(item.id) === transmissionId));
    const audio = await browserBinaryRead(pageB, `/api/driver/radio/transmissions/${transmissionId}/audio`);
    assert.equal(audio.status, 200);
    assert.deepEqual(Buffer.from(audio.values), radioBytes);

    await pageA.locator('[data-driver-target="parking"]').click();
    const parkingView = pageA.locator('[data-driver-view="parking"]');
    await parkingView.waitFor({ state: "visible" });
    result = await browserApi(pageA, "/api/driver/parking/places?limit=10");
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.places));

    let db = openDb();
    const bUser = db.prepare("SELECT id FROM users WHERE username=?").get(b.username);
    assert.ok(bUser?.id);
    db.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(nowIso(), bUser.id);
    db.close();

    await pageB.locator('[data-driver-target="map"]').click();
    await pageB.locator("#driver-search-input").fill(a.nickname);
    await pageB.locator("#driver-search-form button[type=submit]").click();
    await pageB.locator("#login-view").waitFor({ state: "visible" });
    await loginDriver(pageB, b.username, b.password);

    await stopChild(auth.child);
    replacementAuth = spawnAuth(auth.root, auth.env);
    await waitForHealth(auth.baseUrl, replacementAuth);

    result = await waitUntil("Road Report after backend restart", async () => {
      const listed = await browserApi(pageA, "/api/driver/road-reports");
      if (listed.status !== 200) return false;
      const report = listed.data.reports.find((item) => Number(item.id) === reportId);
      return report ? { status: listed.status, data: report } : false;
    }, 12000);
    assert.equal(result.status, 200);
    assert.equal(Number(result.data.id), reportId);
    assert.ok(Number(result.data.activeConfirmations || 0) >= 1, "Road Report confirmation was lost after backend restart");

    result = await browserApi(pageB, "/api/driver/chat/rooms");
    assert.equal(result.status, 200);
    const directRoom = result.data.rooms.find((room) => room.kind === "DIRECT" && room.title === a.nickname);
    assert.ok(directRoom, "Direct chat room was lost after backend restart");
    result = await browserApi(pageB, `/api/driver/chat/rooms/${directRoom.id}/messages`);
    assert.equal(result.status, 200);
    assert.ok(result.data.messages.some((message) => message.text === directText), "Direct message was lost after backend restart");

    result = await browserApi(pageB, `/api/driver/radio/channels/${channelId}/transmissions`);
    assert.equal(result.status, 200);
    assert.ok(result.data.transmissions.some((item) => Number(item.id) === transmissionId), "Radio history was lost after backend restart");

    const viewportState = await pageA.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.equal(viewportState.width, 390);
    assert.ok(viewportState.scrollWidth <= 391, `Driver mobile layout overflows: ${viewportState.scrollWidth}px`);
    assert.deepEqual(errors, [], `Driver E2E browser/server errors:\n${errors.join("\n")}`);

    console.log("Driver E2E PASS: 2 users, GPS/privacy, contacts/events, Road Reports restart, direct Chat, direct Radio history, Parking, auth loss/relogin, mobile 390x844.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await cleanup();
  }
})();
