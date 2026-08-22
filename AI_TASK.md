# AI_TASK — AUD-023 MAP_TILE_PROVIDER_V1

Status: `DEPLOYED` — installed and verified by Codex on 2026-08-22.

Production source before this block:
`codex/local-workspace-snapshot @ b8ec2d31d973e811271e0ca2ca3f1fea8d979284`.

Exact deployed source: `4c8a224ffd0b5f6e89896406c91b38026ba0e5b4`.
The next safe source-of-truth snapshot is recorded in `AI_HANDOFF.md` after this release.

Working branch:
`chatgpt/aud-023-map-tile-provider-v1`.

Use only the exact final PR head after GitHub Verify is green. Do not deploy an intermediate commit.

## Goal

Close `AUD-023`: remove Driver's operational hard dependency on a tile URL and CSP origin baked into product code/config while preserving the current working map until the owner separately chooses a replacement provider.

The current OSM Standard raster endpoint remains the default fallback in this block. No paid provider is selected and no offline/bulk tile download is added.

## Engineering contract

Implemented:

- `driver/map-provider.json` is the default provider document;
- Map module now loads through `driver/map/provider-bootstrap.mjs`;
- embedded legacy tile settings are removed before provider loading, so a missing/invalid provider fails closed instead of silently continuing on a baked-in URL;
- provider schema validates exact `{z}/{x}/{y}` templates, HTTPS or same-origin transport, tile size, zoom and mandatory attribution;
- external URL credentials, HTTP, protocol-relative URLs and incomplete templates are rejected;
- provider failure disables the Map dependency chain but does not take down independent Chat/Radio/People/Profile modules;
- build ships the default provider document;
- Caddy's Driver `connect-src` uses exact reviewed origins from `PATAP_MAP_CONNECT_SRC`, defaulting to the current OSM origin; broad `https:`/`*` is not introduced;
- exact `/map-provider.json` can optionally be served from an operator-managed directory via `PATAP_MAP_CONFIG_ROOT`, without exposing arbitrary `data/` paths;
- `npm run map:provider:check` validates the effective provider document and verifies every external tile origin is explicitly present in the CSP origin list;
- provider/CSP check is mandatory inside `npm run verify`;
- documentation: `docs/MAP_TILE_PROVIDER_V1.md`.

Official policy basis checked 2026-08-22: OSM's current Tile Usage Policy recommends not hard-coding its tile URL, provides no SLA, may block problematic/heavy use, and prohibits bulk/offline tile downloading. This block keeps interactive viewport-only use and adds no prefetch/offline feature.

## Default production behavior

With no new environment variables:

- `/map-provider.json` comes from the deployed Driver build;
- provider is `osm-standard-public-fallback`;
- tile origin remains `https://tile.openstreetmap.org`;
- current attribution remains `© OpenStreetMap contributors`;
- existing users should see no intended map-content change.

A future reviewed provider can be selected without changing Driver product code by supplying an operator `map-provider.json`, exact CSP origin(s), validating, and reloading Caddy.

## Intentionally unchanged

- MapLibre version/lazy loading;
- GPS and server-side privacy;
- nearby Drivers;
- Road Reports;
- Parking map bridge;
- Navigation / `NAV_ROUTER_URL`;
- no paid map service;
- no offline tile packs, prefetch or scraping;
- auth schema and password policy;
- `main`;
- SQLite, users, GPS, messages, media, tokens, secrets and runtime data.

## Mandatory Codex Windows gate

Before any production apply:

1. Review exact final PR SHA and diff; confirm base is `b8ec2d31d973e811271e0ca2ca3f1fea8d979284`.
2. Confirm no runtime/private data or provider secrets are in the diff.
3. Windows Node 24.x + `npm ci`.
4. Run `npm run map:provider:check`; default provider and exact OSM CSP origin must PASS.
5. Run `npm run verify:release`; require full PASS.
6. Parse and **validate the real Caddyfile** with current/default map environment before touching production. Fail closed on any Caddy env-substitution/adaptation error.
7. In an isolated temporary directory, create a harmless alternate provider document that still points to the existing OSM tile origin but uses a different test provider id/mode. Set temporary `PATAP_MAP_CONFIG_ROOT` to that directory and exact `PATAP_MAP_CONNECT_SRC=https://tile.openstreetmap.org`; run `npm run map:provider:check` and Caddy adaptation/validation. This proves configuration switching without buying/calling another service. Remove temporary config afterward.
8. Run production preflight; require `READY`.
9. Create fresh encrypted off-host recovery/DR evidence using the existing safe release process.
10. Make a recoverable source backup and enter normal guarded maintenance for only the processes that actually need source/build/Caddy replacement.
11. Apply candidate source non-destructively, preserving all runtime/private data; `npm ci` + build.
12. Validate deployed Caddyfile again before starting/reloading Caddy.
13. Resume/reload through the normal stack procedure and require `status-patap-stack.ps1 = HEALTHY`.
14. Public smoke: `https://patap.eu` and `https://driver.patap.eu` HTTP 200.
15. Real browser check on Driver Map with current default fallback: basemap renders, MapLibre attribution is visible, Road Reports/GPS overlays still initialize, and browser console/network has no CSP rejection for the tile origin.
16. Do not change to a new commercial tile provider during this deployment. Provider selection is a separate owner/product decision.
17. Synchronize the next safe `codex/local-workspace-snapshot` only after successful deployment, excluding all runtime/private material.

If any Caddy validation, provider validation, Map initialization, CSP, release, DR or browser regression is found, report `CHANGES_REQUIRED` with file/location/reproduction/expected behavior. Do not broaden CSP to `https:` or `*` as a shortcut.
