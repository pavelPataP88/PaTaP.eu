# NAVIGATION_ENGINE_V1 — architecture and contracts

Date: 2026-08-20 Europe/Warsaw
Base: `codex/local-workspace-snapshot @ e78ecbea105c1011a092d67f247b058f5fb2a692`

## Product placement

Navigation is **not** a seventh primary Driver view. It is a global module depending on `map` and injects two states into the existing Map card:

1. `Маршрут` — plan / compare / vehicle profile / stops.
2. `В пути` — active guidance / ETA / next maneuver / Route Guard / parking Plan B.

The bottom navigation must remain exactly six visible sections.

## Server modules

```text
server/navigation/
  schema.js                 additive module-local SQLite schema
  vehicle-profile.js        validation + Parking preference fallback
  providers/
    valhalla.js             first real router adapter
  route-guard.js            confidence/warning normalization
  service.js                orchestration, storage, parking/road enrichment
  routes.js                 authenticated API + CSRF/rate controls
```

`server/driver/routes.js` mounts `createNavigationRoutes(routeOptions, { roadReports })` before generic Driver actions. Navigation must not change existing Road Reports or Parking APIs.

## Client modules

```text
driver/navigation/
  index.js                  global runtime module, no `view`
  panel.mjs                 injected planner/guidance UI
  route-cache.mjs           session/local active-route resilience
```

`driver/map/index.js` gets only map rendering seams:
- `showRoute(route, selectedAlternativeId?)`
- `clearRoute()`
- `fitRoute()`
- `setRouteProgress(progress)` renders the completed length of the selected geometry in a separate MapLibre source/layer
- `getOwnLocation()` safe copy for planner default origin.

Map remains owner of MapLibre instance/layers. Navigation does not create a second map.

## SQLite schema

### `navigation_schema_meta`
Module version only; global auth schema version remains unchanged.

### `navigation_vehicle_profiles`
One profile per user in V1:
- `user_id`
- `vehicle_class`: TRUCK/VAN/CAR/TAXI/OTHER
- dimensions: length/width/height
- gross weight / axle load / axle count
- max speed
- trailer
- hazardous goods / ADR tunnel code
- refrigerated
- emission/CO2 optional strings
- preferred strategy
- avoid tolls/ferries/unpaved
- timestamps

If no navigation row exists, seed from `parking_user_preferences` when available:
- TIR -> TRUCK
- VAN -> VAN
- CAR -> CAR
- OTHER -> OTHER
- length/height/weight/ADR/refrigerated copied.

Navigation updates do **not** destructively overwrite Parking preferences in V1. The systems can be unified later through a separately tested migration.

### `navigation_routes`
Stores normalized route request/result:
- route id UUID;
- user id;
- status ACTIVE/COMPLETED/CANCELLED/EXPIRED;
- provider/provider version if reported;
- strategy;
- vehicle snapshot JSON;
- input JSON;
- normalized alternatives JSON;
- selected alternative id;
- route guard JSON;
- created/updated/expires.

No secret provider key, raw auth token or private provider credential is stored.

## RouterProvider contract

```js
provider.status() -> {
  name,
  configured,
  capabilities: {
    truck,
    alternatives,
    maneuvers,
    traffic,
    tolls,
    mapMatching,
    physicalDimensions,
    hgvAccess,
    axleCount,
    adrTunnelCode,
    hazmatCategories,
    emissionZones
  }
}

provider.route({ origin, destination, waypoints, vehicle, strategy, language, alternatives })
  -> normalized provider-neutral result
```

Provider errors are normalized:
- `navigation_provider_unavailable` (503)
- `navigation_provider_timeout` (504)
- `navigation_no_route` (422)
- `navigation_provider_invalid_response` (502)

No silent secondary car request after truck failure.

## Valhalla adapter

Configuration:
- `NAV_ROUTER_URL` — base service URL; absent means route calculation unavailable, not fake.
- `NAV_ROUTER_TIMEOUT_MS` — bounded timeout.

V1 request:
- `/route` JSON POST;
- `costing=truck` for TRUCK, `costing=taxi` for TAXI, and `costing=auto` for VAN/CAR/OTHER;
- vehicle dimensions/weight/axle/hazmat costing options passed when supported;
- waypoints preserved;
- alternatives requested if supported/configured;
- shape returned as GeoJSON/decoded coordinates by adapter;
- maneuvers normalized to PaTaP schema.

The provider adapter is the only place that understands Valhalla response field names.

## Normalized alternative

```json
{
  "id": "alt-1",
  "distanceKm": 0,
  "durationSec": 0,
  "trafficDelaySec": null,
  "eta": null,
  "geometry": [[lon,lat]],
  "maneuvers": [
    {
      "index": 0,
      "type": "TURN_RIGHT",
      "instruction": "...",
      "street": "...",
      "distanceKm": 0,
      "timeSec": 0,
      "beginShapeIndex": 0,
      "endShapeIndex": 0
    }
  ],
  "providerWarnings": [],
  "toll": { "available": false, "amount": null, "currency": null, "source": null, "asOf": null },
  "difficulty": { "score": null, "confidence": 0, "reasons": [] }
}
```

Unknown values are `null`, never fake zeroes.

## Route Guard

Route Guard returns:

```json
{
  "strictVehicleProfile": true,
  "confidence": 0.0,
  "level": "HIGH|MEDIUM|LOW|UNKNOWN",
  "provider": "VALHALLA",
  "warnings": [],
  "unknowns": [],
  "dataSources": [],
  "diagnosticOnly": false
}
```

Initial confidence is intentionally conservative because a self-hosted open-data route does not prove every real-world restriction is mapped. A lack of warnings is not converted to 100% certainty.

Hard invariants:
- TRUCK and VAN require height, width, length and gross weight before route calculation;
- `strictVehicleProfile=true` only when the expected provider costing and every required configured dimension/weight were actually sent;
- TRUCK axle/hazmat settings are verified against the exact provider request;
- unsupported configured ADR tunnel, hazmat-category, emission-zone, axle or non-TRUCK hazardous-goods constraints fail closed with `navigation_hard_constraints_unenforced`;
- raw uncertainty remains visible even when all expressible constraints were sent.

## Route request

```json
{
  "origin": {"latitude": 50.0, "longitude": 19.0, "label": "Current position"},
  "destination": {"latitude": 52.0, "longitude": 21.0, "label": "Warszawa"},
  "waypoints": [],
  "strategy": "PRACTICAL_TRUCK",
  "alternatives": 3,
  "departureAt": "ISO optional",
  "break": {
    "enabled": true,
    "remainingDriveMinutes": 180,
    "desiredBreakMinutes": 45
  }
}
```

V1 accepts coordinates directly. Origin may be chosen manually/on the map; otherwise calculation uses fresh server GPS. Refresh requires an explicit valid origin or GPS no older than 60 seconds and never reuses the old route start silently. Address autocomplete is a separate provider seam and must not silently depend on public Nominatim.

## ParkingRouteAdvisor

After route calculation:
1. sample route geometry to <=400 points for existing `ParkingRepository.alongRoute()`;
2. use user's existing Parking fit/security/detour preferences;
3. calculate route progress/approximate distance-to-stop along geometry instead of only straight-line route corridor distance where possible;
4. return `recommendedStops` and `planB`.

Break planner:
- if `remainingDriveMinutes` supplied, estimate target point by route travel-time ratio;
- search parking around the legal/advisory deadline window;
- prioritize compatible AVAILABLE/LIMITED, confidence, security, detour and services;
- label recommendation `ADVISORY_NOT_TACHOGRAPH`.

If Parking has no imported/community places, return empty recommendations rather than sample data.

## RoadEventCorridor

Use current `roadReports.list()` snapshot:
- project each fresh report to route geometry;
- retain reports inside corridor threshold and ahead of current/start progress;
- return approximate distance/ETA to event and report freshness;
- do not automatically reroute on a report in V1 unless user explicitly requests refresh; future confidence rules can automate this.

## Active guidance

V1 web guidance is route-following, not a claim of certified navigation:
- current GPS is projected approximately onto route;
- compute remaining route fraction/distance;
- recompute ETA from the current time plus remaining planned duration;
- choose next maneuver using shape indexes;
- render the completed route geometry and remove passed Parking/Road items with a small projection tolerance;
- show off-route state when distance from route exceeds threshold;
- offer `Перестроить` action which calls the real provider with current position and unchanged strict vehicle snapshot;
- automatic reroute requires fresh GPS, online state, sustained moving deviation and cooldown.

Complex editing becomes disabled when GPS speed exceeds a configured motion threshold; essential controls remain.

## Client cache

Cache only the user's current normalized route and selected alternative in browser storage:
- no auth token;
- no other users' GPS;
- no chat/radio content;
- bounded size;
- expiry consistent with server route record.

When API temporarily fails, cached active route can still be drawn and maneuvers displayed with explicit `cached`, `offline` or `degraded` state. Offline mode never creates or refreshes a route and does not claim fresh Parking, Road, traffic or toll data.

## API

- `GET /api/driver/navigation/status`
- `GET /api/driver/navigation/profile`
- `PATCH /api/driver/navigation/profile`
- `POST /api/driver/navigation/routes`
- `GET /api/driver/navigation/routes/:id`
- `POST /api/driver/navigation/routes/:id/select`
- `POST /api/driver/navigation/routes/:id/refresh`
- `POST /api/driver/navigation/routes/:id/finish`

Mutations require session + Driver profile + CSRF + scoped rate limit.

## Required tests

### Server integration
- profile fallback from Parking preferences;
- profile validation bounds;
- auth/CSRF/rate rules;
- fake local test provider receives strict truck constraints;
- no provider configured -> honest 503;
- provider timeout -> 504;
- malformed response -> 502;
- no truck route -> 422 and **zero car fallback requests**;
- alternatives normalize correctly;
- route record belongs only to creator;
- refresh keeps vehicle snapshot/constraints;
- Parking advisor uses real existing parking repository and returns no fabricated records;
- Road Reports corridor enrichment keeps public report privacy.

### Driver static/unit
- Navigation module has no `view` and depends on map;
- visible bottom views remain exactly six;
- no public Nominatim URL hard-coded;
- active route cache contains route only;
- Map exposes route drawing/clear/fitting seams;
- planner labels traffic/tolls unavailable when no source;
- truck failure UI never offers an automatic car-route substitute.

### Browser
- 390px bottom bar remains one row <=56px;
- Navigation panel lives over/in Map and does not create outer vertical overflow in driving state;
- route line renders from isolated provider fixture;
- profile form and route calculation keyboard accessible;
- motion/driving state hides complex editing.

## Deployment gate

Code can be reviewed/tested using an isolated routing fixture, but production Navigation is **not functionally enabled as real routing** until Codex has a real configured router endpoint (preferred self-hosted Valhalla or separately approved provider) and successfully performs a real route smoke.

If `NAV_ROUTER_URL` is absent in production, UI must say routing provider is not configured; this is acceptable and safer than a fake route.
