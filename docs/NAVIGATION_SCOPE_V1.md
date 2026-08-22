# NAVIGATION_SCOPE_V1

Date: 2026-08-22 (Europe/Warsaw)

## Decision

For Driver V1, PaTaP does not implement or operate its own turn-by-turn routing engine.

This is an explicit owner product decision, not a technical failure and not a temporary provider outage.

The product priority for V1 is to connect drivers and provide the shared Driver network: Map/GPS, People, Chat, Radio, Parking, Road Reports and Events. Route calculation remains the responsibility of a navigation application chosen by the user.

## Audit effect

The previous audit items are closed/superseded for V1:

- `AUD-025 NAV_PROVIDER_LOCAL_V1` — no longer required for V1.
- `AUD-026 NAVIGATION_REBASE_V1` — no longer required for V1.

They must not remain V1 release blockers.

`NAV_ROUTER_URL` is not a required production setting for V1. Valhalla is not required to be installed, downloaded, built, hosted or maintained for V1.

## Historical internal Navigation work

Historical Navigation work, including `chatgpt/navigation-engine-v1`, remains preserved for possible future use.

Rules:

- do not delete it;
- do not deploy it;
- do not rebase/merge it onto current production merely to close the old audit;
- do not present its old automated tests as proof of a current production navigation feature;
- do not fall back from truck routing to ordinary passenger-car routing.

The production Driver may truthfully state that PaTaP does not currently calculate the user's route itself.

## External-navigation direction

A future small functional block may add an external-navigation handoff.

Expected behavior:

1. The user chooses a preferred navigation application.
2. PaTaP stores that preference locally/on the appropriate user settings boundary.
3. When the user selects a destination such as a parking place, PaTaP passes only the destination needed to launch the selected navigation application.
4. The external application calculates and presents the route.
5. PaTaP does not claim that the external application's route is truck-safe or guaranteed by PaTaP.

Free/no-backend launch mechanisms suitable for that later block include:

- Google Maps URLs: `https://www.google.com/maps/dir/?api=1&destination=...&dir_action=navigate`;
- Waze deep links: `https://waze.com/ul?ll=...&navigate=yes`;
- Android/device map handlers via the standard `geo:` intent URI where applicable.

References checked 2026-08-22:

- Google Maps URLs: https://developers.google.com/maps/documentation/urls/get-started
- Waze / Google Maps standalone launch guidance: https://developers.google.com/maps/documentation/navigation/connect/launch-navigation-app
- Android common map intents: https://developer.android.com/guide/components/intents-common

Standard Maps URLs/Waze deep links are sufficient for simple handoff and do not require PaTaP to run a route engine. Do not add Navigation Connect telemetry, paid Navigation SDKs or another commercial routing service without a separate owner decision.

## Future reopening conditions

Internal or commercial routing may be reconsidered only if there is a clear product reason, for example sufficient adoption/revenue or a demonstrated need that external navigation cannot satisfy.

A reopened routing project must be a new, separately reviewed block with explicit answers for:

- data/provider quality;
- truck restrictions and vehicle profiles;
- update frequency;
- live traffic/incident data;
- operating cost;
- failure/degraded behavior;
- legal/provider terms;
- real-device and real-route validation.

No previous Navigation branch automatically becomes approved because routing is reopened.

## Current V1 truth

- PaTaP map/GPS features are separate from turn-by-turn route calculation.
- PaTaP does not currently offer an internally calculated truck route.
- Driver V1 is not blocked by absence of Valhalla or `NAV_ROUTER_URL`.
- External-navigation handoff is the intended lightweight V1 direction.
- Existing internal Navigation work is deferred, preserved and optional for the future.
