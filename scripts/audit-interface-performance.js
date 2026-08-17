const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");
const { createIsolatedAuth, getFreePort } = require("../tests/helpers/isolated-auth");

const root = path.resolve(__dirname, "..");
const label = process.argv[2] || "current";
const outputDir = path.join(root, "var", "performance");

function startWebServer(port, authBaseUrl) {
  const dist = path.join(root, "var", "build", "dist");
  const auth = new URL(authBaseUrl);
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      const proxy = http.request({
        hostname: auth.hostname, port: auth.port, path: req.url, method: req.method,
        headers: { ...req.headers, host: auth.host, origin: "http://127.0.0.1:8090" }
      }, (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
      });
      req.pipe(proxy);
      return;
    }
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = path.resolve(dist, relative);
    if (!file.startsWith(`${dist}${path.sep}`) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return server ? new Promise((resolve) => server.close(resolve)) : Promise.resolve();
}

function summarizeTrace(trace) {
  const complete = trace.traceEvents.filter((event) => event.ph === "X");
  const duration = (name) => complete.filter((event) => event.name === name);
  const totalMs = (events) => events.reduce((sum, event) => sum + (event.dur || 0), 0) / 1000;
  const tasks = duration("RunTask");
  const layouts = duration("Layout");
  const styles = duration("UpdateLayoutTree");
  const paints = duration("Paint");
  const composites = duration("CompositeLayers");
  const shifts = trace.traceEvents.filter((event) => event.name === "LayoutShift" && !event.args?.data?.had_recent_input);
  const timestamps = complete.map((event) => event.ts || 0);
  return {
    traceDurationMs: Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 1000),
    longTasks: tasks.filter((event) => (event.dur || 0) >= 50000).length,
    maxTaskMs: Number(Math.max(0, ...tasks.map((event) => (event.dur || 0) / 1000)).toFixed(2)),
    layoutCount: layouts.length,
    layoutMs: Number(totalMs(layouts).toFixed(2)),
    forcedLayoutCandidates: layouts.filter((event) => event.args?.beginData?.stackTrace || event.args?.data?.stackTrace).length,
    styleRecalcCount: styles.length,
    styleRecalcMs: Number(totalMs(styles).toFixed(2)),
    paintCount: paints.length,
    paintMs: Number(totalMs(paints).toFixed(2)),
    compositeCount: composites.length,
    compositeMs: Number(totalMs(composites).toFixed(2)),
    layoutShiftCount: shifts.length,
    layoutShiftScore: Number(shifts.reduce((sum, event) => sum + (event.args?.data?.weighted_score_delta || 0), 0).toFixed(4))
  };
}

async function recordPhase(page, client, name, action) {
  const events = [];
  const collect = ({ value }) => events.push(...value);
  client.on("Tracing.dataCollected", collect);
  await client.send("Tracing.start", {
    categories: "devtools.timeline,blink.user_timing,loading,disabled-by-default-devtools.timeline",
    transferMode: "ReportEvents"
  });
  await action();
  const done = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
  await client.send("Tracing.end");
  await done;
  client.off("Tracing.dataCollected", collect);
  const trace = { traceEvents: events };
  fs.writeFileSync(path.join(outputDir, `${label}-${name}.json`), JSON.stringify(trace));
  return summarizeTrace(trace);
}

(async () => {
  let auth;
  let web;
  let browser;
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    auth = await createIsolatedAuth();
    const webPort = await getFreePort();
    web = await startWebServer(webPort, auth.baseUrl);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const client = await page.context().newCDPSession(page);
    await page.goto(`http://127.0.0.1:${webPort}`, { waitUntil: "networkidle" });
    const username = `perf_${auth.runId}`;
    const password = "performance-password-123";
    await page.locator('[data-auth-mode="register"]').click();
    await page.locator("#register-form [name=username]").fill(username);
    await page.locator("#register-form [name=email]").fill(`${username}@patap.test`);
    await page.locator("#register-form [name=password]").fill(password);
    await page.locator("#register-form [name=confirmPassword]").fill(password);
    await page.locator("#register-form button[type=submit]").click();
    await page.locator("#lab-screen").waitFor({ state: "visible" });
    await page.evaluate(() => {
      localStorage.setItem("patapLabProjects", JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
        id: index,
        value: `Performance item ${index}`
      }))));
    });
    await page.reload({ waitUntil: "networkidle" });

    const desktop = await recordPhase(page, client, "desktop-scroll", async () => {
      for (let index = 0; index < 12; index += 1) {
        await page.mouse.wheel(0, 650);
        await page.waitForTimeout(35);
      }
      for (let index = 0; index < 12; index += 1) {
        await page.mouse.wheel(0, -650);
        await page.waitForTimeout(35);
      }
      await page.mouse.wheel(0, 5000);
      await page.mouse.wheel(0, -5000);
      await page.waitForTimeout(250);
    });

    const resize = await recordPhase(page, client, "resize", async () => {
      for (const viewport of [
        { width: 1180, height: 760 }, { width: 900, height: 680 },
        { width: 1440, height: 900 }, { width: 760, height: 720 },
        { width: 1280, height: 800 }
      ]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(80);
      }
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await recordPhase(page, client, "mobile-scroll", async () => {
      for (let index = 0; index < 10; index += 1) {
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(40);
      }
      for (let index = 0; index < 10; index += 1) {
        await page.mouse.wheel(0, -500);
        await page.waitForTimeout(40);
      }
    });

    const overflow = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    }));
    const result = { label, desktop, resize, mobile, overflow };
    fs.writeFileSync(path.join(outputDir, `${label}-summary.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    await closeServer(web);
    if (auth) await auth.cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
