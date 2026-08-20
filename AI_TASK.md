# AI_TASK — NAVIGATION_ENGINE_V1: provider gate

Status: BLOCKED_PROVIDER — automated code verification passed, but Navigation is NOT deployed.

Codex independently verified exact candidate `chatgpt/navigation-engine-v1 @ e7391a2fa9f7aafa98be69e8ae9d065bf70298b5` in an isolated copy. Syntax, npm ci, auth 40/40, radio-live 1/1, driver modules 76/76, client 2/2, config 4/4, build, verify and browser all passed.

Blocking factual condition:
- `NAV_ROUTER_URL` is not configured in Process, User or Machine environment scopes.
- No local non-secret configuration file contains it.
- Therefore there is no reviewed real routing provider to test. Fake Valhalla is test-only and cannot be used for deployment approval.

No ChatGPT code task now. Do not alter Navigation, start Voice Assistant, or begin a new block.

Required before the next Codex navigation check:
1. Owner configures a reviewed real routing provider through `NAV_ROUTER_URL` and documents supported TRUCK/VAN/TAXI constraints.
2. Codex performs real-provider smoke tests.
3. Owner gives a separate explicit approval before any SQLite backup, local application, backend restart or live-site change.

Read the latest CODEX entry in AI_HANDOFF.md for the complete evidence.
