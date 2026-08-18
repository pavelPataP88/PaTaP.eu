import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { roadReportDistanceKm, validateRoadReportPoint } from "../../driver/map/road-reports-overlay.mjs";

const source = await readFile(new URL("../../driver/map/road-reports-overlay.mjs", import.meta.url), "utf8");
const mapSource = await readFile(new URL("../../driver/map/index.js", import.meta.url), "utf8");

test("road report controls are map overlay and creation waits for a map click", () => {
  assert.match(source, /mapElement\.append\(overlay\)/);
  assert.match(source, /overlay\.style\.position = "absolute"/);
  assert.match(source, /toggle\.textContent = "\+ событие"/);
  assert.match(source, /map\.on\?\.\("click", handleMapClick\)/);
  assert.match(source, /createAt\(\{ longitude: lng, latitude: lat \}\)/);
  assert.doesNotMatch(source, /latitude:\s*ownLocation\.latitude[\s\S]*longitude:\s*ownLocation\.longitude/);
});

test("point validation blocks distant clicks and GPS-marker overlap", () => {
  const own = { latitude: 50.2649, longitude: 19.0238 };
  const close = { latitude: 50.2660, longitude: 19.0250 };
  const overlap = { latitude: 50.26491, longitude: 19.02381 };
  const far = { latitude: 50.31, longitude: 19.08 };

  assert.ok(roadReportDistanceKm(own, close) > 0.02);
  assert.equal(validateRoadReportPoint(own, close).ok, true);
  assert.deepEqual(validateRoadReportPoint(own, overlap).error, "overlaps_own_marker");
  assert.deepEqual(validateRoadReportPoint(own, far).error, "too_far");
});

test("successful POST paints the returned marker immediately and marker is visually distinct", () => {
  assert.match(source, /const data = await api\("\/api\/driver\/road-reports", \{ method: "POST", body \}\)/);
  assert.match(source, /if \(data\.report\) upsertMarker\(data\.report\)/);
  assert.match(source, /element\.className = `road-report-marker/);
  assert.match(source, /element\.style\.minWidth = "42px"/);
  assert.match(source, /element\.style\.background = report\.type === "ROADWORK" \? "#ff7a00" : "#ffb000"/);
  assert.match(mapSource, /new window\.maplibregl\.Marker\(\{ color: "#2f8cff" \}\)/);
});

test("authenticated map keeps MapLibre lazy and road reports overlay has no asset loader", () => {
  assert.match(mapSource, /await ensureMapLibre\(\)/);
  assert.match(mapSource, /createRoadReportsOverlay\(/);
  assert.doesNotMatch(source, /ensureMapLibre|maplibre-gl\.js|maplibre-gl\.css/);
});
