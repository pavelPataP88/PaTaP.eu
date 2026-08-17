const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..", "..");
const caddy = fs.readFileSync(path.join(root, "Caddyfile.tunnel"), "utf8");

test("forwarded HTTP keeps the Driver hostname", () => {
  assert.match(caddy, /@driverHttpForwarded[\s\S]*host driver\.patap\.eu[\s\S]*header X-Forwarded-Proto http/);
  assert.ok(caddy.includes("redir @driverHttpForwarded https://driver.patap.eu{uri} 308"));
});

test("forwarded HTTP for the main site redirects to patap.eu", () => {
  assert.match(caddy, /@httpForwarded[\s\S]*not host driver\.patap\.eu[\s\S]*header X-Forwarded-Proto http/);
  assert.ok(caddy.includes("redir @httpForwarded https://patap.eu{uri} 308"));
});

test("large immutable assets use a long browser cache", () => {
  assert.match(caddy, /@immutableAssets[\s\S]*path \/assets\/\* \/vendor\/\*/);
  assert.ok(caddy.includes('Cache-Control "public, max-age=31536000, immutable"'));
});

test("dynamic pages are explicitly not stored", () => {
  assert.ok(caddy.includes('Cache-Control "no-cache, no-store, must-revalidate"'));
});
