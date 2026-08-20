# NAVIGATION_ENGINE_V1 — CODEX HANDOFF

Date: 2026-08-20 Europe/Warsaw
Status: **LOCAL PRODUCT CANDIDATE READY — AWAITING COMMIT/PUSH; NOT DEPLOYED; FULL PASS NOT CLAIMED**

## Exact candidate

- Branch: `chatgpt/navigation-engine-v1`
- Base: `codex/local-workspace-snapshot @ e78ecbea105c1011a092d67f247b058f5fb2a692`
- Earlier code + tests commit: `8e0afa67483d6627f818ff0aadd02213c2a46139`
- Published branch head before final product completion: `fdcfcfd8eb0ab7e22a1442e3ee2a389cb293625b`
- Final product-completion commit: **PENDING explicit commit and push authorization**
- Research: `docs/NAVIGATION_V1_RESEARCH.md`
- Architecture: `docs/NAVIGATION_V1_ARCHITECTURE.md`
- Provider gate: `docs/NAVIGATION_V1_PROVIDER_DEPLOYMENT.md`

After publication, this branch will be the one self-contained candidate. Do not compose old Navigation branches or ask Codex to reconstruct the architecture.

## Final product-completion status

The local worktree contains all five minimal test corrections reported by Codex:

- no redundant second Driver GPS write in the Navigation refresh test;
- `DatabaseSync` route rows normalized to ordinary objects for deep equality;
- the contradictory broad fallback/car regex replaced by the precise `carFallbackForTruck:false` contract assertion;
- stale Parking and People module-registry cache-key expectations updated to the current registry version.

It also contains a product finalization pass performed by ChatGPT:

- active ETA is recalculated from the current time and remaining route;
- the selected route has a real completed-progress MapLibre source/layer;
- passed Road Reports and Parking stops disappear from active guidance;
- Parking distance/ETA ahead and Plan B are based on current route progress;
- cached, offline and degraded states are explicit, with no offline rerouting claim;
- automatic reroute requires fresh GPS, online state, sustained deviation and cooldown;
- refresh requires an explicit origin or server GPS no older than 60 seconds and never silently reuses the old route start;
- planner supports manual/map-selected origin and reset to GPS;
- TRUCK and VAN require complete physical dimensions and gross weight;
- Route Guard verifies exact provider costing/options and fails closed for unsupported configured hard constraints;
- provider costing is TRUCK=truck, TAXI=taxi and VAN/CAR/OTHER=auto;
- the profile editor exposes stored dimensions, axle/speed, ADR/hazmat, emission/CO2 and avoidance settings with validation;
- Valhalla status reports `mapMatching:false` because this adapter does not implement map matching.

Local Linux evidence after the product pass:

- Navigation focused unit/static subset 14/14;
- auth 40/40;
- radio-live 1/1;
- Driver modules 76/76;
- config 4/4;
- syntax, build, workspace verification and PlatformOS runtime checks completed;
- Playwright client/browser checks stop before application launch because Chromium is absent in this workspace.

The authoritative Codex rerun must still execute client, aggregate verify and browser on the working laptop. No complete-suite PASS, real-provider smoke, commit, push or deployment is claimed here.

## Product contract

Navigation remains inside the existing Map and does **not** add a seventh bottom-navigation view. The existing six visible Driver sections must remain exactly six.

Main capabilities in this candidate:
- TRUCK/VAN/CAR/TAXI/OTHER vehicle profile;
- strict TRUCK and VAN dimensions: height, width, length and gross weight; optional axle load/count, speed, trailer, hazmat, ADR tunnel code, refrigerated, emission/CO2 metadata;
- strategies: FASTEST_LEGAL, PRACTICAL_TRUCK, EASY_TRUCK, ECONOMY, PARKING_AWARE;
- real router adapter seam (Valhalla-compatible), no synthetic straight-line route;
- up to 3 normalized alternatives, geometry and maneuvers;
- Route Guard that verifies expected costing and exact sent constraints, then fails closed for configured hard restrictions the provider cannot enforce;
- **no automatic car fallback after a truck failure**;
- PaTaP Parking along-route enrichment, vehicle fit, live/predicted occupancy, recommended stop + Plan B;
- break planning clearly marked `ADVISORY_NOT_TACHOGRAPH`;
- PaTaP Road Reports projected into route corridor without exposing report author identity;
- map route draw/fit/clear, completed-route progress and map-point origin/destination picking;
- active guidance with next maneuver, remaining distance/time, dynamic ETA, passed-item filtering, off-route detection and bounded fresh-GPS/online automatic reroute;
- destination search combines PaTaP Parking with an optional server-side approved/self-hosted Nominatim-compatible geocoder;
- public `nominatim.openstreetmap.org` is rejected by configuration;
- active route cache is sanitized and **scoped per signed-in Driver**, with the old global cache removed;
- owner scope is preserved while an account is creating its Driver profile; logout/reset removes that owner's cache;
- a transient server failure may display only that same owner's sanitized cached route with an explicit cached/offline/degraded state, while 401/404 invalidates it;
- traffic delay and toll price remain unavailable/null until backed by a real reviewed source.

## Important safety correction made before handoff

Earlier candidate code used a made-up `hgv_no_access_penalty=43200` field as if it proved hard HGV access enforcement. That was removed. The final candidate does **not** send or test that field.

Route Guard now relies on:
- `costing=truck`;
- provider-declared truck/HGV capability;
- exact configured physical/axle/hazmat values actually sent;
- fail-closed behavior when ADR tunnel code, hazmat categories or emission-zone constraints are configured but unsupported.

Do not reintroduce a numeric penalty and call it a hard legal restriction.

## Tests added

Auth/integration:
- `tests/auth/navigation.test.js`
- `tests/auth/navigation-search.test.js`
- local `tests/helpers/fake-valhalla.js`

Driver/static/unit:
- `tests/driver/navigation.test.mjs`
- `tests/driver/navigation-search.test.mjs`

They cover, among other things:
- Parking -> Navigation profile seeding;
- incomplete TRUCK profile fails closed;
- incomplete VAN profile fails closed and complete VAN dimensions reach auto costing;
- TAXI uses taxi costing without truck-only options;
- exact truck constraints reach the router fixture;
- no car fallback;
- ADR unsupported -> 422 hard-constraint failure;
- provider no-route/malformed/timeout normalization;
- route ownership and refresh preserving the vehicle snapshot;
- stale server GPS blocks refresh before any provider call, while an explicit manual origin succeeds;
- Parking + Road enrichment;
- additive module-local schema and global auth migration remaining 12;
- global Map-owned navigation module and exactly six bottom views;
- no invented HGV penalty;
- Route Guard evidence checks;
- cache sanitization + cross-account isolation;
- server-side place search and rejection of public OSM Nominatim endpoint;
- route corridor projection and off-route projection;
- dynamic ETA, fresh-location and ahead/behind route-item projection;
- sustained/cooldown/fresh-GPS/online automatic reroute rules.

## Mandatory Codex sequence

### A. Candidate integrity
1. Fetch the exact final SHA recorded after owner-authorized publication; do not review only the earlier `8e0afa67483d6627f818ff0aadd02213c2a46139` commit because the final product pass is still uncommitted at the time of this handoff.
2. Confirm no `main` changes and no runtime/private data in the candidate.
3. Run `node --check` over **every changed JS/MJS file** before starting a test server.
4. Confirm `driver/module-registry.json` still has exactly six enabled entries with a `view`; `navigation` must have no `view` and depend on `map`.
5. Confirm there is no hard-coded public routing backend and `nominatim.openstreetmap.org` remains rejected.
6. Confirm neither code nor tests rely on `hgv_no_access_penalty` as a routing/legal guarantee.

### B. Automated tests on isolated workspace
1. `npm ci`
2. `npm run test:auth`
3. `npm run test:radio-live`
4. `npm run test:driver-modules`
5. `npm run test:client`
6. `npm run test:config`
7. `npm run build`
8. `npm run verify`
9. `npm run test:browser`

Do not weaken old Map/Parking/Road/Event/Chat/Radio/People assertions to obtain PASS.

The auth runner starts the local fake router/geocoder only for tests. It must never be copied/configured as production navigation.

### C. Regression checks that matter specifically for Navigation
- `POST /api/driver/navigation/routes` with a complete TIR profile returns a real normalized fixture route during isolated tests;
- actual fixture request uses `costing=truck`, height/width/length/weight and configured axle/hazmat values;
- complete VAN uses `costing=auto` with exact physical dimensions; incomplete VAN fails before provider call;
- TAXI uses `costing=taxi` without truck-only axle/hazmat options;
- failed truck request makes exactly one truck request and never retries as auto/car;
- ADR tunnel code unsupported by current adapter returns `navigation_hard_constraints_unenforced`;
- route owned by account A is 404 to account B;
- cached route for account A cannot load under account B;
- public Road event in enrichment contains no author/user identity;
- Parking advisor returns only actual database places; empty DB remains empty;
- stale GPS blocks refresh, explicit origin succeeds, and automatic reroute is disabled offline;
- active ETA advances from the current time, route progress is visible and passed Parking/Road items are removed;
- traffic/toll UI does not fabricate values;
- bottom navigation remains one row at 390px and <=56px under the existing client/browser regression.

## Real-provider production gate

**Automated PASS with the fake test provider is not enough to call Navigation live.**

Before production enablement, inspect the real machine/environment for a reviewed `NAV_ROUTER_URL` outside GitHub.

Preferred production path:
- PaTaP-controlled/self-hosted Valhalla on appropriate server infrastructure; or
- a separately reviewed managed commercial provider through a dedicated adapter.

Do not use a public demo Valhalla endpoint as normal production backend.

If a reviewed real router is available:
1. create a real SQLite backup before first candidate backend start/apply;
2. verify graph coverage for the selected smoke corridor;
3. use temporary TIR, VAN and TAXI Driver accounts with explicit required dimensions;
4. calculate real TRUCK, VAN and TAXI routes and inspect request/result costing and options;
5. verify an impossible/unsupported hard restriction fails closed;
6. verify alternatives, map line/progress, dynamic ETA, start guidance, stale-GPS behavior, offline state, off-route/reroute and finish;
7. verify Parking/Road enrichment with only actual current data;
8. if geocoder configured, verify attribution/privacy and confirm it is not public `nominatim.openstreetmap.org`;
9. then restart/apply production and run local/public health checks.

If **no reviewed real router is available**, do not fake success. Record automated candidate as accepted if all suites pass, but mark production Navigation `BLOCKED_PROVIDER` / not enabled and leave current verified production unchanged (or keep the navigation module disabled until provider setup is separately approved).

## Truth statement

ChatGPT completed the final research, architecture, product code, tests and documentation in the local branch worktree. The focused Navigation subset passed 14/14, Driver modules 76/76, auth 40/40, radio-live 1/1, config 4/4, build, workspace verification and PlatformOS runtime. Playwright client/browser could not launch because this workspace has no Chromium, so aggregate PASS is not claimed. No real router smoke, commit, push, production deployment or production routing coverage is claimed. After owner-authorized publication, Codex owns the independent laptop/browser/real-provider verification on `D:\WWW.PATAP.EU`; it does not own Navigation redesign.

After final PASS/deployment decision, update `AI_HANDOFF.md` and synchronize only the actually tested/applied source into `codex/local-workspace-snapshot`. Do not start Voice Assistant automatically.
