# PARKING_NETWORK_V1 — market research and product model

Date: 2026-08-19 Europe/Warsaw
Status: research applied to candidate branch `chatgpt/parking-network-v1`.
Base: `codex/local-workspace-snapshot @ 53b973221540b80d782426a58ade532eb89ab92e`.

## Objective

Build Parking as a first-class Driver PaTaP subsystem, not a thin POI list. The product must work for the first small cohort and already have a data model/API that can move to a dedicated server/database later without redesigning the product.

Core product equation:

`authoritative/open data + operator data + driver observations + history => one canonical parking place with freshness, confidence and vehicle fit`

No competitor code, CSS, icons, proprietary datasets or trade dress are copied.

## Market need

The European Commission reported in 2025 that the EU has a critical shortage of safe and secure truck parking: a gap of about 390,057 spaces, projected to about 483,000 by 2040. The same work stresses digitalisation, reliable information and security certification as part of the solution.

Official references:
- European Commission: https://transport.ec.europa.eu/news-events/news/more-safe-and-secure-parking-professional-drivers-needed-eu-study-reveals-2025-04-11_en
- Commission report COM(2025) 703: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:52025DC0703
- Safe and secure truck parking: https://transport.ec.europa.eu/transport-themes/smart-mobility/road/its-directive-and-action-plan/safe-and-secure-truck-parking_en

## Competitor / adjacent-service review

### Trucker Path

Useful product patterns:
- real-time parking state;
- simple driver-readable availability states;
- community updates;
- timestamp of the update;
- parking prediction when live data is unavailable;
- amenity filters;
- reviews;
- favorites;
- parking along a truck route.

Official product/help sources:
- https://truckerpath.com/trucker-path-app
- https://helpcenter.truckerpath.com/hc/en-us/articles/9398625000717-Purchasing-A-Subscription-To-Trucker-Path
- https://helpcenter.truckerpath.com/hc/en-us/articles/41803805436173-Trucker-Path-Driver-App-Tutorial

Decision for PaTaP:
- take the live-status + prediction + filters pattern;
- do not copy subscription gating or UI;
- expose confidence and source freshness more explicitly than a single traffic-light icon.

### MICHELIN Truckfly

Useful product patterns:
- European truck-specific POIs;
- parking/restaurants/fuel/garages in one driver context;
- community reviews and recommendations;
- services relevant to professional drivers;
- navigation-aware stop planning.

Official sources:
- https://www.michelin.com/en/publications/products-and-services/truckfly-by-michelin-launches-an-innovative-gps-heavyweight
- https://mobilityintelligence.michelin.com/en/products/truck-poi/
- https://faq.truckfly.com/

Decision for PaTaP:
- use driver-oriented amenity semantics, not generic car-parking semantics;
- keep parking data compatible with future route/navigation blocks;
- do not depend on Michelin proprietary POI data.

### Bosch Road Services / Secure Truck Parking

Useful product patterns:
- reservable secure parking;
- route-oriented booking;
- detailed security filters: controlled access, CCTV, guard/control center, fence, gate, lighting, certification;
- operational amenities: shower, Wi-Fi, 24/7, restaurant/shop, truck wash/repair, refrigeration power;
- truck energy/charging;
- explicit access/authentication methods.

Official sources:
- https://www.bosch-secure-truck-parking.com/en/
- https://portal.bosch-secure-truck-parking.com/en/

Decision for PaTaP:
- model booking capability and external provider/link/phone now;
- do not fake an internal reservation/payment system without operator contracts;
- model security and truck-service attributes in the canonical object.

### TRAVIS Road Services

Useful product patterns:
- pre-bookable European truck parking network;
- guaranteed spot as a planning product;
- filtering by safety and facilities;
- clear location instructions.

Official source:
- https://www.yourtravis.com/service/truck-parking/

Decision for PaTaP:
- store provider-specific reservation links and instructions;
- allow future provider adapters without changing the parking-place API.

### EU / ESPORG Safe & Secure Parking standard

The EU Safe and Secure Truck Parking Area framework uses cumulative Bronze, Silver, Gold and Platinum security levels. ESPORG highlights that this is a legal EU standard rather than merely a private badge.

Official / sector references:
- https://esporg.eu/2026/02/05/eu-parking-standard-europes-legal-benchmark-for-secure-truck-parking-and-supply-chain-resilience/
- https://transport.ec.europa.eu/transport-modes/road/parking-areas_en

Decision for PaTaP:
- certification is a dedicated structured field (`NONE|BRONZE|SILVER|GOLD|PLATINUM`), not a user rating;
- certification source/date/expiry are kept separately from community opinion;
- never label a parking certified based only on driver reports.

## Data sources

### 1. EU / national NAP / DATEX II

EU rules require public/private parking operators and providers to share safe/secure truck-parking data via national/international access points. The European Commission maintains a European Access Point and publishes Member State static data in DATEX II. Individual NAPs can expose richer/current data.

References:
- https://transport.ec.europa.eu/transport-themes/smart-mobility/road/its-directive-and-action-plan/safe-and-secure-truck-parking_en
- https://transport.ec.europa.eu/transport-themes/smart-mobility/road/its-directive-and-action-plan/national-access-points_en
- https://data.europa.eu/data/datasets/etpa

PaTaP policy:
- `OFFICIAL_DATEX` is high-authority structured input;
- source update time and external ID are retained;
- static metadata and dynamic occupancy are stored separately;
- national credentials/URLs are environment/runtime configuration, never committed secrets.

### 2. OpenStreetMap

OSM is the broad open coverage/fallback layer. Relevant tags include `amenity=parking`, `highway=services`, HGV access and `capacity:truck=*`.

References:
- https://wiki.openstreetmap.org/wiki/Key:capacity:truck
- https://www.openstreetmap.org/copyright

PaTaP policy:
- imported OSM records retain source IDs and attribution;
- OSM ODbL attribution/licence obligations must be preserved;
- public Overpass instances are not treated as a permanent high-volume backend;
- importer accepts Overpass JSON for bootstrap/small-area updates and normalized bulk input for scalable imports.

### 3. Driver community

Drivers can:
- create a missing parking;
- report current occupancy;
- review a parking;
- submit corrections;
- upload a parking photo;
- favorite a parking.

Community input never silently overwrites official certification. Conflicts are visible through source/freshness/confidence.

### 4. Operators / commercial providers

Future adapters can attach:
- booking URL;
- booking provider;
- phone;
- live capacity;
- price;
- charging availability;
- access instructions.

V1 supports these fields and normalized import without pretending PaTaP owns the booking transaction.

## Canonical parking object

One `parking_places` row is the user-facing object. It can have multiple `parking_place_sources` records.

Identity / location:
- canonical ID;
- name;
- latitude/longitude;
- country;
- address;
- road / motorway;
- direction;
- parking kind;
- operator.

Capacity / access:
- truck capacity;
- general capacity;
- 24/7;
- paid/free/unknown;
- price text/currency when structured data exists;
- max length/height/weight;
- extra-long truck;
- ADR;
- trailer decoupling.

Driver services:
- toilet;
- shower;
- food/restaurant;
- shop;
- Wi-Fi;
- laundry;
- water;
- accommodation;
- vending.

Truck services:
- diesel;
- AdBlue;
- LNG;
- hydrogen;
- EV charging;
- refrigeration power;
- truck wash;
- repair/workshop.

Security:
- restricted vehicle access;
- CCTV;
- guard/control centre;
- fence;
- gate;
- lighting;
- personal access control;
- EU certification level and evidence metadata.

Booking:
- reservable;
- provider;
- external URL;
- phone;
- instructions.

## Live occupancy model

Driver-facing states:
- `AVAILABLE` — many/open spaces;
- `LIMITED` — space is scarce;
- `FULL` — no practical capacity;
- `CLOSED` — cannot currently be used;
- `UNKNOWN`.

An observation can contain `freeSpots` and `totalSpots` when known.

Freshness:
- official dynamic feed: short TTL configured by source, default 20 minutes;
- driver report: strongest for 60 minutes, usable with decay up to 120 minutes;
- stale live reports are not displayed as current truth.

Consensus:
- official current occupancy has the highest single-source authority;
- fresh distinct driver observations are age-weighted;
- agreement raises confidence;
- conflicts reduce confidence;
- PaTaP returns status + confidence + source type + timestamp.

## Prediction

Prediction is not presented as live truth.

When live data is absent, PaTaP can use historical occupancy observations for the same weekday/time bucket. V1 uses a transparent weighted historical model, not a black-box claim of AI:
- minimum sample threshold;
- status converted to occupancy score;
- recent history weighted more strongly;
- output explicitly marked `predicted=true` with sample count/confidence.

This is compatible with replacing the model later without changing the API.

## Vehicle-fit model

Parking suitability is not identical for every truck.

User parking preferences store optional:
- vehicle class;
- length;
- height;
- gross weight;
- ADR requirement;
- refrigerated/frigo-power requirement;
- secure-only preference;
- max detour.

Search returns `fit.score` and concrete `fit.issues`, for example:
- `height_limit`;
- `weight_limit`;
- `adr_not_supported`;
- `security_required`;
- `frigo_power_missing`.

Unknown data reduces confidence but is not treated as a false hard prohibition.

## Search/ranking

Parking search is multi-factor, not nearest-only.

Ranking considers:
1. hard vehicle incompatibilities;
2. live availability;
3. distance/detour;
4. security requirement/certification;
5. user-selected amenities;
6. rating;
7. data confidence/freshness.

A FULL/CLOSED parking can remain visible but is demoted and details return nearby `alternatives` as Plan B.

## Along-route API

Navigation is a later block, but Parking exposes a route-compatible contract now:
- caller supplies route points;
- parking is matched to the route corridor;
- response includes approximate nearest route-point distance / detour proxy;
- future routing engine can replace the proxy with true road-network detour without changing parking identity/data.

## Reviews

Structured ratings:
- overall;
- security;
- cleanliness;
- access;
- quietness/rest quality.

One active review per user/place; the user can update their review. Public aggregate is separate from EU certification.

## Corrections and missing places

Community-created place:
- immediately stored as source `PATAP_COMMUNITY`;
- marked community/unverified until corroborated by another source or administrative review;
- can still be useful, but confidence explains uncertainty.

Corrections are append-only reports, not immediate destructive edits to official data.

## Photos

V1 supports authenticated driver uploads:
- JPEG / PNG / WebP;
- maximum 5 MiB;
- private runtime storage outside static web root;
- database metadata;
- `nosniff` and private/no-store delivery;
- uploader can delete own photo;
- future moderation state is preserved in schema.

No user/runtime photo is committed to GitHub.

## Import architecture

Import is separate from interactive Driver requests:

`source adapter -> normalized parking record -> dedupe/merge -> SQLite -> Parking API`

V1 adapters:
- normalized JSON (contract for any operator/NAP connector);
- OSM/Overpass JSON;
- DATEX II minimum-profile XML best-effort parser for common static/dynamic parking elements.

Importer runs as a CLI/process, never inside a Driver page request.

Deduplication:
1. exact `(source, external_id)`;
2. otherwise geographic candidates near the point;
3. normalized name/operator similarity;
4. merge only above a conservative threshold;
5. preserve every source record for audit/rebuild.

## Scale path

Do not deliberately cripple V1 for the current laptop.

Current implementation may use SQLite because the deployed PaTaP stack already uses it and the first cohort is small. The domain contract is intentionally separable:
- parking repository;
- import workers;
- media storage;
- source adapters;
- HTTP API.

A later server migration can replace the repository with PostgreSQL/PostGIS and object storage while preserving IDs/API semantics. Import jobs are already process-separated so heavy imports do not belong in the interactive backend event loop.

## Explicit non-goals / honesty boundaries

V1 does NOT claim:
- a paid reservation is guaranteed by PaTaP without an operator integration;
- every European NAP exposes live availability;
- every OSM record is truck-suitable;
- prediction is live occupancy;
- community ratings equal official security certification;
- DATEX formats are identical across every Member State.

The code preserves these distinctions instead of flattening everything into one unreliable number.
