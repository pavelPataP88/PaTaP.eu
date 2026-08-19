# PARKING_NETWORK_V1 — CODEX HANDOFF

Date: 2026-08-19 Europe/Warsaw
Status: **READY_FOR_CODEX_REVIEW — NOT DEPLOYED BY CHATGPT**

## Exact candidate

- repository: `pavelPataP88/PaTaP.eu`
- source-of-truth base: `codex/local-workspace-snapshot`
- exact base SHA: `53b973221540b80d782426a58ade532eb89ab92e`
- candidate branch: `chatgpt/parking-network-v1`
- code + tests HEAD before handoff docs: `6e08442b34b2596da7c87929a771b9cfb8fd9c00`

Do not use older ChatGPT branches as base.
Do not modify `main` unless Pavel explicitly asks.
Do not mix unrelated UI shell/Caddy/Chat/Radio/People redesign work into this review.

## Read first

1. `AI_TASK.md`
2. `docs/PARKING_NETWORK_V1_RESEARCH.md`
3. `docs/PARKING_NETWORK_V1_SOURCES.md`
4. this file
5. current `AI_HANDOFF.md` and `docs/CURRENT_ENGINEERING_STATE.md` from the real workspace

## Product implemented

### Parking domain

Canonical parking places with independent source provenance:
- OSM;
- official DATEX/NAP;
- operator/provider normalized feeds;
- PaTaP community additions;
- future admin/other feeds.

A place stores professional-driver data:
- coordinates/address/road/direction/operator;
- truck/general capacity;
- 24/7 and fee/price;
- length/height/weight restrictions;
- extra-long truck / ADR / trailer decoupling;
- toilet/shower/food/shop/Wi-Fi/laundry/water/accommodation/vending;
- diesel/AdBlue/LNG/H2/EV/frigo power/truck wash/repair;
- controlled access/CCTV/guard/fence/gate/lighting/personal access control;
- EU security certification: NONE/BRONZE/SILVER/GOLD/PLATINUM;
- external booking provider/url/phone/instructions;
- confidence/freshness/provenance.

### Source fusion

Import path is deliberately separate from Driver HTTP:

`source adapter -> normalized record -> source fusion -> canonical SQLite -> Parking API`

Rules:
- `(source_type, external_id)` is idempotent;
- conservative geo/name/operator dedupe;
- raw source record retained;
- high-authority source can update facts it actually supplies;
- missing/empty fields do not erase useful facts from another source;
- confirmed boolean enrichments such as shower/CCTV/frigo can be added by another source;
- source confidence/authority remains visible.

### Live occupancy

States:
- AVAILABLE
- LIMITED
- FULL
- CLOSED
- UNKNOWN

Driver live report is accepted only when:
- Driver GPS is enabled;
- saved GPS is fresh (<=5 min);
- driver is <=3 km from the parking.

Driver live reports decay/expire. Multiple distinct drivers are age-weighted; agreement raises confidence.
Fresh official/operator dynamic observation has priority.

### Prediction

When there is no current live observation:
- up to 180 days historical observations are used;
- same weekday and nearby time bucket;
- minimum 5 samples;
- output is explicitly `predicted=true`, source `HISTORY`, with sample count/confidence.

Never display prediction as live truth.

### Vehicle fit

Per-user Parking preferences:
- vehicle class;
- length;
- height;
- gross weight;
- ADR requirement;
- refrigerated/frigo-power need;
- secure-only;
- max detour.

Search returns fit score + concrete issues. Hard size/weight conflicts strongly demote the parking.

### Ranking / Plan B

Search is not nearest-only. It considers:
- vehicle fit;
- current availability;
- distance/route corridor;
- security preference;
- requested amenities;
- reviews;
- source confidence;
- favorite/booking signal.

FULL/CLOSED remains visible but is strongly demoted. Place details return nearby alternatives as `Plan B`.

### Route-ready API

`POST /api/driver/parking/along-route`

Accepts route points + corridor and returns parking ranked near the route. This is intentionally compatible with a later Navigation block. Current route distance is geometric corridor distance, not a false road-network ETA/detour claim.

### Driver contributions

Drivers can:
- add missing parking;
- report live occupancy;
- favorite;
- review with overall/security/cleanliness/access/quietness ratings;
- submit correction;
- upload parking photo.

Trust boundary:
- community-created parking is `COMMUNITY_UNVERIFIED`;
- driver cannot self-assert EU certification;
- driver cannot self-create a trusted operator booking integration;
- community contribution never silently overwrites official certification.

### Parking photos

- JPEG / PNG / WebP;
- max 5 MiB;
- MIME allow-list + file-signature validation;
- runtime `DATA_DIR/parking`, not static public tree;
- authenticated content route;
- private/no-store + nosniff;
- uploader can remove own photo.

### Old-shell functional UI

New Driver module: `Паркинги`.

Working test UI includes:
- nearby/search;
- radius;
- available-only;
- amenity;
- security;
- EU certification filter;
- reservable filter;
- favorites;
- My Vehicle preferences;
- status/confidence/prediction;
- fit warnings;
- amenities/security/certification;
- external booking link when supplied by real source;
- external route link;
- live report;
- structured review;
- photo;
- correction;
- source provenance;
- Plan B;
- add missing place;
- `На карте` opens the place on the existing MapLibre map.

This is a functional old-shell UI. It is NOT the final cross-product Driver redesign.

## External-source truth on 2026-08-19

### Poland KPD / GDDKiA

KPD publishes a Parking DATEX contract/profile (DATEX II 3.7, static parking model and dynamic free-space concept, SOAP/WSDL, certificate-authenticated access), but its current Parking page says there is **currently no Parking data in KPD/NAP**.

Therefore:
- DATEX support is ready;
- empty KPD Parking is not a PaTaP failure;
- do not report Polish KPD live availability until a real import actually receives records;
- no certificate/secret belongs in GitHub.

See `docs/PARKING_NETWORK_V1_SOURCES.md`.

### OSM

OSM is the initial broad-coverage bootstrap source.
Preserve OpenStreetMap attribution/ODbL provenance.
Public Overpass is a controlled bootstrap tool, not a permanent PaTaP production backend.

### EU static distributions

European Data Portal exposes multiple official DATEX II truck-parking distributions. Some files are historically dated; retain source timestamps and never label an old static dataset as live 2026 data.

## New schema risk

Parking schema is additive, `parking_schema_meta version 1`.
Global auth migration must remain **12**.

**Important:** Parking schema is initialized when the real backend first loads the Parking repository. Backup the real SQLite before starting the candidate backend even if no data import will be run yet.

## Mandatory Codex review workflow

### 1. Freeze real source state

From `D:\WWW.PATAP.EU`:

```text
git status --short
```

Confirm the real workspace still corresponds to the current snapshot or explain any local delta before applying candidate files.

### 2. Backup real SQLite BEFORE candidate backend start

```text
npm run auth:backup
```

Confirm backup exists locally. Never commit it.

### 3. Review candidate scope

Compare:

`codex/local-workspace-snapshot @ 53b973221540b80d782426a58ade532eb89ab92e`

against:

`chatgpt/parking-network-v1`

Expected scope only:
- Parking backend/schema/import/adapters/media;
- Parking Driver module;
- minimal Driver route mount;
- dynamic navigation support needed by new module;
- minimal Map controller bridge for Parking focus;
- package/import commands;
- Parking tests/docs/AI task.

Unexpected Caddy/auth-security/Chat/Radio/People rewrites = stop and report.

### 4. Install and run full automated regression

```text
npm ci
npm run test:auth
npm run test:driver-modules
npm run test:radio-live
npm run test:client
npm run test:config
npm run build
npm run verify
npm run test:browser
```

Do not weaken old tests merely to make Parking pass.
If an old test has a legitimate stale expectation because a new `Паркинги` nav item exists, update only the expectation and document exactly why.

### 5. Parking-specific automated expectations

Confirm tests prove at least:
- global auth schema remains 12;
- Parking schema v1 additive;
- OSM adapter parses HGV/capacity:truck and retains ODbL provenance;
- DATEX fixture static + occupancy parses;
- source fusion dedupes OSM + official record;
- official higher-authority capacity/certification applies;
- OSM shower/restaurant is not erased when official record omits it;
- official current occupancy wins over community history;
- 180-day historical prediction is explicitly prediction;
- community place cannot self-assert EU PLATINUM or booking;
- live report from far-away GPS is rejected;
- live report near parking succeeds;
- FULL parking remains visible but usable alternative ranks above it;
- private parking photo MIME spoof is rejected;
- valid authenticated photo serves with no-store/nosniff and can be removed;
- Parking module depends on Map and opens exact place on existing map.

### 6. Import adapters — isolated dry tests before production data

Do NOT start by importing all Europe into the real DB.

Use fixture files / temporary DB first.

Examples:

```text
npm run parking:import -- --format datex-xml --file <fixture.xml> --source-type OFFICIAL_DATEX --source-name "Fixture NAP" --dry-run
npm run parking:import -- --format normalized-json --file <fixture.json> --source-type OPERATOR --source-name "Fixture Operator" --dry-run
```

For OSM network bootstrap check:

```text
npm run parking:import-osm-country -- --country PL --dry-run
```

An upstream network/Overpass failure is a source-availability issue, not a code-test PASS.

### 7. Manual Parking smoke — TEST ACCOUNT ONLY

Use temporary Driver accounts. Do not use a real user's location/review/photo as test data.

Test:
1. Login -> `Паркинги` nav appears.
2. Open Parking with geolocation allowed.
3. Deny browser geolocation -> module remains usable with text/filter search; no crash.
4. Search/radius/amenity/security/EU-cert/booking filters.
5. `Моя машина`: TIR dimensions + ADR + refrigerated + secure-only + max detour.
6. Verify incompatible parking displays fit issue.
7. Create temporary community parking; confirm `unverified`.
8. Attempt payload with fake EU PLATINUM/booking; confirm public result remains NONE/non-reservable.
9. Enable Driver GPS near test parking and report AVAILABLE/LIMITED/FULL.
10. Use a second temporary driver located >3 km -> report rejected.
11. Favorite/unfavorite.
12. Structured review and update review.
13. Correction report.
14. Invalid JPEG MIME spoof rejected.
15. Valid JPEG/PNG/WebP upload, view, delete.
16. Open source list/confidence.
17. FULL parking -> Plan B shown.
18. `На карте` focuses a Parking marker without breaking own GPS/nearby drivers/road reports.
19. External route link opens correct coordinates.
20. If a fixture/operator parking has real booking URL, booking opens externally with noopener/noreferrer behavior.
21. Phone ~390px, tablet, desktop.

Then regress:
- Map GPS + nearby drivers + road reports;
- Chat Console V2;
- Radio Console V2;
- People & Communities V1;
- Profile/auth/logout.

### 8. Apply only after PASS

If ALL required tests pass, apply candidate to real `D:\WWW.PATAP.EU`, build and restart backend using existing runbook.

Then verify:
- backend health HTTP 200;
- `https://patap.eu` opens;
- `https://driver.patap.eu` opens;
- browser console clean enough to pass existing browser suite;
- `Паркинги` loads after real login.

### 9. Controlled initial data bootstrap AFTER code deploy

Take/confirm backup again immediately before first real large data import if meaningful runtime data changed since step 2.

Start with Poland OSM dry-run:

```text
npm run parking:import-osm-country -- --country PL --dry-run
```

If the result is reasonable and public Overpass is available, do the actual PL bootstrap once:

```text
npm run parking:import-osm-country -- --country PL
```

Then inspect:
- `parking_import_runs` latest state COMPLETED;
- recordsSeen / created / updated / errors;
- sample parking cards and source attribution;
- duplicates around known locations.

Do NOT loop continuously against public Overpass.
Do NOT make code deployment fail solely because Overpass is temporarily unavailable.

After PL is confirmed, other countries can be imported serially (for example DE/CZ/SK/AT) under the same backup/dry-run/count inspection policy. For large long-term Europe ingestion use extracts/national feeds/own importer infrastructure rather than public Overpass as a service dependency.

KPD Poland Parking currently has no data; do not treat zero KPD records as a deployment failure.

### 10. Sync source of truth

After accepted deployment, sync the actually tested/applied result into:

`codex/local-workspace-snapshot`

Record in `AI_HANDOFF.md`:
- final applied commit;
- exact test counts;
- browser result;
- backup performed;
- initial Parking import result (or explicitly `not run/upstream unavailable`);
- any local-only credential/source configuration;
- any manual smoke still outstanding.

Do not put database, photos, GPS, credentials, certificates, user reviews or runtime import payloads in GitHub.

## Failure rule

If ANY required code/regression test fails:
- production remains unchanged;
- do not run real Parking import;
- report exact test/stack/error and smallest reproduction back to ChatGPT;
- do not start the next functional block automatically.

## ChatGPT verification truth

ChatGPT wrote/reviewed the candidate through the GitHub connector.
A local checkout attempt from ChatGPT's container failed because `github.com` DNS could not be resolved, so ChatGPT did **not** run Node/npm tests locally.
No PASS/DEPLOYED claim is made here.
