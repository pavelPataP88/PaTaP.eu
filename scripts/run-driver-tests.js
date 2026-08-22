const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_TEST_DIR = path.join(ROOT, "tests", "driver");

function discoverDriverTests(testDir = DEFAULT_TEST_DIR) {
  const root = path.resolve(testDir);
  const files = [];

  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(absolute);
    }
  }

  visit(root);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function runDriverTests({ testDir = process.env.PATAP_DRIVER_TEST_DIR || DEFAULT_TEST_DIR } = {}) {
  const files = discoverDriverTests(testDir);
  if (files.length === 0) {
    console.error(`No Driver test files found under ${path.resolve(testDir)}`);
    return 1;
  }

  console.log(`Discovered ${files.length} Driver test files.`);
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    windowsHide: true
  });

  if (result.error) {
    console.error(result.error);
    return 1;
  }
  if (result.signal) {
    console.error(`Driver tests terminated by ${result.signal}.`);
    return 1;
  }
  return result.status ?? 1;
}

if (require.main === module) {
  process.exitCode = runDriverTests();
}

module.exports = { DEFAULT_TEST_DIR, discoverDriverTests, runDriverTests };
