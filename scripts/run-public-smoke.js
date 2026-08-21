const assert = require("node:assert/strict");

const DEFAULT_TARGETS = ["https://patap.eu", "https://driver.patap.eu"];
const targets = String(process.env.PATAP_PUBLIC_SMOKE_URLS || "")
  .split(/[;,\s]+/)
  .map((value) => value.trim())
  .filter(Boolean);
const urls = targets.length ? targets : DEFAULT_TARGETS;
const timeoutMs = Math.min(30000, Math.max(1000, Number(process.env.PATAP_PUBLIC_SMOKE_TIMEOUT_MS) || 10000));

async function check(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { "User-Agent": "PaTaP-Public-Smoke/1" },
      signal: controller.signal
    });
    assert.ok(response.status >= 200 && response.status < 400, `${url} returned HTTP ${response.status}`);
    console.log(`PUBLIC_SMOKE PASS ${url} -> ${response.status} ${response.url}`);
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  try {
    for (const url of urls) await check(url);
    console.log(`PUBLIC_SMOKE PASS ${urls.length}/${urls.length}`);
  } catch (error) {
    console.error(`PUBLIC_SMOKE FAIL ${error?.message || error}`);
    process.exitCode = 1;
  }
})();
