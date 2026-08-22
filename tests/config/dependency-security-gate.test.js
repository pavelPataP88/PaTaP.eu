const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "verify.yml"), "utf8");

test("release verification has an explicit high-severity dependency audit gate", () => {
  assert.equal(pkg.scripts["security:audit"], "npm audit --audit-level=high");
  assert.match(pkg.scripts["verify:release"], /npm run security:audit/);
  assert.ok(
    pkg.scripts["verify:release"].indexOf("npm run security:audit") < pkg.scripts["verify:release"].indexOf("npm run verify"),
    "dependency audit must run before the rest of the release verification"
  );
});

test("CI release gate executes the same audited release contract", () => {
  assert.match(workflow, /name:\s*release-gate/);
  assert.match(workflow, /run:\s*npm run verify:release/);
  assert.doesNotMatch(pkg.scripts["security:audit"], /--audit-level=(?:critical|none)/i);
});
