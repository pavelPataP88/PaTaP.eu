import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../driver/map/index.js", import.meta.url), "utf8");

test("clearing own GPS also clears the rendered search-radius geometry", () => {
  assert.match(source, /function clearRadiusOverlay\(\)/);
  assert.match(source, /setData\(\{ type: "FeatureCollection", features: \[\] \}\)/);
  assert.match(source, /function clearOwn\(\)[\s\S]*?ownLocation = null;[\s\S]*?clearRadiusOverlay\(\);/);
});
