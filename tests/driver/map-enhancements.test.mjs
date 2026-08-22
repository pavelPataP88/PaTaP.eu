import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  angleDelta,
  bearingDegrees,
  gpsQuality,
  haversineKm,
  roadReportsAhead,
  suggestRadiusForZoom
} from "../../driver/map/map-experience.mjs";
import { clusterRoadReports, reportFreshness } from "../../driver/map/road-reports-panel.mjs";

const mapSource = await readFile(new URL("../../driver/map/index.js", import.meta.url), "utf8");
const gpsSource = await readFile(new URL("../../driver/gps/index.js", import.meta.url), "utf8");
const experienceSource = await readFile(new URL("../../driver/map/map-experience.mjs", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../../driver/map/map-ui-styles.mjs", import.meta.url), "utf8");
const reportsSource = await readFile(new URL("../../driver/map/road-reports-panel.mjs", import.meta.url), "utf8");
const guestSource = await readFile(new URL("../../driver/map/guest-road-reports.mjs", import.meta.url), "utf8");

test("map math supports distance, heading cone and zoom-based radius suggestions", () => {
  assert.ok(haversineKm(50.2649, 19.0238, 50.2659, 19.0238) > 0.1);
  assert.ok(haversineKm(50.2649, 19.0238, 50.2659, 19.0238) < 0.12);
  const north = bearingDegrees(50, 19, 50.1, 19);
  assert.ok(north < 1 || north > 359);
  assert.equal(angleDelta(350, 10), 20);
  assert.equal(suggestRadiusForZoom(13), 5);
  assert.equal(suggestRadiusForZoom(10), 25);
  assert.equal(suggestRadiusForZoom(8), 50);
  assert.equal(suggestRadiusForZoom(5), 100);
});

test("ahead list prefers nearby events in the current heading cone", () => {
  const own = { latitude: 50, longitude: 19, heading: 0 };
  const reports = [
    { id: 1, type: "ACCIDENT", latitude: 50.02, longitude: 19 },
    { id: 2, type: "ROADWORK", latitude: 49.98, longitude: 19 },
    { id: 3, type: "OBSTACLE", latitude: 50.04, longitude: 19.005 }
  ];
  const ahead = roadReportsAhead(reports, own, { maxDistanceKm: 10 });
  assert.ok(ahead.some((item) => item.id === 1));
  assert.ok(ahead.some((item) => item.id === 3));
  assert.equal(ahead.some((item) => item.id === 2), false);
  assert.ok(ahead[0].distanceKm <= ahead.at(-1).distanceKm);
});

test("GPS quality gives clear thresholds", () => {
  assert.equal(gpsQuality(12).level, "good");
  assert.equal(gpsQuality(40).level, "fair");
  assert.equal(gpsQuality(90).level, "poor");
});

test("road report freshness fades only as TTL runs down", () => {
  const createdAt = new Date("2026-08-18T12:00:00Z").toISOString();
  const expiresAt = new Date("2026-08-18T13:00:00Z").toISOString();
  assert.equal(reportFreshness({ createdAt, expiresAt }, Date.parse("2026-08-18T12:10:00Z")).phase, "fresh");
  assert.equal(reportFreshness({ createdAt, expiresAt }, Date.parse("2026-08-18T12:40:00Z")).phase, "aging");
  const old = reportFreshness({ createdAt, expiresAt }, Date.parse("2026-08-18T12:55:00Z"));
  assert.equal(old.phase, "old");
  assert.ok(old.opacity < 0.6);
});

test("road reports cluster at distant zoom and split at street zoom", () => {
  const reports = [
    { id: 1, type: "ACCIDENT", latitude: 50.2649, longitude: 19.0238 },
    { id: 2, type: "ROADWORK", latitude: 50.2650, longitude: 19.0240 }
  ];
  const distant = clusterRoadReports(reports, 6);
  assert.equal(distant.length, 1);
  assert.equal(distant[0].kind, "cluster");
  assert.equal(distant[0].count, 2);
  const close = clusterRoadReports(reports, 13);
  assert.equal(close.length, 2);
  assert.ok(close.every((item) => item.kind === "report"));
});

test("map integrates follow mode, accuracy, layers, driver clusters and auto radius without eager MapLibre", () => {
  assert.match(mapSource, /createMapExperience/);
  assert.match(mapSource, /installMapUiStyles/);
  assert.match(mapSource, /driver-map-marker/);
  assert.match(mapSource, /driver-map-cluster/);
  assert.match(mapSource, /patap:map-radius/);
  assert.match(gpsSource, /heading:/);
  assert.match(gpsSource, /timestamp:/);
  assert.match(gpsSource, /patap:map-radius/);
  assert.match(experienceSource, /driver-gps-accuracy/);
  assert.match(experienceSource, /FOLLOW.*HEADING/);
  assert.match(experienceSource, /Дорожные события/);
  assert.match(experienceSource, /Что рядом/);
  assert.match(experienceSource, /Впереди/);
  assert.doesNotMatch(experienceSource, /ensureMapLibre|new window\.maplibregl\.Map/);
  assert.match(mapSource, /await ensureMapLibre\(\)/);
  const afterLoader = mapSource.slice(mapSource.indexOf("await ensureMapLibre()"), mapSource.indexOf("await ensureMapLibre()") + 420);
  assert.match(afterLoader, /if \(map\) return true;/);
});

test("mobile overlay moves GPS and radius controls onto the map without replacing their handlers", () => {
  assert.match(stylesSource, /moveLegacyControlsIntoOverlay/);
  assert.match(stylesSource, /\.map-layers-panel/);
  assert.match(stylesSource, /#map-view \.privacy-controls/);
  assert.match(stylesSource, /#map-view \.radius-control/);
  assert.match(stylesSource, /#gps-state/);
  assert.match(stylesSource, /Рядом · 5 км/);
  assert.match(stylesSource, /Район · 25 км/);
  assert.match(stylesSource, /MutationObserver/);
});

test("offline road report queue is short-lived and guarded by fresh nearby GPS", () => {
  assert.match(reportsSource, /OFFLINE_QUEUE_MAX_AGE_MS = 2 \* 60_000/);
  assert.match(reportsSource, /RETRY_GPS_MAX_AGE_MS = 30_000/);
  assert.match(reportsSource, /RETRY_MAX_DISTANCE_KM = 0\.25/);
  assert.match(reportsSource, /navigator\?\.onLine === false/);
  assert.match(reportsSource, /flushOfflineQueue/);
  assert.match(reportsSource, /setVisible\(nextVisible\)/);
});

test("guest road report map remains read-only", () => {
  assert.match(guestSource, /ensureMapLibre\(\)/);
  assert.match(guestSource, /api\("\/api\/driver\/road-reports"\)/);
  assert.doesNotMatch(guestSource, /\/confirm|method:\s*"POST"|authorId|userId|nickname/);
});

test("authenticated map starts closer and first GPS focuses once without repeated zoom jumps", () => {
  assert.match(mapSource, /const INITIAL_MAP_ZOOM = 11/);
  assert.match(mapSource, /const GPS_FOCUS_ZOOM = 14/);
  assert.match(mapSource, /zoom: Math\.max\(INITIAL_MAP_ZOOM, configuredZoom\)/);
  assert.match(mapSource, /let initialGpsFocused = false/);
  assert.match(mapSource, /if \(!initialGpsFocused\) \{ initialGpsFocused = true; focusOwn\(\); \}/);
  assert.match(mapSource, /initialGpsFocused = false; clearRadiusOverlay/);
  assert.match(mapSource, /zoom: Math\.max\(GPS_FOCUS_ZOOM/);
});
