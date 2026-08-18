import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mapSource = await readFile(new URL("../../driver/map/index.js", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../../driver/map/road-reports-panel.mjs", import.meta.url), "utf8");
const guestSource = await readFile(new URL("../../driver/map/guest-road-reports.mjs", import.meta.url), "utf8");
const appSource = await readFile(new URL("../../driver/app.js", import.meta.url), "utf8");

test("road reports keep fixed structured types and no free text or files", () => {
  assert.match(panelSource, /ACCIDENT: \{ label: "ДТП"/);
  assert.match(panelSource, /ROADWORK: \{ label: "Работы"/);
  assert.match(panelSource, /OBSTACLE: \{ label: "Препятствие"/);
  assert.match(panelSource, /ROAD_CONTROL: \{ label: "Контроль"/);
  assert.match(panelSource, /TRANSPORT_INSPECTION: \{ label: "Инспекция"/);
  assert.match(panelSource, /ROAD_REPORT_LANES/);
  assert.doesNotMatch(panelSource, /name="comment"|name="message"|type="file"|textarea/);
  assert.match(mapSource, /createRoadReportPanel/);
});

test("authenticated report creation remains GPS-first and confirmation stays structured", () => {
  assert.match(panelSource, /getOwnLocation/);
  assert.match(panelSource, /latitude:\s*location\.latitude/);
  assert.match(panelSource, /longitude:\s*location\.longitude/);
  assert.match(panelSource, /data-road-confirm|roadConfirm/);
  assert.match(panelSource, /"ACTIVE"/);
  assert.match(panelSource, /"GONE"/);
});

test("guest road reports are read-only and MapLibre loads only after explicit guest map click", () => {
  assert.match(appSource, /if \(view === "map"\)/);
  assert.match(appSource, /import\("\.\/map\/guest-road-reports\.mjs/);
  assert.doesNotMatch(appSource, /^import .*guest-road-reports/m);
  assert.match(guestSource, /await ensureMapLibre\(\)/);
  assert.match(guestSource, /api\("\/api\/driver\/road-reports"\)/);
  assert.doesNotMatch(guestSource, /\/confirm|method:\s*"POST"|confirmRoadReport|authorId|userId|nickname/);
});
