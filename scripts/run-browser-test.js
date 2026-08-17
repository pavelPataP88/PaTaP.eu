const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("node:assert/strict");
const { createIsolatedAuth, getFreePort } = require("../tests/helpers/isolated-auth");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
};

function startWebServer(root, port, authBaseUrl) {
  const dist = path.join(root, "var", "build", "dist");
  const auth = new URL(authBaseUrl);
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      const proxy = http.request({
        hostname: auth.hostname, port: auth.port, path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: auth.host,
          origin: "http://127.0.0.1:8090"
        }
      }, (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
      });
      proxy.on("error", (error) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      });
      req.pipe(proxy);
      return;
    }
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = path.resolve(dist, relative);
    if (!file.startsWith(`${dist}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

let auth;
let web;
let browser;
let cleaning = false;

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  if (browser) await browser.close();
  await closeServer(web);
  if (auth) await auth.cleanup();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => cleanup().finally(() => process.exit(128)));
}

const timeout = setTimeout(() => {
  console.error("Browser test run exceeded 180 seconds.");
  cleanup().finally(() => process.exit(1));
}, 180000);

async function fillLogin(page, identifier, password) {
  await page.locator("#login-form [name=identifier]").fill(identifier);
  await page.locator("#login-form [name=password]").fill(password);
  await page.locator("#login-form button[type=submit]").click();
}

(async () => {
  try {
    const { chromium } = require("playwright");
    auth = await createIsolatedAuth();
    Object.assign(process.env, auth.env);
    const { openDb, hashPassword, hashToken, randomToken, nowIso, addMinutes } = require("../server/auth/db");
    const ownerName = `owner_${auth.runId}`;
    const ownerEmail = `${ownerName}@patap.test`;
    const ownerPassword = "owner-password-123";
    let db = openDb();
    const now = nowIso();
    db.prepare(`
      INSERT INTO users(username, email, password_hash, role, created_at, updated_at)
      VALUES(?, ?, ?, 'Owner', ?, ?)
    `).run(ownerName, ownerEmail, hashPassword(ownerPassword), now, now);
    db.close();

    const webPort = await getFreePort();
    web = await startWebServer(auth.root, webPort, auth.baseUrl);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const javascriptErrors = [];
    const serverErrors = [];
    const isExpectedCloudflareCspBlock = (text) => (
      text.includes("static.cloudflareinsights.com/beacon.min.js")
      && text.includes("violates the following Content Security Policy directive")
    );
    page.on("pageerror", (error) => javascriptErrors.push(error.message));
    page.on("console", (message) => {
      const text = message.text();
      if (message.type() === "error" && !text.startsWith("Failed to load resource:") && !isExpectedCloudflareCspBlock(text)) {
        javascriptErrors.push(text);
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    });

    const publicResponse = await page.goto("https://patap.eu", { waitUntil: "domcontentloaded", timeout: 30000 });
    assert.ok(publicResponse && publicResponse.ok(), "Public page did not open successfully");

    const localUrl = `http://127.0.0.1:${webPort}`;
    await page.goto(localUrl, { waitUntil: "networkidle" });
    await page.locator("#guest-screen").waitFor({ state: "visible" });
    assert.equal(await page.locator("#admin-nav-button").isVisible(), false, "Admin navigation is visible to a guest");
    await page.locator("#guest-open-login").click();
    await page.locator("#auth-screen").waitFor({ state: "visible" });
    const username = `user_${auth.runId}`;
    const email = `${username}@patap.test`;
    const password = "browser-password-123";
    const newPassword = "browser-new-password-123";

    await context.addCookies([{ name: "patap_csrf", value: "stale-cookie-probe", url: localUrl }]);
    await page.locator('[data-auth-mode="register"]').click();
    await page.locator("#register-form [name=username]").fill(username);
    await page.locator("#register-form [name=email]").fill(email);
    await page.locator("#register-form [name=password]").fill(password);
    await page.locator("#register-form [name=confirmPassword]").fill(password);
    await page.locator("#register-form button[type=submit]").click();
    await page.locator("#lab-screen").waitFor({ state: "visible" });
    assert.equal(await page.locator("#admin-nav-button").isVisible(), false, "Admin tab is visible to a regular user");

    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#lab-screen").waitFor({ state: "visible" });
    await page.locator("#logout-button").click();
    await fillLogin(page, username, password);
    await page.locator("#lab-screen").waitFor({ state: "visible" });
    await page.locator("#logout-button").click();
    await fillLogin(page, email, password);
    await page.locator("#lab-screen").waitFor({ state: "visible" });
    await page.locator("#logout-button").click();

    await fillLogin(page, username, "definitely-wrong-password");
    await page.locator("#auth-message:not(.hidden)").waitFor();
    assert.equal(await page.locator("#lab-screen").isVisible(), false, "Invalid password unexpectedly logged in");

    const resetToken = randomToken(32);
    db = openDb();
    const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    db.prepare("INSERT INTO password_reset_tokens(user_id, token_hash, created_at, expires_at) VALUES(?, ?, ?, ?)")
      .run(user.id, hashToken(resetToken), nowIso(), addMinutes(30));
    db.close();

    await page.locator('[data-auth-mode="recover"]').click();
    await page.locator("#recover-form [name=token]").fill(resetToken);
    await page.locator("#recover-form [name=password]").fill(newPassword);
    await page.locator("#recover-form [name=confirmPassword]").fill(newPassword);
    await page.locator("#recover-form button[type=submit]").click();
    await page.locator('[data-auth-mode="login"].active').waitFor();
    await fillLogin(page, username, newPassword);
    await page.locator("#lab-screen").waitFor({ state: "visible" });
    await page.locator("#logout-button").click();

    await fillLogin(page, ownerEmail, ownerPassword);
    await page.locator("#lab-screen").waitFor({ state: "visible" });
    assert.equal(await page.locator("#admin-nav-button").isVisible(), true, "Admin tab is hidden from Owner");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      labVisible: !document.querySelector("#lab-screen").classList.contains("hidden")
    }));
    assert.equal(viewport.width, 390);
    assert.equal(viewport.labVisible, true);
    assert.ok(viewport.scrollWidth <= 391, `Mobile layout overflows: ${viewport.scrollWidth}px`);

    await page.evaluate(() => {
      localStorage.setItem("patapLabProjects", JSON.stringify(Array.from({ length: 50 }, (_, index) => ({
        id: `scroll-${index}`,
        value: `Scroll test item ${index}`
      }))));
    });
    await page.reload({ waitUntil: "networkidle" });
    for (const target of [600, 1400, 2400, 900, 0]) {
      const actual = await page.evaluate(async (scrollTarget) => {
        window.scrollTo(0, scrollTarget);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return window.scrollY;
      }, target);
      const maximum = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
      assert.ok(Math.abs(actual - Math.min(target, maximum)) <= 2, `Scroll position jumped: requested ${target}, got ${actual}`);
    }

    await page.evaluate(() => window.scrollTo(0, 700));
    for (const size of [
      { width: 430, height: 780 },
      { width: 390, height: 844 },
      { width: 520, height: 760 }
    ]) {
      const beforeResize = await page.evaluate(() => window.scrollY);
      await page.setViewportSize(size);
      const afterResize = await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return window.scrollY;
      });
      assert.ok(Math.abs(afterResize - beforeResize) <= 2, `Resize changed scroll position from ${beforeResize} to ${afterResize}`);
      const widthState = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth
      }));
      assert.ok(widthState.document <= widthState.viewport + 1, `Horizontal overflow: ${widthState.document}px at ${widthState.viewport}px`);
    }

    assert.deepEqual(serverErrors, [], `HTTP 500 responses: ${serverErrors.join(", ")}`);
    assert.deepEqual(javascriptErrors, [], `JavaScript errors: ${javascriptErrors.join(", ")}`);
    console.log("Browser scenarios passed with isolated database and test servers.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await cleanup();
  }
})();
