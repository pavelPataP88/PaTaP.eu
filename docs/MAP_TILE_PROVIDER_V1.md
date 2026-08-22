# AUD-023 — MAP_TILE_PROVIDER_V1

## Goal

Remove Driver's operational hard dependency on one baked-in public tile endpoint while keeping the current map behavior and attribution correct.

This block does **not** choose or buy a commercial map provider. The current OpenStreetMap Standard raster endpoint remains the default fallback so the deployed site keeps working until the owner selects another reviewed provider or self-hosted tile service.

OpenStreetMap's current Tile Usage Policy explicitly recommends avoiding hard-coded tile URLs and warns that `tile.openstreetmap.org` is best-effort, has no SLA, may block problematic/heavy usage, and is not an offline/bulk-download service. Driver continues to request only the tiles needed for the interactive viewport and does not add prefetch/offline downloading.

## Runtime design

The active map module is now `driver/map/provider-bootstrap.mjs`.

Before the existing Map controller is created it:

1. removes any embedded legacy `tiles`, `attribution` and `tileSize` values from `#driver-map-config`;
2. fetches `/map-provider.json` with `cache: no-store`;
3. validates the provider document;
4. applies the selected tiles, tile size, max zoom and attribution;
5. only then creates the existing map module.

If the provider document is unavailable or invalid, the Map module fails closed. Chat, Radio, People and Profile remain independent modules; the application does not silently fall back to an embedded tile URL.

`driver/map-provider.json` is the default deployed provider document. It currently declares the existing OSM Standard public fallback.

## Provider document

Schema v1 example:

```json
{
  "version": 1,
  "id": "company-map-service",
  "mode": "CUSTOM",
  "tiles": ["https://maps.example.com/tiles/{z}/{x}/{y}.png"],
  "tileSize": 256,
  "maxZoom": 19,
  "attribution": "© Example Maps · © OpenStreetMap contributors",
  "reportIssueUrl": "https://example.com/map-feedback"
}
```

Accepted modes:

- `PUBLIC_OSM_FALLBACK`
- `CUSTOM`
- `SELF_HOSTED`

Safety rules:

- every template must contain `{z}`, `{x}` and `{y}`;
- external templates must use HTTPS;
- URL credentials are rejected;
- root-relative same-origin templates such as `/tiles/{z}/{x}/{y}.png` are allowed;
- one to four tile templates are allowed;
- tile size is 256 or 512;
- max zoom is 1..24;
- non-empty attribution is mandatory;
- optional issue/report URL must use HTTPS.

A client-visible tile API token is not a secret. Do not put credentials into the URL that the provider expects to remain private. If a future provider requires server-secret authentication, design a reviewed provider-specific integration instead of putting the secret into this JSON.

## Switching without Driver code changes

By default Caddy serves `/map-provider.json` from:

`D:/WWW.PATAP.EU/var/build/driver/map-provider.json`

For an operator-managed provider file outside the source/build tree:

1. place only a reviewed `map-provider.json` in a dedicated directory, for example `D:/WWW.PATAP.EU/data/map-config/`;
2. set `PATAP_MAP_CONFIG_ROOT=D:/WWW.PATAP.EU/data/map-config` for the Caddy process;
3. set `PATAP_MAP_CONNECT_SRC` to the exact external HTTPS origin(s) required by the configured tile templates, separated by spaces;
4. run `npm run map:provider:check` from the production source;
5. validate Caddy configuration before restarting/reloading Caddy;
6. reload/restart Caddy through the normal guarded stack procedure;
7. verify the map and attribution in a real browser.

Example for one provider origin:

```text
PATAP_MAP_CONNECT_SRC=https://maps.example.com
```

Do **not** use a broad `https:` or `*` CSP source. The checker rejects wildcard/broad origins.

Same-origin self-hosted tiles do not need an additional external CSP origin.

## Caddy security boundary

Only the exact public request path `/map-provider.json` can use `PATAP_MAP_CONFIG_ROOT`. This does not expose the rest of `data/`; the existing `/data*` private rule remains.

The normal Driver CSP keeps `connect-src 'self'` and adds only the reviewed origins from `PATAP_MAP_CONNECT_SRC`. With no override it defaults to the existing `https://tile.openstreetmap.org` origin.

## Verification

Mandatory candidate checks:

- `npm run map:provider:check`;
- `npm run verify:release`;
- Driver provider tests validate HTTPS/same-origin templates, fail-closed invalid input, attribution and registry/bootstrap wiring;
- Caddy policy tests protect the exact provider-config path and CSP override contract;
- build must copy `driver/map-provider.json`;
- Windows Codex gate must parse/validate `Caddyfile.tunnel` with the default environment and with an isolated custom-provider environment;
- isolated browser smoke must prove that changing the provider document changes MapLibre's basemap request target without changing Driver code;
- production deploy must keep current OSM fallback unless the owner separately selects a replacement provider.

## Intentionally unchanged

- MapLibre version and lazy loading;
- GPS collection/privacy;
- nearby Driver behavior;
- Road Reports;
- Parking map bridge;
- Navigation / `NAV_ROUTER_URL`;
- no offline tile download or bulk prefetch;
- no paid infrastructure;
- `main`;
- user data, SQLite, media, secrets and runtime data.
