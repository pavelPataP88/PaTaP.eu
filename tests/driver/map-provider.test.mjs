import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeMapProvider, validateMapProvider } from "../../driver/map/provider-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const defaultProvider = JSON.parse(read("driver/map-provider.json"));

test("map provider validates explicit HTTPS or same-origin tile templates and preserves attribution", () => {
  const provider = validateMapProvider({
    version: 1,
    id: "commercial-example",
    mode: "CUSTOM",
    tiles: ["https://maps.example.test/tiles/{z}/{x}/{y}.png", "/tiles/{z}/{x}/{y}.png"],
    tileSize: 512,
    maxZoom: 20,
    attribution: "© Example Maps · © OpenStreetMap contributors",
    reportIssueUrl: "https://maps.example.test/report"
  });
  assert.equal(provider.id, "commercial-example");
  assert.equal(provider.tiles.length, 2);
  assert.equal(provider.tileSize, 512);
  assert.equal(provider.maxZoom, 20);
  assert.match(provider.attribution, /OpenStreetMap contributors/);
});

test("map provider fails closed on insecure, credentialed or structurally incomplete tile endpoints", () => {
  for (const tiles of [
    ["http://maps.example.test/{z}/{x}/{y}.png"],
    ["https://user:secret@maps.example.test/{z}/{x}/{y}.png"],
    ["https://maps.example.test/{z}/{x}.png"],
    ["//maps.example.test/{z}/{x}/{y}.png"]
  ]) {
    assert.throws(() => validateMapProvider({ version: 1, id: "bad-provider", mode: "CUSTOM", tiles, maxZoom: 19, attribution: "Required" }), /invalid_map_provider/);
  }
});

test("provider merge discards any embedded legacy provider before applying the selected config", () => {
  const merged = mergeMapProvider({
    center: [19.1451, 51.9194], zoom: 5, maxZoom: 19,
    tiles: ["https://legacy.invalid/{z}/{x}/{y}.png"], attribution: "legacy", tileSize: 256
  }, defaultProvider);
  assert.deepEqual(merged.tiles, defaultProvider.tiles);
  assert.equal(merged.attribution, defaultProvider.attribution);
  assert.equal(merged.mapProvider.id, defaultProvider.id);
  assert.equal(merged.maxZoom, 19);
  assert.ok(!JSON.stringify(merged).includes("legacy.invalid"));
});

test("Driver map is bootstrapped through a no-store provider config and the build ships the default fallback", () => {
  const registry = JSON.parse(read("driver/module-registry.json"));
  const mapModule = registry.modules.find((module) => module.id === "map");
  const bootstrap = read("driver/map/provider-bootstrap.mjs");
  const build = read("scripts/build.js");
  assert.match(mapModule.entry, /^\.\/map\/provider-bootstrap\.mjs\?/);
  assert.match(bootstrap, /fetch\(PROVIDER_URL/);
  assert.match(bootstrap, /cache:\s*"no-store"/);
  assert.match(bootstrap, /delete parsed\.tiles/);
  assert.match(bootstrap, /delete parsed\.attribution/);
  assert.match(build, /"map-provider\.json"/);
  assert.equal(defaultProvider.mode, "PUBLIC_OSM_FALLBACK");
  assert.match(defaultProvider.tiles[0], /^https:\/\/tile\.openstreetmap\.org\//);
});
