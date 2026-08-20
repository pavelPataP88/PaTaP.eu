# NAVIGATION_ENGINE_V1 — CODEX HANDOFF

Date: 2026-08-20 Europe/Warsaw
Status: **READY_FOR_CODEX_REVIEW — NOT DEPLOYED BY CHATGPT**

## Exact candidate

- Branch: `chatgpt/navigation-engine-v1`
- Base: `codex/local-workspace-snapshot @ e78ecbea105c1011a092d67f247b058f5fb2a692`
- **Code + tests commit: `8e0afa67483d6627f818ff0aadd02213c2a46139`**
- Research: `docs/NAVIGATION_V1_RESEARCH.md`
- Architecture: `docs/NAVIGATION_V1_ARCHITECTURE.md`
- Provider gate: `docs/NAVIGATION_V1_PROVIDER_DEPLOYMENT.md`

This is one self-contained candidate. Do not compose old Navigation branches.

## Product contract

Navigation remains inside the existing Map and does **not** add a seventh bottom-navigation view. The existing six visible Driver sections must remain exactly six.

Main capabilities in this candidate:
- TRUCK/VAN/CAR/TAXI/OTHER vehicle profile;
- strict truck dimensions: height, width, length, gross weight; optional axle load/count, speed, trailer, hazmat, ADR tunnel code, refrigerated, emission/CO2 metadata;
- strategies: FASTEST_LEGAL, PRACTICAL_TRUCK, EASY_TRUCK, ECONOMY, PARKING_AWARE;
- real router adapter seam (Valhalla-compatible), no synthetic straight-line route;
- up to 3 normalized alternatives, geometry and maneuvers;
- Route Guard that fails closed for configured hard truck restrictions the provider cannot enforce;
- **no automatic car fallback after a truck failure**;
- PaTaP Parking along-route enrichment, vehicle fit, live/predicted occupancy, recommended stop + Plan B;
- break planning clearly marked `ADVISORY_NOT_TACHOGRAPH`;
- PaTaP Road Reports projected into route corridor without exposing report author identity;
- map route draw/fit/clear and map-point destination picking;
- active guidance with next maneuver, remaining distance/time, ETA UI, off-route detection and bounded automatic reroute;
- destination search combines PaTaP Parking with an optional server-side approved/self-hosted Nominatim-compatible geocoder;
- public `nominatim.openstreetmap.org` is rejected by configuration;
- active route cache is sanitized and **scoped per signed-in Driver**, with the old global cache removed;
- owner scope is preserved while an account is creating its Driver profile; logout/reset removes that owner's cache;
- a transient server failure may display only that same owner's sanitized cached route as stale, while 401/404 invalidates it;
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
- exact truck constraints reach the router fixture;
- no car fallback;
- ADR unsupported -> 422 hard-constraint failure;
- provider no-route/malformed/timeout normalization;
- route ownership and refresh preserving the vehicle snapshot;
- Parking + Road enrichment;
- additive module-local schema and global auth migration remaining 12;
- global Map-owned navigation module and exactly six bottom views;
- no invented HGV penalty;
- Route Guard evidence checks;
- cache sanitization + cross-account isolation;
- server-side place search and rejection of public OSM Nominatim endpoint;
- route corridor projection and off-route projection;
- sustained/cooldown automatic reroute rules.

## Mandatory Codex sequence

### A. Candidate integrity
1. Compare exact base `e78ecbea105c1011a092d67f247b058f5fb2a692` to `chatgpt/navigation-engine-v1 @ 8e0afa67483d6627f818ff0aadd02213c2a46139` for product code/tests; subsequent commits are handoff metadata only.
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
- failed truck request makes exactly one truck request and never retries as auto/car;
- ADR tunnel code unsupported by current adapter returns `navigation_hard_constraints_unenforced`;
- route owned by account A is 404 to account B;
- cached route for account A cannot load under account B;
- public Road event in enrichment contains no author/user identity;
- Parking advisor returns only actual database places; empty DB remains empty;
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
3. use temporary Driver test account with explicit truck dimensions;
4. calculate at least one real TRUCK route and inspect request/result;
5. verify an impossible/unsupported hard restriction fails closed;
6. verify alternatives, map line, start guidance, off-route/reroute, finish;
7. verify Parking/Road enrichment with only actual current data;
8. if geocoder configured, verify attribution/privacy and confirm it is not public `nominatim.openstreetmap.org`;
9. then restart/apply production and run local/public health checks.

If **no reviewed real router is available**, do not fake success. Record automated candidate as accepted if all suites pass, but mark production Navigation `BLOCKED_PROVIDER` / not enabled and leave current verified production unchanged (or keep the navigation module disabled until provider setup is separately approved).

## Truth statement

ChatGPT completed research, architecture, code and test coverage in GitHub. ChatGPT could not run the authoritative suite because its container cannot resolve `github.com`; `git clone` failed with `Could not resolve host: github.com`. Therefore ChatGPT does **not** claim test PASS, a real router smoke, production deployment, or production routing coverage. Codex owns those factual checks on `D:\WWW.PATAP.EU`.

After final PASS/deployment decision, update `AI_HANDOFF.md` and synchronize only the actually tested/applied source into `codex/local-workspace-snapshot`. Do not start Voice Assistant automatically.