import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mapSource = await readFile(new URL("../../driver/map/index.js", import.meta.url), "utf8");
const guestSource = await readFile(new URL("../../driver/map/guest-road-reports.mjs", import.meta.url), "utf8");
const appSource = await readFile(new URL("../../driver/app.js", import.meta.url), "utf8");

test("road reports keep separate markers and fixed structured types", () => {
  assert.match(mapSource, /const roadReportMarkers = new Map\(\)/);
  assert.match(mapSource, /ACCIDENT: \{ label: "ДТП"/);
  assert.match(mapSource, /ROADWORK: \{ label: "Дорожные работы"/);
  assert.match(mapSource, /OBSTACLE: \{ label: "Препятствие"/);
  assert.doesNotMatch(mapSource, /name="comment"|name="message"|type="file"/);
});

test("guest road reports are read-only and MapLibre loads only after explicit guest map click", () => {
  assert.match(appSource, /if \(view === "map"\)/);
  assert.match(appSource, /import\("\.\/map\/guest-road-reports\.mjs/);
  assert.doesNotMatch(appSource, /^import .*guest-road-reports/m);
  assert.match(guestSource, /await ensureMapLibre\(\)/);
  assert.match(guestSource, /api\("\/api\/driver\/road-reports"\)/);
  assert.doesNotMatch(guestSource, /\/confirm|method:\s*"POST"|confirmRoadReport|authorId|userId|nickname/);
});

