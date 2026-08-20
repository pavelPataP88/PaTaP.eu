# AI_TASK — NAVIGATION_ENGINE_V1: four test-only corrections

Status: CHANGES_REQUIRED — NOT DEPLOYED

Read newest CODEX record in AI_HANDOFF.md on codex/local-workspace-snapshot.

Actual results:
- syntax, npm ci, auth 38/38, radio 1/1, client 2/2, config 4/4 and build PASS;
- driver modules FAIL: 72/76; no production change.

Required small branch from current snapshot:
1. tests/driver/navigation-search.test.mjs — convert DatabaseSync rows to ordinary plain id/status objects before deep equality; preserve one-active-route/history retention assertion.
2. tests/driver/navigation.test.mjs — replace only the contradictory broad fallback/car text regex. It must allow the required Russian sentence that explicitly says a passenger-car route is not substituted; retain structural no-car-fallback checks.
3. tests/driver/parking-network.test.mjs — update only stale module-registry cache version expectation to 20260820-navigation-v1.
4. tests/driver/people-console.test.mjs — update only the same stale cache version expectation.

Do not change GPS rate limiting, Navigation production code, truck/ADR constraints, Caddy, main, runtime data or existing product behavior.

After this test-only correction Codex will rerun complete automated checks. Do not begin Voice Assistant.
