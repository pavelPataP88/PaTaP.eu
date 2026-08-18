import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panelSource = await readFile(new URL("../../driver/map/road-reports-panel.mjs", import.meta.url), "utf8");
const mapSource = await readFile(new URL("../../driver/map/index.js", import.meta.url), "utf8");
const guestSource = await readFile(new URL("../../driver/map/guest-road-reports.mjs", import.meta.url), "utf8");
const appSource = await readFile(new URL("../../driver/app.js", import.meta.url), "utf8");

test("road report creation is GPS-first with mobile staged controls", () => {
  assert.match(panelSource, /\+ событие/);
  assert.match(panelSource, /Что происходит рядом\?/);
  assert.match(panelSource, /Полоса — необязательно/);
  assert.match(panelSource, /Создать событие здесь\?/);
  assert.match(panelSource, /getOwnLocation\?\.\(\)/);
  assert.match(panelSource, /latitude: location\.latitude/);
  assert.match(panelSource, /longitude: location\.longitude/);
  assert.doesNotMatch(panelSource, /map\.on\(["']click|event\.lngLat|setLngLat\(\[event/);
  assert.match(panelSource, /minHeight: "48px"/);
  assert.match(panelSource, /aria-label/);
});

test("lane is optional only after accident or road work", () => {
  assert.match(panelSource, /ACCIDENT: \{ label: "ДТП"[^\n]+lanes: true/);
  assert.match(panelSource, /ROADWORK: \{ label: "Работы"[^\n]+lanes: true/);
  assert.match(panelSource, /OBSTACLE: \{ label: "Препятствие"[^\n]+lanes: false/);
  assert.match(panelSource, /Без уточнения/);
  assert.match(panelSource, /selectedLane = null/);
  assert.doesNotMatch(panelSource, /type="file"|textarea|name="comment"|name="message"/);
});

test("created marker is immediate, offset above GPS and exposes TTL and confirmations", () => {
  assert.match(panelSource, /upsertMarker\(data\.report\)/);
  assert.match(panelSource, /offset: \[0, -30\]/);
  assert.match(panelSource, /formatExpiry\(report\.expiresAt\)/);
  assert.match(panelSource, /Ещё актуально/);
  assert.match(panelSource, /Уже нет/);
  assert.match(panelSource, /roadConfirm = "ACTIVE"|dataset\.roadConfirm = "ACTIVE"/);
  assert.match(panelSource, /roadConfirm = "GONE"|dataset\.roadConfirm = "GONE"/);
  assert.match(mapSource, /new window\.maplibregl\.Marker\(\{ color: "#2f8cff" \}\)/);
});

test("guest road reports stay explicit, read-only and lazy", () => {
  assert.match(appSource, /if \(view === "map"\)/);
  assert.match(appSource, /import\("\.\/map\/guest-road-reports\.mjs/);
  assert.doesNotMatch(appSource, /^import .*guest-road-reports/m);
  assert.match(guestSource, /await ensureMapLibre\(\)/);
  assert.match(guestSource, /api\("\/api\/driver\/road-reports"\)/);
  assert.doesNotMatch(guestSource, /\/confirm|method:\s*"POST"|authorId|userId|nickname/);
});
