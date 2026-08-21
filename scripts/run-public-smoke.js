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
    if (response.status < 200 || response.status >= 400) throw new Error(`${url} returned HTTP ${response.status}`);
    return { ok: true, url, detail: `${response.status} ${response.url}` };
  } catch (error) {
    return { ok: false, url, detail: error?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  const results = [];
  for (const url of urls) results.push(await check(url));
  for (const result of results) {
    const stream = result.ok ? console.log : console.error;
    stream(`PUBLIC_SMOKE ${result.ok ? "PASS" : "FAIL"} ${result.url} -> ${result.detail}`);
  }
  const passed = results.filter((result) => result.ok).length;
  console.log(`PUBLIC_SMOKE SUMMARY ${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
})();
