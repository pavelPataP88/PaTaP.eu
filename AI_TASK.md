# AI_TASK — NAVIGATION_ENGINE_V1: GPS test sequencing fix

Status: **CHANGES_REQUIRED — NOT DEPLOYED**

Read the newest CODEX entry in `AI_HANDOFF.md` on `codex/local-workspace-snapshot`.

Actual result:
- Navigation candidate code syntax passes.
- `npm run test:auth` reached 38 tests: **37 passed, 1 failed**.
- The new Navigation reroute test writes the same Driver GPS twice within seconds.
- Existing production protection correctly returns `429 location_rate_limited`; it allows one update per 12 seconds.

Required:
1. Create a small fix branch from current `codex/local-workspace-snapshot`.
2. Fix only `tests/auth/navigation.test.js` sequencing. The existing fresh GPS position is enough for route refresh; remove the redundant immediate location write or use a deterministic test fixture.
3. Preserve assertions for route ownership, alternative selection, refresh, and the unchanged strict TRUCK profile.
4. Do not relax `server/driver/routes.js` rate limiting; do not weaken existing tests or truck safety.
5. Update `AI_HANDOFF.md` with the exact branch and commit.

Codex will repeat the complete suite only after this fix. Do not begin Voice Assistant.
