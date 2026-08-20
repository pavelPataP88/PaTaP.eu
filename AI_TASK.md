# AI_TASK — NAVIGATION_ENGINE_V1: Codex re-review after GPS test fix

Status: **READY_FOR_CODEX_REVIEW — NOT DEPLOYED**

Navigation source remains:
- `chatgpt/navigation-engine-v1 @ 8e0afa67483d6627f818ff0aadd02213c2a46139`

Apply this minimal test-only correction on top:
- branch: `chatgpt/navigation-engine-v1-gps-test-fix-01`
- fix commit: `eeae1a9c2520537087a70c41b788204ded146639`
- file: `tests/auth/navigation.test.js`

Exact correction:
- removed the redundant second `setLocation(primary, ...)` call from the route ownership/selection/refresh test;
- the fresh GPS location written by the first Navigation test is intentionally reused for refresh;
- production GPS rate limiting remains unchanged at one location write per 12 seconds;
- ownership, alternative selection, refresh, strict TRUCK vehicle snapshot, ADR/no-car-fallback and provider assertions remain intact.

Codex must recompose the Navigation candidate exactly as before with this one corrected test file, then:
1. run syntax checks;
2. run `npm ci`;
3. run `npm run test:auth` first — the previous 37/38 result must become full PASS without changing production rate limiting;
4. only after auth PASS, continue the complete Navigation suite, build, verify, browser checks and the gated real TRUCK provider smoke described in the Navigation handoff;
5. deploy only after full PASS and required backup/health checks;
6. sync only the actually tested/applied result into `codex/local-workspace-snapshot`;
7. do not begin Voice Assistant automatically.

Do not change `server/driver/routes.js`, GPS rate limits, truck safety, `main`, Caddy, runtime/private data, or unrelated product behavior.

ChatGPT does not claim PASS or deployment.