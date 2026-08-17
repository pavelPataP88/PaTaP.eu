const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..", "..");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
};

test("client data and display settings are isolated by stable user.id", { timeout: 120000 }, async (t) => {
  let sessionUser = { id: 101, username: "alice", role: "User" };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/csrf") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ csrfToken: "test-csrf" }));
      return;
    }
    if (url.pathname === "/api/session") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: sessionUser }));
      return;
    }

    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    if (sessionStorage.getItem("legacy-fixture-installed")) return;
    sessionStorage.setItem("legacy-fixture-installed", "1");
    localStorage.setItem("patapLabProjects", JSON.stringify([
      { value: "Legacy project", createdAt: "before accounts" }
    ]));
    localStorage.setItem("patapLabNotes", JSON.stringify([
      { value: "Legacy note", createdAt: "before accounts" }
    ]));
    localStorage.setItem("patapLabResearch", JSON.stringify([
      { value: "Legacy research", createdAt: "before accounts" }
    ]));
    localStorage.setItem("patapLabSettings", JSON.stringify({
      name: "Legacy Alice",
      compact: true
    }));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await page.goto(baseUrl);
  await assertVisibleUser(page, "Legacy Alice · User");
  assert.equal(await page.locator("#settings-form [name=name]").inputValue(), "Legacy Alice");
  assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("compact")), true);
  await assertListContains(page, "#project-list", "Legacy project");
  await assertListContains(page, "#note-list", "Legacy note");
  await assertListContains(page, "#research-list", "Legacy research");

  const migrated = await page.evaluate(() => ({
    marker: JSON.parse(localStorage.getItem("patapLabLegacyStorageMigrationV1")),
    legacyKeysRemain: [
      "patapLabProjects",
      "patapLabNotes",
      "patapLabResearch",
      "patapLabSettings"
    ].some((key) => localStorage.getItem(key) !== null),
    projects: JSON.parse(localStorage.getItem("patapLabProjects:user:101"))
  }));
  assert.deepEqual(migrated.marker, { version: 1, userId: "101", completed: true });
  assert.equal(migrated.legacyKeysRemain, false);
  assert.equal(migrated.projects[0].value, "Legacy project");

  await page.locator('[data-section="settings"]').click();
  await page.locator("#settings-form [name=name]").fill("Alice Display");
  await page.locator("#settings-form [name=compact]").uncheck();
  await page.locator("#settings-form button[type=submit]").click();
  await assertVisibleUser(page, "Alice Display · User");
  await page.reload();
  await assertVisibleUser(page, "Alice Display · User");
  assert.equal(await page.locator("#settings-form [name=name]").inputValue(), "Alice Display");

  sessionUser = { id: 202, username: "bob", role: "User" };
  await page.reload();
  await assertVisibleUser(page, "bob · User");
  assert.equal(await page.locator("#settings-form [name=name]").inputValue(), "bob");
  assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("compact")), false);
  assert.equal(await page.locator("#project-list").textContent().then((text) => text.includes("Legacy project")), false);
  assert.equal(await page.locator("#note-list").textContent().then((text) => text.includes("Legacy note")), false);
  assert.equal(await page.locator("#research-list").textContent().then((text) => text.includes("Legacy research")), false);

  await page.locator('[data-section="library"]').click();
  await page.locator("#note-form [name=note]").fill("Bob-only note");
  await page.locator("#note-form button[type=submit]").click();
  const isolated = await page.evaluate(() => ({
    aliceSettings: JSON.parse(localStorage.getItem("patapLabSettings:user:101")),
    bobSettings: localStorage.getItem("patapLabSettings:user:202"),
    aliceNotes: JSON.parse(localStorage.getItem("patapLabNotes:user:101")),
    bobNotes: JSON.parse(localStorage.getItem("patapLabNotes:user:202"))
  }));
  assert.equal(isolated.aliceSettings.name, "Alice Display");
  assert.equal(isolated.bobSettings, null);
  assert.equal(isolated.aliceNotes[0].value, "Legacy note");
  assert.equal(isolated.bobNotes[0].value, "Bob-only note");
  assert.deepEqual(pageErrors, []);
});

async function assertVisibleUser(page, expected) {
  await page.locator("#lab-screen:not(.hidden)").waitFor();
  await assert.strictEqual(await page.locator("#current-user").textContent(), expected);
}

async function assertListContains(page, selector, expected) {
  const text = await page.locator(selector).textContent();
  assert.ok(text.includes(expected), `${selector} does not contain ${expected}`);
}

test("Driver GPS state persists, auto-restores, and couples visibility with nearby access", { timeout: 120000 }, async (t) => {
  const requests = [];
  let profileGpsEnabled = false;
  let nearbyRelationship = "STRANGER";
  let contactsUnauthorized = false;
  let chatMessages = [
    { id: 901, roomId: 9, sender: { nickname: "DriverTest", driverType: "TAXI" }, text: "Моё сообщение", createdAt: new Date().toISOString() },
    { id: 902, roomId: 9, sender: { nickname: "NearbyDriver", driverType: "DELIVERY" }, text: "Чужое сообщение", createdAt: new Date().toISOString() }
  ];
  let radioTransmissions = [
    { id: 501, channelId: 4, sender: { nickname: "DriverTest", driverType: "TAXI" }, mimeType: "audio/webm", byteLength: 12, createdAt: new Date().toISOString(), committedAt: new Date().toISOString() },
    { id: 502, channelId: 4, sender: { nickname: "NearbyDriver", driverType: "DELIVERY" }, mimeType: "audio/webm", byteLength: 12, createdAt: new Date().toISOString(), committedAt: new Date().toISOString() }
  ];
  const driverRoot = path.join(root, "driver");
  const mapLibreStub = `
    class FakeMap {
      constructor(options) { this.zoom = options.zoom; this.container = document.getElementById(options.container); this.sources = new Map(); window.__mapCreated = true; window.__fakeMap = this; }
      addControl(control) { const element = control?.onAdd?.(this); if (element) this.container.append(element); }
      on(event, listener) { if (event === "load") setTimeout(listener, 0); }
      addSource(id, source) { this.sources.set(id, { data: source.data, setData: (data) => { this.sources.get(id).data = data; } }); }
      getSource(id) { return this.sources.get(id); }
      addLayer() {}
      getContainer() { return this.container; }
      easeTo(options) { (window.__mapEaseTo ||= []).push(options); if (options.zoom) this.zoom = options.zoom; }
      getZoom() { return this.zoom; }
      resize() {}
    }
    class FakeMarker {
      constructor() { this.element = document.createElement("button"); (window.__markers ||= []).push(this); }
      setLngLat(value) { this.value = value; return this; }
      setPopup(value) { this.popup = value; return this; }
      addTo() { return this; }
      getElement() { return this.element; }
      remove() { this.removed = true; }
    }
    class FakePopup { setDOMContent(value) { this.value = value; return this; } }
    class FakeAttributionControl {}
    window.maplibregl = { Map: FakeMap, Marker: FakeMarker, Popup: FakePopup, AttributionControl: FakeAttributionControl };
    class FakeWebSocket {
      static OPEN = 1;
      constructor() { this.readyState = 1; this.listeners = {}; setTimeout(() => this.emit("open"), 0); }
      addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
      emit(type, payload = {}) { for (const listener of this.listeners[type] || []) listener(payload); }
      send() {}
      close() { this.readyState = 3; this.emit("close"); }
    }
    window.WebSocket = FakeWebSocket;
  `;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/csrf") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ csrfToken: "driver-test-csrf" }));
      return;
    }
    if (url.pathname === "/api/session") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: { id: 303, username: "driver-test", role: "User" } }));
      return;
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: { id: 303, username: "driver-test", role: "User" } }));
      return;
    }
    if (url.pathname === "/api/driver/profile" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ profile: { nickname: "DriverTest", driverType: "TAXI", gpsEnabled: profileGpsEnabled } }));
      return;
    }
    if (url.pathname === "/api/driver/gps" && req.method === "PUT") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ method: req.method, path: url.pathname, body });
      profileGpsEnabled = body.enabled === true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ gpsEnabled: profileGpsEnabled }));
      return;
    }
    if (url.pathname === "/api/driver/location" && ["PUT", "DELETE"].includes(req.method)) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      requests.push({ method: req.method, path: url.pathname, body: raw ? JSON.parse(raw) : {} });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(req.method === "PUT"
        ? { location: { ...(raw ? JSON.parse(raw) : {}), updatedAt: new Date().toISOString() } }
        : { ok: true }));
      return;
    }
    if (url.pathname === "/api/driver/nearby") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ method: req.method, path: url.pathname, body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ radiusKm: body.radius, locationReady: true, drivers: [{
        nickname: "NearbyDriver", driverType: "DELIVERY", vehicle: "Van", countryCode: "PL",
        latitude: 52.24, longitude: 21.02, accuracy: 10, updatedAt: new Date().toISOString(), distanceKm: 2.1
      }] }));
      return;
    }
    if (url.pathname === "/api/driver/chat/rooms") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rooms: [{ id: 1, key: "general", kind: "GENERAL", title: "Общий чат", lastCursor: null }] }));
      return;
    }
    if (url.pathname === "/api/driver/drivers/NearbyDriver") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ driver: {
        nickname: "NearbyDriver", driverType: "DELIVERY", vehicle: "Van", countryCode: "PL",
        gps: "ACTIVE", locationUpdatedAt: new Date().toISOString(), relationship: nearbyRelationship
      } }));
      return;
    }
    if (url.pathname === "/api/driver/drivers/NearbyDriver/block" && req.method === "PUT") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      nearbyRelationship = JSON.parse(raw).enabled ? "BLOCKED" : "CONTACT";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ driver: {
        nickname: "NearbyDriver", driverType: "DELIVERY", vehicle: "Van", countryCode: "PL",
        gps: "ACTIVE", locationUpdatedAt: new Date().toISOString(), relationship: nearbyRelationship
      } }));
      return;
    }
    if (url.pathname === "/api/driver/contacts") {
      if (contactsUnauthorized) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "authentication_required" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      const driver = { nickname: "NearbyDriver", relationship: "CONTACT" };
      res.end(JSON.stringify({ drivers: [driver], groups: { incoming: [], outgoing: [], contacts: [driver], blocked: [] } }));
      return;
    }
    if (url.pathname === "/api/driver/chat/direct" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      requests.push({ method: req.method, path: url.pathname, body: raw ? JSON.parse(raw) : {} });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ created: true, room: { id: 9, key: "direct:303:404", kind: "DIRECT", title: "NearbyDriver", lastCursor: null } }));
      return;
    }
    if (url.pathname === "/api/driver/chat/rooms/9/messages") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: chatMessages, nextCursor: chatMessages.at(-1)?.id || null, hasMore: false }));
      return;
    }
    const deleteChatMessage = url.pathname.match(/^\/api\/driver\/chat\/messages\/(\d+)$/);
    if (deleteChatMessage && req.method === "DELETE") {
      const id = Number(deleteChatMessage[1]);
      chatMessages = chatMessages.filter((message) => message.id !== id);
      requests.push({ method: req.method, path: url.pathname, body: {} });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted: { id, roomId: 9 } }));
      return;
    }
    if (url.pathname === "/api/driver/radio/channels") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ channels: [{
        id: 4, key: "direct:303:404", kind: "DIRECT", title: "NearbyDriver",
        peer: { nickname: "NearbyDriver", driverType: "DELIVERY" }, speaker: null,
        lastTransmissionId: radioTransmissions.at(-1)?.id || null,
        transmissionCount: radioTransmissions.length,
        createdAt: new Date().toISOString()
      }] }));
      return;
    }
    if (url.pathname === "/api/driver/radio/channels/4/transmissions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ transmissions: radioTransmissions }));
      return;
    }
    const deleteRadioTransmission = url.pathname.match(/^\/api\/driver\/radio\/transmissions\/(\d+)$/);
    if (deleteRadioTransmission && req.method === "DELETE") {
      const id = Number(deleteRadioTransmission[1]);
      radioTransmissions = radioTransmissions.filter((item) => item.id !== id);
      requests.push({ method: req.method, path: url.pathname, body: {} });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted: { id, channelId: 4 } }));
      return;
    }
    if (url.pathname === "/api/logout" && req.method === "POST") {
      requests.push({ method: req.method, path: url.pathname, body: {} });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/vendor/maplibre/maplibre-gl.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      res.end(mapLibreStub);
      return;
    }
    if (url.pathname === "/vendor/maplibre/maplibre-gl.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      res.end("");
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.resolve(driverRoot, relative);
    if (!file.startsWith(driverRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const state = { watchCalls: 0, clearCalls: [], success: null, failure: null };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { async writeText(text) { window.__copiedText = text; } }
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition(success, failure) {
          state.watchCalls += 1;
          state.success = success;
          state.failure = failure;
          return 77;
        },
        clearWatch(id) { state.clearCalls.push(id); }
      }
    });
    window.__geo = state;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await page.goto(baseUrl);
  await page.locator("#profile-view:not([hidden])").waitFor();
  await page.locator('#map-view:not([hidden])').waitFor();
  assert.equal(await page.locator("#driver-register-form").count(), 1);
  assert.equal(await page.locator("#driver-register-form [name=nickname]").count(), 1);
  assert.equal(await page.locator("#driver-register-form [name=driverType]").count(), 1);
  assert.equal(await page.locator('#driver-profile-view').isHidden(), true);
  await page.locator('[data-driver-target="profile"]').click();
  await page.locator('#driver-profile-view:not([hidden])').waitFor();
  await page.locator('[data-driver-target="map"]').click();
  await page.locator('#map-view:not([hidden])').waitFor();
  assert.equal(await page.evaluate(() => window.__mapCreated), true);
  assert.equal(await page.evaluate(() => window.__geo.watchCalls), 0);
  assert.equal(await page.locator("#gps-toggle").isChecked(), false);
  assert.equal(await page.locator("#visibility-toggle").count(), 0);
  assert.deepEqual(await page.locator("#nearby-radius option").evaluateAll((items) => items.map((item) => item.value)), ["5", "25", "50", "100"]);

  requests.length = 0;
  await page.locator("#gps-toggle").check();
  await page.waitForFunction(() => window.__geo.watchCalls === 1);
  assert.equal(await page.evaluate(() => window.__geo.watchCalls), 1);
  assert.deepEqual(requests.find((item) => item.path === "/api/driver/gps").body, { enabled: true });
  await page.evaluate(() => window.__geo.success({ coords: { latitude: 52.2297, longitude: 21.0122, accuracy: 12 } }));
  await page.waitForFunction(() => document.querySelector("#gps-state").dataset.state === "active" && document.querySelector("#gps-state").textContent.includes("видимы"));
  assert.deepEqual(await page.evaluate(() => window.__mapEaseTo || []), []);
  assert.equal(await page.locator("#map-locate").isEnabled(), true);
  await page.locator("#map-locate").click();
  assert.deepEqual(await page.evaluate(() => window.__mapEaseTo), [{ center: [21.0122, 52.2297], duration: 450 }]);
  await page.locator("#nearby-radius").selectOption("5");
  await page.waitForFunction(() => (window.__mapEaseTo || []).length === 2);
  const radiusMapState = await page.evaluate(() => ({ move: window.__mapEaseTo[1], radius: window.__fakeMap.getSource("driver-search-radius")?.data?.features?.[0]?.properties?.radiusKm }));
  assert.deepEqual(radiusMapState.move.center, [21.0122, 52.2297]);
  assert.ok(radiusMapState.move.zoom > 0);
  assert.equal(radiusMapState.radius, 5);
  assert.equal(requests.filter((item) => item.method === "PUT" && item.path === "/api/driver/location").length, 1);
  assert.deepEqual(requests.find((item) => item.path === "/api/driver/nearby").body, { radius: 25 });
  await page.waitForFunction(() => window.__markers?.some((marker) => marker.value?.[0] === 21.02));
  await page.evaluate(() => window.__markers.find((marker) => marker.value?.[0] === 21.02).getElement().click());
  await page.locator("#driver-card:not([hidden])").waitFor();
  assert.equal(await page.locator("#driver-card-name").textContent(), "NearbyDriver");
  await page.locator("#driver-card-chat").click();
  await page.locator("#chat-view:not([hidden])").waitFor();
  await page.waitForFunction(() => document.querySelector("#chat-room-title").textContent.includes("NearbyDriver"));
  assert.deepEqual(requests.find((item) => item.path === "/api/driver/chat/direct").body, { nickname: "NearbyDriver" });
  assert.equal(await page.locator("#chat-rooms button.active").textContent(), "Личный: NearbyDriver");
  assert.equal(await page.locator("#chat-rooms button").count(), 2);
  assert.equal(await page.locator("#chat-rooms").textContent().then((text) => text.includes("Общий чат")), true);
  assert.equal(await page.locator("#chat-direct-help").isHidden(), true);
  assert.equal(await page.locator(".chat-message").count(), 2);
  assert.equal(await page.locator(".chat-message .message-menu").count(), 2);
  assert.equal(await page.locator(".chat-message .message-menu button").filter({ hasText: "Копировать" }).count(), 2);
  assert.equal(await page.locator(".chat-message .message-menu button").filter({ hasText: "Удалить" }).count(), 1);
  await page.locator('.chat-message[data-message-id="901"] .message-menu summary').click();
  await page.locator('.chat-message[data-message-id="901"] .message-menu button').filter({ hasText: "Копировать" }).click();
  await page.waitForFunction(() => window.__copiedText === "Моё сообщение");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('.chat-message[data-message-id="901"] .message-menu summary').click();
  await page.locator('.chat-message[data-message-id="901"] .message-menu button.danger').click();
  await page.waitForFunction(() => document.querySelectorAll(".chat-message").length === 1);
  assert.equal(requests.some((item) => item.path === "/api/driver/chat/messages/901" && item.method === "DELETE"), true);

  await page.locator('[data-driver-target="radio"]').click();
  await page.locator("#radio-view:not([hidden])").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".radio-transmission").length === 2);
  assert.equal(await page.locator(".radio-transmission .message-menu").count(), 2);
  assert.equal(await page.locator(".radio-audio-player").count(), 2);
  assert.equal(await page.locator(".radio-transmission audio[controls]").count(), 0);
  assert.equal(await page.locator(".radio-transmission .message-menu a").filter({ hasText: "Скачать" }).count(), 2);
  assert.equal(await page.locator(".radio-transmission .message-menu button.danger").filter({ hasText: "Удалить" }).count(), 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('.radio-transmission[data-transmission-id="501"] .message-menu summary').click();
  await page.locator('.radio-transmission[data-transmission-id="501"] .message-menu button.danger').click();
  await page.waitForFunction(() => document.querySelectorAll(".radio-transmission").length === 1);
  assert.equal(requests.some((item) => item.path === "/api/driver/radio/transmissions/501" && item.method === "DELETE"), true);

  nearbyRelationship = "CONTACT";
  await page.locator('[data-driver-target="contacts"]').click();
  await page.locator("#contacts-view:not([hidden])").waitFor();
  await page.locator(".contacts-driver").click();
  await page.locator("#map-view:not([hidden])").waitFor();
  await page.locator("#driver-card:not([hidden])").waitFor();
  assert.equal(await page.locator("#driver-card-name").textContent(), "NearbyDriver");
  await page.locator("#driver-card-block").click();
  await page.waitForFunction(() => document.querySelector("#driver-card-block").textContent === "Разблокировать");
  assert.equal(await page.locator("#driver-card-block").isEnabled(), true);
  await page.locator("#driver-card-block").click();
  await page.waitForFunction(() => document.querySelector("#driver-card-block").textContent === "Блокировать");
  assert.equal(await page.locator("#driver-card-block").isEnabled(), true);

  await page.locator("#driver-card-close").click();
  await page.waitForFunction(() => document.querySelector("#driver-card").hidden === true);

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneLayout = await page.evaluate(() => {
    const nav = document.querySelector("#driver-nav");
    const map = document.querySelector("#driver-map");
    const main = document.querySelector("main");
    const active = document.querySelector("[data-driver-view]:not([hidden])");
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      outerOverflow: getComputedStyle(document.body).overflowY,
      outerScrollable: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
      navPosition: getComputedStyle(nav).position,
      navWidth: nav.getBoundingClientRect().width,
      navHeight: nav.getBoundingClientRect().height,
      mapWidth: map.getBoundingClientRect().width,
      mapHeight: map.getBoundingClientRect().height,
      activeHeight: active.getBoundingClientRect().height,
      mainHeight: main.getBoundingClientRect().height,
      viewportWidth: window.innerWidth
    };
  });
  assert.equal(phoneLayout.overflow, false);
  assert.equal(phoneLayout.outerOverflow, "hidden");
  assert.equal(phoneLayout.outerScrollable, false);
  assert.equal(phoneLayout.navPosition, "fixed");
  assert.ok(phoneLayout.navWidth <= phoneLayout.viewportWidth);
  assert.ok(phoneLayout.navHeight <= 56);
  assert.ok(phoneLayout.mapWidth <= phoneLayout.viewportWidth);
  assert.ok(phoneLayout.mapHeight > 0);
  assert.ok(phoneLayout.activeHeight <= phoneLayout.mainHeight);
  assert.equal(await page.locator("#driver-nav button").count(), 5);
  assert.equal(await page.locator("#gps-toggle").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(104, 224, 173)");

  await page.setViewportSize({ width: 390, height: 720 });
  const compactPhoneLayout = await page.evaluate(() => {
    const map = document.querySelector("#driver-map");
    return {
      outerScrollable: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
      mapHeight: map.getBoundingClientRect().height,
      mapBottom: map.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight
    };
  });
  assert.equal(compactPhoneLayout.outerScrollable, false);
  assert.ok(compactPhoneLayout.mapHeight >= 120);
  assert.ok(compactPhoneLayout.mapBottom <= compactPhoneLayout.viewportHeight, JSON.stringify(compactPhoneLayout));

  await page.setViewportSize({ width: 844, height: 390 });
  const landscapePhoneLayout = await page.evaluate(() => {
    const map = document.querySelector("#driver-map");
    const nav = document.querySelector("#driver-nav");
    return {
      outerScrollable: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
      mapHeight: map.getBoundingClientRect().height,
      mapBottom: map.getBoundingClientRect().bottom,
      navTop: nav.getBoundingClientRect().top,
      viewportHeight: window.innerHeight
    };
  });
  assert.equal(landscapePhoneLayout.outerScrollable, false, JSON.stringify(landscapePhoneLayout));
  assert.ok(landscapePhoneLayout.mapHeight >= 80, JSON.stringify(landscapePhoneLayout));
  assert.ok(landscapePhoneLayout.mapBottom <= landscapePhoneLayout.navTop, JSON.stringify(landscapePhoneLayout));

  await page.setViewportSize({ width: 390, height: 720 });

  for (const [target, viewId, scrollSelector] of [
    ["chat", "chat-view", "#chat-messages"],
    ["radio", "radio-view", "#radio-transmissions"],
    ["contacts", "contacts-view", "#contacts-list"],
    ["profile", "driver-profile-view", "#driver-profile-view"],
    ["map", "map-view", "#driver-map"]
  ]) {
    await page.locator(`[data-driver-target="${target}"]`).click();
    await page.locator(`#${viewId}:not([hidden])`).waitFor();
    const sectionLayout = await page.evaluate((selector) => {
      const main = document.querySelector("main");
      const active = document.querySelector("[data-driver-view]:not([hidden])");
      const scroll = document.querySelector(selector);
      const nav = document.querySelector("#driver-nav");
      return {
        outerScrollable: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
        activeHeight: active.getBoundingClientRect().height,
        mainHeight: main.getBoundingClientRect().height,
        activeBottom: active.getBoundingClientRect().bottom,
        navTop: nav.getBoundingClientRect().top,
        scrollOverflow: getComputedStyle(scroll).overflowY,
        scrollHeight: scroll.getBoundingClientRect().height
      };
    }, scrollSelector);
    assert.equal(sectionLayout.outerScrollable, false);
    assert.ok(sectionLayout.activeHeight <= sectionLayout.mainHeight);
    assert.ok(sectionLayout.activeBottom <= sectionLayout.navTop, JSON.stringify(sectionLayout));
    assert.ok(sectionLayout.scrollHeight > 0);
    assert.ok(["auto", "hidden"].includes(sectionLayout.scrollOverflow));
  }

  await page.setViewportSize({ width: 768, height: 1024 });
  const tabletLayout = await page.evaluate(() => {
    const nav = document.querySelector("#driver-nav");
    const map = document.querySelector("#driver-map");
    const main = document.querySelector("main");
    const active = document.querySelector("[data-driver-view]:not([hidden])");
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      outerOverflow: getComputedStyle(document.body).overflowY,
      outerScrollable: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
      navPosition: getComputedStyle(nav).position,
      navWidth: nav.getBoundingClientRect().width,
      mapWidth: map.getBoundingClientRect().width,
      mapHeight: map.getBoundingClientRect().height,
      activeHeight: active.getBoundingClientRect().height,
      mainHeight: main.getBoundingClientRect().height,
      viewportWidth: window.innerWidth
    };
  });
  assert.equal(tabletLayout.overflow, false);
  assert.equal(tabletLayout.outerOverflow, "hidden");
  assert.equal(tabletLayout.outerScrollable, false);
  assert.equal(tabletLayout.navPosition, "fixed");
  assert.ok(tabletLayout.navWidth <= tabletLayout.viewportWidth);
  assert.ok(tabletLayout.mapWidth <= tabletLayout.viewportWidth);
  assert.ok(tabletLayout.mapHeight > 0);
  assert.ok(tabletLayout.activeHeight <= tabletLayout.mainHeight);

  await page.setViewportSize({ width: 1024, height: 768 });
  const landscapeTabletLayout = await page.evaluate(() => {
    const map = document.querySelector("#driver-map");
    const nav = document.querySelector("#driver-nav");
    return {
      outerScrollable: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
      mapHeight: map.getBoundingClientRect().height,
      mapBottom: map.getBoundingClientRect().bottom,
      navTop: nav.getBoundingClientRect().top
    };
  });
  assert.equal(landscapeTabletLayout.outerScrollable, false);
  assert.ok(landscapeTabletLayout.mapHeight >= 120, JSON.stringify(landscapeTabletLayout));
  assert.ok(landscapeTabletLayout.mapBottom <= landscapeTabletLayout.navTop, JSON.stringify(landscapeTabletLayout));

  await page.evaluate(() => {
    window.__geo.success({ coords: { latitude: 52.2300, longitude: 21.0125, accuracy: 11 } });
    window.__geo.success({ coords: { latitude: 52.2302, longitude: 21.0127, accuracy: 10 } });
  });
  await page.waitForTimeout(150);
  assert.equal(requests.filter((item) => item.method === "PUT" && item.path === "/api/driver/location").length, 1);

  requests.length = 0;
  await page.reload();
  await page.locator("#map-view:not([hidden])").waitFor();
  await page.waitForFunction(() => window.__geo.watchCalls === 1);
  assert.equal(await page.locator("#gps-toggle").isChecked(), true);
  assert.equal(requests.some((item) => item.path === "/api/driver/gps"), false);
  await page.evaluate(() => window.__geo.success({ coords: { latitude: 52.23, longitude: 21.01, accuracy: 10 } }));
  await page.waitForFunction(() => document.querySelector("#gps-state").textContent.includes("видимы"));
  assert.equal(requests.some((item) => item.path === "/api/driver/location" && item.method === "PUT"), true);
  assert.equal(requests.some((item) => item.path === "/api/driver/nearby"), true);

  requests.length = 0;
  await page.setViewportSize({ width: 390, height: 720 });
  await page.locator("#gps-toggle").uncheck();
  await page.waitForFunction(() => document.querySelector("#gps-state").textContent.includes("Driver выключен"));
  assert.equal(await page.locator("#gps-toggle").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(201, 88, 81)");
  assert.deepEqual(await page.evaluate(() => window.__geo.clearCalls), [77]);
  assert.deepEqual(requests.find((item) => item.path === "/api/driver/gps").body, { enabled: false });
  await page.evaluate(() => window.__geo.success({ coords: { latitude: 52.24, longitude: 21.02, accuracy: 9 } }));
  await page.waitForTimeout(100);
  assert.equal(requests.some((item) => item.path === "/api/driver/location" && item.method === "PUT"), false);
  assert.equal(requests.some((item) => item.path === "/api/driver/nearby"), false);

  requests.length = 0;
  await page.reload();
  await page.locator("#map-view:not([hidden])").waitFor();
  assert.equal(await page.evaluate(() => window.__geo.watchCalls), 0);
  assert.equal(await page.locator("#gps-toggle").isChecked(), false);

  await page.locator("#gps-toggle").check();
  await page.waitForFunction(() => window.__geo.watchCalls === 1);
  await page.evaluate(() => window.__geo.failure({ code: 1 }));
  await page.waitForFunction(() => document.querySelector("#gps-state").dataset.state === "error");
  assert.equal(await page.locator("#gps-toggle").isChecked(), false);
  assert.equal(requests.filter((item) => item.path === "/api/driver/gps" && item.body.enabled === false).length, 1);

  requests.length = 0;
  await page.locator("#gps-toggle").check();
  await page.waitForFunction(() => window.__geo.watchCalls === 2);
  await page.evaluate(() => window.__geo.success({ coords: { latitude: 52.25, longitude: 21.03, accuracy: 8 } }));
  await page.waitForFunction(() => document.querySelector("#gps-state").textContent.includes("видимы"));
  requests.length = 0;
  await page.locator("#logout").click();
  await page.locator("#login-view:not([hidden])").waitFor();
  assert.equal(await page.locator("#driver-card").isHidden(), true);
  assert.equal(await page.locator("#driver-search-results button").count(), 0);
  assert.equal(requests.some((item) => item.path === "/api/driver/location" && item.method === "DELETE"), true);
  assert.equal(requests.some((item) => item.path === "/api/driver/gps" && item.body.enabled === false), false);

  await page.locator("#login-form [name=identifier]").fill("driver-test");
  await page.locator("#login-form [name=password]").fill("driver-test-password");
  await page.locator("#login-form button[type=submit]").click();
  await page.locator("#map-view:not([hidden])").waitFor();
  contactsUnauthorized = true;
  await page.locator('[data-driver-target="contacts"]').click();
  await page.locator("#login-view:not([hidden])").waitFor();
  assert.equal(await page.locator("#message").textContent(), "Сессия истекла. Войдите снова.");
});
