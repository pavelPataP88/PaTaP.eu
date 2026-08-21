import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clusterRoadReports, reportFreshness } from "../../driver/map/road-reports-panel.mjs";

const panelSource = await readFile(new URL("../../driver/map/road-reports-panel.mjs", import.meta.url), "utf8");
const mapSource = await readFile(new URL("../../driver/map/index.js", import.meta.url), "utf8");

test("road report controls remain a map overlay but creation is GPS-first rather than map-click positioning", () => {
  assert.match(panelSource, /mapElement\.append\(overlay\)/);
  assert.match(panelSource, /position: "absolute"/);
  assert.match(panelSource, /makeButton\("\+ событие"/);
  assert.match(panelSource, /getOwnLocation\?\.\(\)/);
  assert.match(panelSource, /latitude: location\.latitude/);
  assert.match(panelSource, /longitude: location\.longitude/);
  assert.doesNotMatch(panelSource, /event\.lngLat|handleMapClick|createAt\(/,
    "road report creation must not regress to arbitrary map-click coordinates");
});

test("map presentation still clusters distant reports and fades them as TTL runs down", () => {
  const reports = [
    { id: 1, latitude: 50.2649, longitude: 19.0238 },
    { id: 2, latitude: 50.2650, longitude: 19.0240 }
  ];
  const clustered = clusterRoadReports(reports, 7);
  assert.equal(clustered.length, 1);
  assert.equal(clustered[0].kind, "cluster");
  assert.equal(clustered[0].count, 2);

  const createdAt = "2026-08-21T10:00:00.000Z";
  const expiresAt = "2026-08-21T11:00:00.000Z";
  const fresh = reportFreshness({ createdAt, expiresAt }, Date.parse("2026-08-21T10:10:00.000Z"));
  const old = reportFreshness({ createdAt, expiresAt }, Date.parse("2026-08-21T10:55:00.000Z"));
  assert.ok(fresh.opacity > old.opacity);
  assert.equal(old.phase, "old");
});

test("successful POST paints the returned marker immediately and keeps it distinct from own GPS", () => {
  assert.match(panelSource, /const data = await api\("\/api\/driver\/road-reports"/);
  assert.match(panelSource, /if \(data\.report\) upsertReport\(data\.report\)/);
  assert.match(panelSource, /element\.className = "road-report-marker"/);
  assert.match(panelSource, /minWidth: "42px"/);
  assert.match(panelSource, /background: "#ffb454"/);
  assert.match(panelSource, /offset: \[0, -30\]/);
  assert.match(mapSource, /new window\.maplibregl\.Marker\(\{ color: "#2f8cff" \}\)/);
});

test("authenticated map keeps MapLibre lazy and mounts the current road report panel without its own asset loader", () => {
  assert.match(mapSource, /await ensureMapLibre\(\)/);
  assert.match(mapSource, /createRoadReportPanel\(/);
  assert.doesNotMatch(panelSource, /ensureMapLibre|maplibre-gl\.js|maplibre-gl\.css/);
});
