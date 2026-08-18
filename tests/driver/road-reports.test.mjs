import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../driver/map/index.js", import.meta.url), "utf8");

test("road reports use a separate marker collection and fixed structured types", () => {
  assert.match(source, /const roadReportMarkers = new Map\(\)/);
  assert.match(source, /ACCIDENT: \{ label: "ДТП"/);
  assert.match(source, /ROADWORK: \{ label: "Дорожные работы"/);
  assert.match(source, /OBSTACLE: \{ label: "Препятствие"/);
  assert.match(source, /ROAD_CONTROL: \{ label: "Дорожный контроль"/);
  assert.match(source, /TRANSPORT_INSPECTION: \{ label: "Транспортная инспекция"/);
  assert.doesNotMatch(source, /name="comment"|name="message"|type="file"/);
});

test("client creates reports only from current own GPS and supports active/gone confirmation", () => {
  assert.match(source, /latitude: ownLocation\.latitude/);
  assert.match(source, /longitude: ownLocation\.longitude/);
  assert.match(source, /\/api\/driver\/road-reports/);
  assert.match(source, /status = "ACTIVE"/);
  assert.match(source, /status = "GONE"/);
  assert.match(source, /\/confirm`/);
});
