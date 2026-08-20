# NAVIGATION_ENGINE_V1 — GPS TEST FIX HANDOFF

Date: 2026-08-20 Europe/Warsaw
Task: `NAVIGATION-20260820-001`
Status: **READY_FOR_CODEX_REVIEW — NOT DEPLOYED BY CHATGPT**

## Sources

- Navigation candidate reviewed by Codex: `chatgpt/navigation-engine-v1 @ 8e0afa67483d6627f818ff0aadd02213c2a46139`
- Authoritative production snapshot used for this small fix branch: `codex/local-workspace-snapshot`
- Fix branch: `chatgpt/navigation-engine-v1-gps-test-fix-01`
- Exact test fix commit: `eeae1a9c2520537087a70c41b788204ded146639`

## Codex failure being corrected

`npm run test:auth` reached 38 tests: 37 PASS, 1 FAIL.

The failing Navigation test performed a second `PUT /api/driver/location` for the same Driver only seconds after the first Navigation test had already stored a fresh location. Existing production protection correctly returned `429 location_rate_limited`; the application permits one Driver location update per 12 seconds.

## Exact correction

Only `tests/auth/navigation.test.js` changed.

Removed from the second Navigation test:

```js
await setLocation(primary, ORIGIN.latitude + 0.01, ORIGIN.longitude + 0.01);
```

The test now reuses the already stored fresh GPS location and calls route refresh directly.

## Assertions deliberately preserved

The correction does **not** weaken or remove checks for:

- another Driver cannot read the route (`404` ownership boundary);
- selecting an alternative succeeds;
- route refresh succeeds;
- refresh keeps the original strict TRUCK vehicle snapshot;
- width, height, gross weight and axle count remain exact;
- Route Guard remains strict;
- provider receives `costing: truck`;
- provider receives the same truck dimensions/weight/axle count;
- ADR tunnel constraints that cannot be enforced stay blocked;
- failed truck routing makes no automatic car fallback.

## Production intentionally unchanged

Do **not** change:

- `server/driver/routes.js` location rate limit;
- the 12-second GPS protection;
- Map/GPS/Road safety behavior;
- Navigation truck/no-car-fallback policy;
- Caddy, main, auth migration or runtime/private data.

## Required Codex sequence

1. Recompose the same Navigation candidate `8e0afa67483d6627f818ff0aadd02213c2a46139` with `tests/auth/navigation.test.js` from fix commit `eeae1a9c2520537087a70c41b788204ded146639`.
2. Confirm production source is otherwise identical to the candidate already reviewed.
3. Run syntax checks over the changed Navigation JS/MJS files.
4. Run `npm ci`.
5. Run `npm run test:auth` first. The previous 37/38 must become full PASS without modifying rate limiting.
6. Only after auth PASS, continue the full mandatory Navigation regression suite, build, verify and browser checks.
7. Only after the automated gate passes, configure/use the reviewed real routing provider and run the required real TRUCK smoke. Never silently fall back to car routing.
8. Before applying candidate backend/schema to the real workspace, make the required SQLite backup.
9. Deploy only after full PASS and verify local/public health.
10. Sync the actually tested/applied code into `codex/local-workspace-snapshot` and record exact results.
11. Do not start Voice Assistant automatically.

## Truth statement

ChatGPT changed only the new Navigation test sequencing in GitHub. ChatGPT has not run the authoritative Windows suite, has not modified `D:\WWW.PATAP.EU`, has not changed production GPS protection, and does not claim Navigation PASS or deployment.