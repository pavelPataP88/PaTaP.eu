# AI_TASK — NAVIGATION_ENGINE_V1: Codex review

Status: **READY_FOR_CODEX_REVIEW — NOT DEPLOYED**

Use one self-contained candidate:
- branch: `chatgpt/navigation-engine-v1`
- base: `codex/local-workspace-snapshot @ e78ecbea105c1011a092d67f247b058f5fb2a692`
- code + tests commit: `d46715fa24377d5edb647b4787f4d8e9b4a00a2a`
- full handoff: `docs/NAVIGATION_V1_HANDOFF.md`
- provider/deployment gate: `docs/NAVIGATION_V1_PROVIDER_DEPLOYMENT.md`
- architecture: `docs/NAVIGATION_V1_ARCHITECTURE.md`
- research: `docs/NAVIGATION_V1_RESEARCH.md`

Mandatory order:
1. Diff exact base -> candidate and run `node --check` over every changed JS/MJS file.
2. `npm ci`.
3. Run `npm run test:auth` first, then radio-live, driver-modules, client, config, build, verify and browser exactly as specified in the handoff.
4. Do not weaken existing tests. Bottom Driver nav must remain exactly six visible views.
5. Confirm TRUCK routes never silently fall back to car/auto and configured hard restrictions fail closed when unsupported.
6. Confirm cached active route is isolated per signed-in Driver and the old global navigation cache is removed.
7. Confirm code/tests do not rely on invented `hgv_no_access_penalty` as a legal guarantee.
8. Fake Valhalla/geocoder are test fixtures only.
9. Production Navigation may be enabled only after a reviewed real `NAV_ROUTER_URL` is configured outside GitHub and a real TRUCK route smoke passes. Public demo routing is not a production backend; public `nominatim.openstreetmap.org` remains rejected.
10. Back up real SQLite before first real candidate backend start/apply.
11. If no reviewed real router is available, record `BLOCKED_PROVIDER` and do not pretend Navigation is live.
12. After actual verification/deployment decision, update `AI_HANDOFF.md` and synchronize only the tested/applied code into `codex/local-workspace-snapshot`.
13. Do not start Voice Assistant automatically.

ChatGPT could not run the authoritative suite: its container cannot resolve `github.com`. No PASS or deployment is claimed.