# AI_TASK — NAVIGATION_ENGINE_V1: publish the completed product candidate

Status: **PUBLISHED PRODUCT CANDIDATE — READY FOR CODEX LAPTOP VERIFICATION; NOT DEPLOYED; FULL PASS NOT CLAIMED**

## Candidate lineage

- working branch: chatgpt/navigation-engine-v1
- original base: codex/local-workspace-snapshot @ e78ecbea105c1011a092d67f247b058f5fb2a692
- earlier reviewed Navigation code/tests: 8e0afa67483d6627f818ff0aadd02213c2a46139
- published branch head before finalization: fdcfcfd8eb0ab7e22a1442e3ee2a389cb293625b
- final product-completion commit: fbcf3ea67ddb67ddb530dd4b130cf4fddbeb1b7a

This worktree is no longer a test-only correction. It contains the five accepted test fixes plus the final Navigation product completion described below.

## Product completion now present locally

1. Active ETA is recalculated from the current time and remaining route instead of staying frozen at the original route ETA.
2. Map route progress is real: the completed part of the selected geometry is rendered through a separate progress source/layer.
3. Road Reports and Parking cards already behind the Driver are removed during guidance; remaining distance and ETA are recalculated from current route progress.
4. Plan B selects an actual compatible parking candidate still ahead, not a stop already passed.
5. Cached, offline and degraded states are explicit. Offline mode continues only on the sanitized saved active route and never promises new routing or fresh enrichment.
6. Automatic reroute requires a moving off-route Driver, sustained deviation, cooldown, network availability and a fresh client GPS point.
7. Server refresh never silently reuses the old route start. It requires an explicit valid origin or a fresh server GPS point (maximum age 60 seconds).
8. Planner supports an explicit manual start point, map-point start selection and reset to fresh GPS.
9. TRUCK and VAN both require height, width, length and gross weight. Route Guard verifies the exact dimensions actually sent to the provider.
10. TAXI uses Valhalla taxi costing. VAN/CAR/OTHER use auto costing; TRUCK uses truck costing. Truck-only axle/hazmat options are never borrowed by TAXI.
11. Unsupported configured ADR, hazmat-category, emission or non-truck hazardous-goods constraints fail closed instead of being hidden.
12. Valhalla capability metadata now truthfully reports map matching as unavailable because this adapter does not implement a map-matching endpoint.
13. The vehicle-profile dialog exposes all stored vehicle and avoidance fields with validated numeric ranges.

## Invariants that remain mandatory

- Navigation stays inside Map; Driver bottom navigation remains exactly six visible views.
- A failed TRUCK request makes one truck request and never retries as car/auto.
- No synthetic route, fake traffic delay, fake toll price or public Nominatim production fallback.
- Production GPS write rate remains one accepted location update per 12 seconds.
- Route cache remains sanitized, bounded and scoped to the signed-in Driver.
- Road Report enrichment exposes no author/user identity.
- No real provider, production database, main branch, runtime/private data or live site was changed.

## Checks actually run in this Linux workspace

- npm ci with a writable temporary cache — completed earlier for this worktree.
- node --check for all changed JS/MJS files — passed.
- Navigation unit/static subset — 14/14.
- complete Driver modules — 76/76; latest post-audit rerun exited 0.
- auth/integration — 40/40.
- radio-live — 1/1.
- config — 4/4.
- build — passed.
- workspace verify — passed.
- PlatformOS runtime — passed.
- client storage test — **BLOCKED BEFORE PRODUCT ASSERTIONS**: Playwright Chromium executable is absent.
- browser smoke — **BLOCKED BEFORE APPLICATION LAUNCH** for the same missing Chromium executable.
- aggregate npm run verify — **NOT CLAIMED PASS**, because its client component cannot launch here.
- real NAV_ROUTER_URL smoke — **NOT RUN**; no reviewed real endpoint is configured in this workspace.

## Required next action

1. Codex fetches the exact transfer SHA supplied by ChatGPT from chatgpt/navigation-engine-v1 and confirms it contains product commit fbcf3ea67ddb67ddb530dd4b130cf4fddbeb1b7a.
2. Codex does not redesign or rewrite Navigation. It runs syntax, auth, radio-live, Driver modules, client, config, build, aggregate verify and browser tests in an isolated laptop checkout.
3. If the complete automated sequence passes, Codex checks a reviewed real NAV_ROUTER_URL and runs real TRUCK, VAN and TAXI smoke flows. If no reviewed router exists, record BLOCKED_PROVIDER and leave the live site unchanged.
4. Before starting/applying a candidate backend against real data, create a SQLite backup.
5. Do not deploy, restart production, change main or start Voice Assistant without the owner's explicit instruction.
