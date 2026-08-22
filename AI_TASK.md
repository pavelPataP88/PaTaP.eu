# AI_TASK — AUDIT_INTEGRATION_V1: fix repeatable SSE 502 in release E2E

Status: CHANGES_REQUIRED — PR #19 is not deployed.

Codex checked the replacement candidate `chatgpt/audit-integration-v1 @ 7552c7d624df1d45f99d141915cee3ba531073aa` in an isolated checkout.

Passed: Node 24, `npm ci` with 0 vulnerabilities, `runtime:check`, and complete `verify`: auth 47/47, radio 1/1, Driver 14 files / 74/74, client 2/2, config 30/30.

Blocking release failure is repeatable:

- `npm run verify:release` fails at its required `npm run test:driver-e2e` stage.
- The isolated local origin returns HTTP 502 to authenticated `/api/driver/events/stream` and `/api/driver/radio/events`; the first run also returned 502 for `/api/driver/nearby`.
- An independent second E2E run reproduces 502 for the two SSE endpoints on a different random localhost port.
- The prior duplicate “Слои” issue is gone; do not revisit it.

Diagnose and fix the actual proxy/backend lifecycle or request handling behind these 502 responses. Do not ignore HTTP 502, silence browser errors, weaken the strict zero-errors assertion, or accept a retry as a substitute for a fix. Keep genuine two-user SSE coverage.

Provide a new exact SHA from this candidate and record it in AI_HANDOFF.md. Codex will rerun the full protocol; production, main, Navigation, secrets and runtime data remain untouched.
