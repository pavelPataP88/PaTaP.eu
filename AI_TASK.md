# AI_TASK — AUDIT_INTEGRATION_V1: fix the release E2E gate

Status: CHANGES_REQUIRED — PR #19 is not deployed.

Codex checked exactly `chatgpt/audit-integration-v1 @ fd11a193a18d6485a4ade2ab2cb93a083b646041` in an isolated checkout.

Passed: Node 24, `npm ci` with 0 vulnerabilities, `runtime:check`, and the complete `verify` suite: auth 47/47, radio 1/1, Driver 14 files / 74/74, client 2/2, config 30/30.

Blocking release failure:

- `npm run verify:release` fails in its required `npm run test:driver-e2e` stage.
- `scripts/run-driver-e2e.js:216-220`, `enableGps()` uses `locator('[data-map-experience="layers"]')`.
- Playwright finds two elements and strict mode refuses to select one at line 219.

Prepare one minimal follow-up candidate from PR #19 that fixes the actual duplicate control or identifies the unique intended visible control while retaining strict E2E coverage. Do not use `.first()` or weaken the test merely to hide a real duplicate UI problem. Do not change production, `main`, Navigation, secrets, runtime data or unrelated functionality.

Record the exact new SHA in AI_HANDOFF.md. Codex will then rerun the full release protocol.
