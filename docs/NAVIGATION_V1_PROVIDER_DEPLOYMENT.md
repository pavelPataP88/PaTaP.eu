# PaTaP Driver — NAVIGATION_V1 provider deployment gate

Date: 2026-08-20
Status: engineering contract for Codex / operations

## 1. Production truth

`NAVIGATION_V1` contains a real provider adapter. It does **not** contain a fake route generator and must never silently downgrade a truck request to a car route.

The implemented router adapter is Valhalla-compatible and reads:

- `NAV_ROUTER_URL`
- `NAV_ROUTER_TIMEOUT_MS`

Place search reads an optional Nominatim-compatible endpoint:

- `NAV_GEOCODER_URL`
- `NAV_GEOCODER_TIMEOUT_MS`

If the router URL is missing, PaTaP reports `navigation_provider_unavailable`. It does not draw a synthetic straight line.

If the geocoder URL is missing, route creation still works from map-picked/manual coordinates and PaTaP Parking search remains available. External address autocomplete is simply unavailable.

## 2. Public demo services are not production dependencies

Do not configure end-user production navigation to depend on `valhalla.openstreetmap.de` as its normal backend. Valhalla's own documentation calls it a public demo server and describes fair-use/rate limits.

Do not configure `nominatim.openstreetmap.org` as PaTaP autocomplete. The public Nominatim usage policy does not permit client-side autocomplete. The PaTaP adapter rejects that hostname deliberately.

Approved choices for production are:

1. PaTaP-controlled/self-hosted Valhalla + PaTaP-controlled/self-hosted geocoder; or
2. a separately reviewed managed routing/geocoding provider with a dedicated PaTaP adapter and its own licence/SLA/privacy review.

Do not insert API keys, tokens or provider credentials into GitHub.

## 3. Recommended PaTaP topology

```text
Driver browser
  -> patap.eu Node API
      -> Navigation service
          -> Route Guard
          -> Valhalla-compatible router
          -> optional geocoder
          -> PaTaP Parking Network
          -> PaTaP Road Reports
```

The browser must not call the router/geocoder directly. This keeps provider URLs, rate controls, normalization, Route Guard and future provider replacement on the server side.

## 4. Router graph / data

Valhalla builds its road graph primarily from OpenStreetMap. A production deployment must use a documented data refresh process and preserve required OSM/ODbL attribution/licensing obligations.

The router must be built with the regions PaTaP intends to serve. Do not claim Europe coverage merely because the UI accepts European coordinates; coverage is the actual graph loaded by the production router.

For the first serious server, prefer a dedicated Linux host/container deployment rather than coupling Europe routing graph memory/disk load to the current Driver web process. Measure graph size, tile build time, cold start, route latency and memory on the chosen hardware before publishing capacity claims.

## 5. Required Valhalla contract for PaTaP

For `TRUCK`, the current adapter sends and Route Guard verifies where configured:

- `costing=truck`
- height
- width
- length
- gross weight
- axle load
- axle count
- hazmat boolean
- max speed
- `hgv_no_access_penalty=43200`
- preference for designated HGV routes (`use_truck_route`)
- toll/ferry/unpaved preferences

If PaTaP has a non-`NONE` ADR tunnel code or other hazardous-goods categories that the active router adapter cannot enforce, Route Guard rejects strict guidance rather than claiming the restriction is covered.

Traffic delay and toll price stay `null/unavailable` unless a reviewed data source is actually configured.

## 6. Geocoder privacy

A destination query can reveal travel intent. Therefore:

- prefer self-hosted search for production;
- keep the browser talking only to PaTaP;
- do not log full search queries longer than operationally necessary;
- do not expose provider credentials to the browser;
- if a managed third-party geocoder is introduced, document what query/location data it receives before activation.

Current `NAV_GEOCODER_URL` is a server configuration value, not user input.

## 7. Deployment acceptance sequence

Codex must not call Navigation production-ready merely because the fake provider test suite passes.

Required sequence:

1. Full repository regression suite PASS with the isolated fake router/geocoder.
2. Configure a reviewed real `NAV_ROUTER_URL` outside GitHub.
3. Confirm the route service graph actually covers the intended smoke-test corridor.
4. Create a temporary Driver test account/profile with explicit truck dimensions.
5. Run a real route smoke and verify the provider receives `truck`, dimensions, weight and HGV constraints.
6. Verify a deliberately impossible/over-restricted truck request fails closed and does not retry as car.
7. Verify map route drawing, alternative selection, guidance and reroute with temporary data.
8. If a geocoder is configured, verify search attribution/privacy and that `nominatim.openstreetmap.org` is not the configured production endpoint.
9. Verify PaTaP Parking/Road enrichment only shows actual current PaTaP data; empty data remains empty.
10. Only then restart/apply production and record exact provider/data scope in `AI_HANDOFF.md`.

## 8. Future provider seams

The normalized Navigation contract intentionally allows later adapters for HERE, TomTom, PTV or another reviewed provider. A future adapter may add capabilities such as:

- dedicated ADR tunnel categories;
- commercial-vehicle toll cost;
- live/predictive traffic;
- low-emission-zone rules;
- stronger truck attributes or map freshness.

Those capabilities must be declared by the adapter and checked by Route Guard. UI labels must remain unavailable/unknown until the capability is backed by a real source.
