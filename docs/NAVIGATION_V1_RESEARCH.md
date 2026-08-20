# NAVIGATION_ENGINE_V1 — global research and product decisions

Date: 2026-08-20 Europe/Warsaw
Base: `codex/local-workspace-snapshot @ e78ecbea105c1011a092d67f247b058f5fb2a692`
Status: research/product contract for implementation; not a deployment claim.

## 1. Goal

PaTaP Navigation must not be a generic A→B car navigator. The product already has Map/GPS, Road Reports, Parking Network, People/Communities and Event Center. Navigation should connect those systems into one operational driver workflow:

`vehicle + destination + legal/physical restrictions + route + traffic/incidents + parking/breaks + driver/community evidence -> safe/practical trip`

The target is a provider-neutral navigation layer that can use a self-hosted routing engine first and licensed traffic/toll/map providers later without rewriting the Driver product.

## 2. What the market does well

### Google Maps

Strengths:
- excellent consumer search/discovery;
- simple route selection and turn-by-turn UX;
- real-time traffic, voice instructions and lane guidance;
- quick alternative route suggestions.

Critical gap for PaTaP:
- Google's own navigation help says oversized vehicles are not intended users. It is therefore not an acceptable legal/physical truck routing core.

Source:
- https://support.google.com/maps/answer/3273406

### Waze

Strengths:
- community traffic loop;
- rapid reports for accidents, blocked roads, hazards, weather and other live conditions;
- routing continuously benefits from driver speed/report data;
- very low-friction incident reporting.

Critical gap:
- Waze's own help says the product is designed for private cars, motorcycles and taxis and does not currently support truck navigation.

Source:
- https://support.google.com/waze/answer/6071177

### Sygic Truck & Caravan

Strengths:
- true offline navigation;
- vehicle height, width, length, weight and axle load;
- routing based on large-vehicle restrictions;
- hazardous-load settings;
- restricted/no-drive areas;
- truck POIs and mature turn-by-turn UX.

Important weakness/opportunity:
- Sygic itself documents that missing/incorrect/outdated restrictions, recent road changes and mismatched map-provider datasets can cause wrong/unexpected routing. Offline maps are updated periodically rather than continuously. PaTaP should surface route-data confidence and source freshness instead of pretending route certainty.

Sources:
- https://help.sygic.com/hc/en-us/articles/37948287320338-Features-and-user-guide-for-Sygic-Truck-Caravan-Navigation
- https://help.sygic.com/hc/en-us/articles/37977856553618-How-to-update-offline-maps
- https://help.sygic.com/hc/en-us/articles/16851283458578-Routing-and-navigation-issues

### ROAD LORDS

Strengths:
- explicit truck profiles;
- ADR/environmental/restriction awareness;
- multi-waypoint truck routing;
- truck parking availability and amenities;
- community/social layer;
- downloadable maps/offline product tier.

Opportunity:
- ROAD LORDS shows that truck navigation + community + parking is a valid product direction, but those capabilities remain separate concepts in much of the UX. PaTaP can rank parking directly against current route progress, legal break timing, live occupancy confidence and Plan B rather than merely showing nearby POIs.

Sources:
- https://www.roadlords.com/about
- https://roadlords.com/pl/driver
- https://www.roadlords.com/faq

### Trimble CoPilot Truck

Strengths:
- physical/legal truck restrictions;
- height/weight/axle/width/length/hazardous cargo;
- ADR tunnel categories in Europe;
- practical routing that discourages unsuitable local roads, sharp turns and U-turns;
- alternate routes and live/historical traffic options;
- commercial-grade route configuration.

Product lesson:
- 'shortest' or even raw 'fastest' is not enough for a truck. PaTaP needs a practical-truck cost strategy and a route-difficulty score, not only ETA/distance.

Reference family:
- https://support.copilotpro.com/ (Truck Routing / Vehicle Routing Profiles / ActiveTraffic documentation)

### PTV Navigator / PTV Logistics

Strengths:
- commercial truck restriction datasets;
- weight, axle load, clearance height/width/length;
- hazardous goods restrictions;
- professional logistics/toll context.

Product lesson:
- toll and compliance information is data-provider/date/vehicle dependent. PaTaP must not hard-code guessed country toll formulas.

Source:
- https://www.ptvlogistics.com/en/Factsheet_PTV_Navigator_Android_EN.pdf

### HERE

Strengths:
- truck transport mode;
- truck dimensions and hazardous goods;
- truck restriction warnings;
- truck-regulated speed limits;
- emission-zone avoidance and road attributes;
- enterprise map layers for vehicle restrictions.

Product lesson:
- Navigation architecture needs a generic restriction model that can ingest richer commercial overlays later even if V1 uses open routing data.

Source:
- https://docs-be.here.com/bundle/sdk-for-android-navigate-developer-guide-4.12.0.0/raw/resource/enus/HERE_SDK_for_Android_Navigate_v4.12.0.0_Developer_Guide.pdf

### TomTom

Strengths:
- commercial-vehicle routing parameters;
- weight, axle weight, axle count, length, width, height;
- commercial-vehicle flag;
- hazardous load and ADR tunnel restriction code;
- traffic and consumption/reachable-range APIs.

Product lesson:
- PaTaP's canonical vehicle route profile must be rich enough that a future commercial routing adapter does not require a schema redesign.

Sources:
- https://developer.tomtom.com/routing-api/documentation/tomtom-maps/calculate-reachable-range
- TomTom Routing SDK RouteQuery/VehicleDimensions reference family.

## 3. Open routing engines

### Valhalla — preferred primary self-hosted direction

Why it fits PaTaP:
- open source routing engine based on open data;
- tiled hierarchy suitable for regional/server deployments and offline-oriented architecture;
- dynamic runtime costing;
- alternate routes;
- maneuver/narrative generation;
- map matching and related routing services;
- extensible costing architecture including specialized routing use cases.

PaTaP decision:
- build a `ValhallaProvider` adapter first;
- keep provider interface generic so GraphHopper/HERE/TomTom/Trimble adapters can coexist later;
- do not make Valhalla-specific response structures leak into Driver UI or PaTaP route storage.

Sources:
- https://valhalla.github.io/valhalla/
- https://valhalla.github.io/valhalla/api/turn-by-turn/overview/
- https://valhalla.github.io/valhalla/start/introduction/

### GraphHopper — secondary/alternative provider seam

Strengths:
- mature routing API;
- custom models can modify speed/priority/distance influence;
- custom profiles and routing/optimization ecosystem.

Decision:
- architecture must allow a GraphHopper adapter, but V1 implementation does not need to run two routing engines in production simultaneously.

Sources:
- https://docs.graphhopper.com/
- https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md

## 4. Geocoding/search policy

Do not hard-wire public OSM Nominatim into production autocomplete. Public Nominatim has an Acceptable Use Policy intended for limited use and is not a production-scale autocomplete backend.

Decision:
- `GeocoderProvider` is a separate interface;
- V1 can accept coordinates/direct map selection even when no geocoder is configured;
- production autocomplete is enabled only with an explicitly configured compliant/self-hosted/licensed provider;
- no secret/API key is committed to GitHub.

Policy source:
- https://operations.osmfoundation.org/policies/nominatim/

## 5. EU professional-driver break planning

For drivers in scope of EU driving/rest rules, a 45-minute break is required after 4.5 hours of driving (with regulatory nuances and split-break possibilities).

Decision:
- PaTaP V1 includes an **advisory break planner**, not a tachograph replacement;
- it never claims legal compliance unless real verified tachograph state is integrated later;
- driver can enter remaining driving time / driving-since state;
- route planner proposes suitable parking before the computed break deadline;
- Parking Plan B remains available if the preferred stop becomes full/closed.

Source:
- European Commission Mobility Package Q&A / Regulation 561/2006 guidance: https://transport.ec.europa.eu/document/download/9b15907b-eb1d-4c28-8247-4b87c808c82f_en

## 6. What PaTaP should improve beyond competitors

### 6.1 Route Guard — no false certainty

Every route gets a machine-readable safety/restriction assessment:
- hard vehicle limits sent to routing provider;
- warnings returned by provider;
- source/provider identity;
- map/data timestamp when available;
- route-level restriction confidence;
- PaTaP road/community evidence separately labelled;
- explicit unknown state when evidence is unavailable.

**Critical invariant:** If strict truck routing fails, PaTaP must never silently fall back to a car route and present it as safe for TIR.

A relaxed route may only be calculated in a future diagnostic mode to explain likely blockers and must be labelled `NOT_SAFE_TO_FOLLOW`.

### 6.2 Practical Truck, not only Fastest

Strategies:
- `FASTEST_LEGAL`
- `PRACTICAL_TRUCK` — default TIR strategy; penalizes low-class/urban/turn-heavy roads when provider supports it
- `EASY_TRUCK` — stronger comfort/simplicity bias
- `ECONOMY`
- `PARKING_AWARE`

A route comparison should show:
- ETA/duration;
- distance;
- traffic delay when a real source exists;
- toll estimate + source/date or `unavailable`;
- restriction confidence;
- route difficulty;
- parking/break quality.

### 6.3 Route difficulty score

A separate score should explain *why* a route is easier/harder, when data is available:
- urban/local road share;
- turn/U-turn complexity;
- steep/terrain evidence;
- restriction uncertainty;
- border/country transitions;
- unresolved warnings.

Unknown inputs lower confidence rather than being treated as zero risk.

### 6.4 Parking-aware break planner

Use existing PaTaP Parking Network instead of a generic POI list:
- exact vehicle fit;
- route detour;
- live occupancy and freshness/confidence;
- security/certification;
- services (toilet/shower/food/fuel/frigo etc.);
- review evidence;
- break deadline;
- Plan B alternatives.

### 6.5 Route-aligned Road Reports

Existing radius alerts are useful near the driver, but Navigation should additionally answer:
- is the report actually ahead on my route?
- how far / how many minutes to it?
- does it materially change the route?

Do not reroute for every community report. Require freshness, confidence and meaningful route impact to prevent route churn.

### 6.6 Arrival intelligence

For yards/factories/restricted destinations:
- distinguish final destination from legal vehicle approach point;
- support preferred gate/entrance in the future;
- if routing provider cannot legally reach destination, return a clear restricted-arrival state rather than hiding the problem;
- community-confirmed truck entrances can become a later evidence layer.

### 6.7 Offline resilience without false marketing

Web/PWA V1:
- cache current route geometry, maneuvers, destination and selected parking/critical event context so active guidance can survive a temporary network interruption;
- do **not** claim full-country offline recalculation in the browser when no local routing engine/maps exist.

Future native/on-device/server-edge builds may add downloadable routing tiles and true offline rerouting.

### 6.8 Distraction control

While the vehicle is moving:
- keep map/guidance dominant;
- hide/lock complex route editing;
- allow essential controls only: recenter, audio/mute, report hazard, Plan B parking, stop navigation;
- non-urgent Event Center notifications stay non-interruptive under existing Driving Mode rules.

## 7. Canonical vehicle route profile

Navigation needs a richer profile than a generic Driver type. V1 fields:
- mode/class: `TRUCK | VAN | CAR | TAXI | OTHER`;
- height m;
- width m;
- length m;
- gross weight t;
- axle load t;
- axle count;
- max governed speed km/h;
- trailer flag;
- hazardous-goods flag/categories;
- ADR tunnel restriction code;
- refrigerated flag;
- emission class / CO2 class seams for future toll/LEZ providers;
- preferred route strategy;
- avoid tolls/ferries/unpaved where provider supports it.

Existing Parking preferences are imported as defaults/fallback so the user is not forced to re-enter height/length/weight/ADR. Parking's current schema remains backward compatible.

## 8. Provider architecture

`NavigationService`

-> `RouterProvider` (V1 Valhalla, future GraphHopper/HERE/TomTom/Trimble)

-> `TrafficProvider` (optional; no fake traffic)

-> `TollProvider` (optional; no guessed formulas)

-> `GeocoderProvider` (optional/compliant)

-> PaTaP `RouteGuard`

-> PaTaP `ParkingRouteAdvisor`

-> PaTaP `RoadEventCorridor`

-> Driver Map/Guidance

Provider absence is a first-class state, not an excuse to return a fake route.

## 9. Core safety/truth invariants

1. Never silently relax physical/ADR restrictions.
2. Never present car routing as TIR routing.
3. Never fabricate traffic, toll price, speed restriction, parking occupancy or confidence.
4. Unknown data is visibly unknown.
5. Route data and community data retain separate provenance.
6. A community correction can penalize/warn but cannot override a hard legal restriction by itself.
7. Routing secrets remain outside GitHub.
8. Public Nominatim is not used as production autocomplete.
9. Route calculation failure is returned honestly with machine-readable reason.
10. Navigation remains inside Map; bottom navigation remains six primary sections.

## 10. V1 implementation boundary

Build now:
- provider-neutral route service;
- Valhalla adapter;
- canonical vehicle route profile;
- route alternatives normalization;
- Route Guard metadata/confidence;
- route drawing and route planner inside Map;
- route guidance state/maneuvers;
- parking-along-route advisor using existing Parking Network;
- route-aligned current PaTaP Road Reports;
- advisory break planner;
- active-route client cache for temporary connectivity loss;
- strong tests with an isolated fake provider server **only in tests**.

Not fake/overclaim in V1:
- no real live traffic unless a provider/feed is actually configured;
- no toll amount without a real source;
- no full offline routing claim;
- no tachograph legal-compliance claim;
- no commercial-map restriction dataset claim;
- no automatic country-wide Parking import;
- no Voice Assistant implementation in this block.

## 11. Success criterion

A TIR driver can configure the actual vehicle, build multiple route alternatives through a real configured router, see which option is legally/operationally preferable, receive route-specific road warnings, see trusted parking choices and break Plan B along the route, and continue seeing the active route/guidance during a short network interruption — without PaTaP inventing information it does not have.
