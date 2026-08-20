# AI_TASK — EVENT_CENTER_V1: Road Report regression fix

Status: **CHANGES_REQUIRED — NOT DEPLOYED**

Read first:
1. newest CODEX record in `AI_HANDOFF.md` on `codex/local-workspace-snapshot`;
2. `server/events/service.js` from `chatgpt/event-center-v1`;
3. `server/road-reports/repository.js` and its exports.

Actual verified result:
- The syntax correction passes `node --check`.
- The full Event Center composition reaches `npm run test:auth`: **29 passed, 2 failed**.
- Creating a Road Report returns **HTTP 500**, breaking the new Event Center Road test and existing Road Report regression.
- Exact error: `TypeError: haversineKm is not a function` at `server/events/service.js:75`.
- `server/events/service.js` imports `haversineKm` from `../driver/location`, which does not export it.

Required:
1. Create one self-contained candidate branch from current `codex/local-workspace-snapshot`.
2. Include the full EVENT_CENTER_V1 block plus the prior syntax fix and this correct distance-helper fix.
3. Use the compatible existing Road Report distance helper (or a small shared helper with identical tested behavior); do not weaken Road or Event tests.
4. Update `AI_HANDOFF.md` with exact branch and code commit.

Do not change `main`, Caddy, global auth migration, six-character password rule, runtime data, or unrelated product behavior.
Production remains unchanged until the full required suite passes.
