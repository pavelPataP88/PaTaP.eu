import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createMapLibreLoader,
  MAPLIBRE_CSS_URL,
  MAPLIBRE_JS_URL
} from "../../driver/map/maplibre-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

function createFakeBrowser(outcomes = { css: "load", js: "load" }) {
  const nodes = [];
  const windowRef = {};

  function createElement(tagName) {
    const listeners = new Map();
    const node = {
      tagName: tagName.toUpperCase(),
      dataset: {},
      removed: false,
      addEventListener(type, callback) { listeners.set(type, callback); },
      remove() { node.removed = true; },
      dispatch(type) { listeners.get(type)?.(); }
    };
    return node;
  }

  const documentRef = {
    head: {
      append(node) {
        nodes.push(node);
        queueMicrotask(() => {
          if (node.tagName === "LINK") node.dispatch(outcomes.css);
          if (node.tagName === "SCRIPT") {
            if (outcomes.js === "load") windowRef.maplibregl = { Map: class {} };
            node.dispatch(outcomes.js);
          }
        });
      }
    },
    createElement,
    querySelector(selector) {
      if (selector.startsWith("link")) return nodes.find((node) => !node.removed && node.dataset.driverMaplibreCss === "true") || null;
      if (selector.startsWith("script")) return nodes.find((node) => !node.removed && node.dataset.driverMaplibreJs === "true") || null;
      return null;
    }
  };

  return { documentRef, windowRef, nodes };
}

function activeNodes(nodes, tagName) {
  return nodes.filter((node) => !node.removed && node.tagName === tagName);
}

test("Driver shell has no eager MapLibre stylesheet", async () => {
  const html = await readFile(resolve(repoRoot, "driver/index.html"), "utf8");
  assert.equal(html.includes("/vendor/maplibre/maplibre-gl.css?v=20260714-8"), false);
});

test("MapLibre assets stay unloaded until map activation and are connected once", async () => {
  const browser = createFakeBrowser();
  const loadMapLibre = createMapLibreLoader(browser);

  assert.equal(browser.nodes.length, 0, "creating/importing the loader must not append map assets");

  const first = loadMapLibre();
  const second = loadMapLibre();
  assert.strictEqual(second, first, "concurrent map activation must share one loading promise");
  await first;

  assert.equal(activeNodes(browser.nodes, "LINK").length, 1);
  assert.equal(activeNodes(browser.nodes, "SCRIPT").length, 1);
  assert.equal(activeNodes(browser.nodes, "LINK")[0].href, MAPLIBRE_CSS_URL);
  assert.equal(activeNodes(browser.nodes, "SCRIPT")[0].src, MAPLIBRE_JS_URL);

  await loadMapLibre();
  assert.equal(activeNodes(browser.nodes, "LINK").length, 1, "repeat activation must not add a second stylesheet");
  assert.equal(activeNodes(browser.nodes, "SCRIPT").length, 1, "repeat activation must not add a second script");
});

test("MapLibre CSS failure is reported and can be retried without duplicating JS", async () => {
  const outcomes = { css: "error", js: "load" };
  const browser = createFakeBrowser(outcomes);
  const loadMapLibre = createMapLibreLoader(browser);

  await assert.rejects(loadMapLibre(), /maplibre_css_load_failed/);
  assert.equal(activeNodes(browser.nodes, "LINK").length, 0);
  assert.equal(activeNodes(browser.nodes, "SCRIPT").length, 1);

  outcomes.css = "load";
  await loadMapLibre();
  assert.equal(activeNodes(browser.nodes, "LINK").length, 1);
  assert.equal(activeNodes(browser.nodes, "SCRIPT").length, 1);
});
