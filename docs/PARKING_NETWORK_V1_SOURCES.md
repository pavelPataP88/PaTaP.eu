# PARKING_NETWORK_V1 — source operations

Date checked: 2026-08-19 Europe/Warsaw

This file separates **code readiness** from **current upstream data availability**.

## Source priority

1. operator / official dynamic data when actually available;
2. official static DATEX/NAP data;
3. OSM broad coverage;
4. PaTaP driver additions and live observations;
5. historical prediction only when live data is absent.

Never report a configured source as populated unless an import run actually received records.

## Poland — GDDKiA KPD

Official pages checked:
- https://kpd.gddkia.gov.pl/index.php/pl/metadane-datex/
- https://kpd.gddkia.gov.pl/index.php/pl/specyfikacja-techniczna/
- https://kpd.gddkia.gov.pl/index.php/pl/profil-datex/

Published parking contract:
- dataset ID: `parking`;
- static parking information: location, capacity, equipment;
- dynamic availability: current free-space count;
- XML / DATEX II;
- Parking profile: DATEX II 3.7 in the technical specification;
- SOAP / WSDL;
- registration + client certificate authentication;
- car + truck, national-road coverage.

**Current upstream state on 2026-08-19:** the KPD profile/metadata pages mark Parking with `Currently no data in NAP` / `Na chwilę obecną brak danych w KPD`.

Therefore:
- the PaTaP DATEX adapter is intentionally ready now;
- deployment must not fail because KPD returns no parking records;
- do not claim Poland live KPD parking until an actual import run sees data;
- when KPD begins publishing records, obtain credentials/certificate outside GitHub and feed downloaded/static+dynamic XML into the importer or add a credentialed KPD connector process.

No certificate, password, private endpoint credential or runtime XML belongs in GitHub.

## OpenStreetMap bootstrap

PaTaP supports Overpass JSON through:

```text
npm run parking:import -- --format osm-json --file parking-osm.json --source-type OSM --source-name OpenStreetMap
```

Recommended query scope for bootstrap is country/region batches, not one enormous Europe-wide public Overpass request.

Typical relevant objects:
- `amenity=parking` with `hgv=yes/designated` or `capacity:truck`;
- `highway=services`;
- `highway=rest_area`;
- HGV access/capacity/security/service tags.

OSM attribution / ODbL must be retained. The adapter stores OSM external IDs and `OpenStreetMap contributors · ODbL` provenance.

For large production imports prefer OSM extracts / own processing pipeline rather than treating a public Overpass instance as PaTaP infrastructure.

## Generic DATEX import

Downloaded XML:

```text
npm run parking:import -- --format datex-xml --file parking.xml --source-type OFFICIAL_DATEX --source-name "National Access Point" --country DE
```

Dry-run parsing without database mutation:

```text
npm run parking:import -- --format datex-xml --file parking.xml --source-type OFFICIAL_DATEX --source-name "National Access Point" --dry-run
```

The V1 parser handles common namespace-tolerant parking/static/status fields. DATEX profiles vary by country/version; adding a national adapter must still output the same normalized PaTaP contract.

## Normalized provider contract

Any future operator, national adapter, commercial provider or admin feed can generate:

```json
{
  "places": [
    {
      "place": {
        "name": "Example Secure Parking",
        "latitude": 50.0,
        "longitude": 19.0,
        "countryCode": "PL",
        "capacityTruck": 100,
        "cctv": true,
        "guard": true,
        "reservable": true,
        "bookingProvider": "Operator",
        "bookingUrl": "https://operator.example/booking"
      },
      "source": {
        "type": "OPERATOR",
        "externalId": "operator-123",
        "authority": 90,
        "name": "Operator"
      }
    }
  ],
  "occupancy": []
}
```

Then:

```text
npm run parking:import -- --format normalized-json --file provider.json --source-type OPERATOR --source-name Operator
```

## Import safety

- Backup real SQLite before the first production Parking schema activation/import.
- Test import against an isolated DB first.
- Import process is separate from HTTP server requests.
- Use batches; importer default is 500 records per transaction.
- Re-import is idempotent by `(source_type, external_id)`.
- Geographic/name merge is conservative; sources remain separately auditable.
- Inspect `parking_import_runs` after every production import.
- A failed source must not erase an existing canonical parking.

## Booking

Parking records may expose operator booking URL/phone/instructions.

This is **not** a PaTaP reservation guarantee or payment transaction. Native booking is a later integration requiring an operator/provider contract and confirmed API semantics.
