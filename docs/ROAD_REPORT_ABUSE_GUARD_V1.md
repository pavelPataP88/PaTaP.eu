# ROAD_REPORT_ABUSE_GUARD_V1

## Goal

Close `AUD-030` without creating a public reputation score for drivers and without adding location-history diagnostics.

Road Reports remain GPS-first, structured, short-lived road events. The guard protects creation from repeated abuse while preserving normal peer confirmation and self-closing behavior.

## Report-level trust

Trust belongs to a road report, not to a person.

Public Road Report payloads keep the existing `confirmations.active` / `confirmations.gone` counters and add:

```json
{
  "trust": {
    "state": "UNCONFIRMED | SUPPORTED | CONFIRMED | DISPUTED",
    "independentActive": 0,
    "independentGone": 0
  }
}
```

The author never counts as an independent confirmation.

- `UNCONFIRMED`: no independent ACTIVE peer;
- `SUPPORTED`: one independent ACTIVE peer;
- `CONFIRMED`: at least two independent ACTIVE peers;
- `DISPUTED`: a closed report has at least two independent GONE peers.

Two independent ACTIVE peers also mark the report as historically supported. If a report later clears normally, that later GONE consensus does not create an abuse signal against its author.

## Abuse signal

A single disagreement never restricts a driver.

One abuse point is recorded only when all of these are true:

1. at least two independent peers mark the report `GONE`;
2. this closes the report within 10 minutes of creation;
3. the report had never reached two independent ACTIVE confirmations;
4. this report has never been counted before;
5. the author account still exists.

This is a deliberately conservative signal. It means "repeated early independent rejection", not a declaration that a person lied.

No new table stores report coordinates, routes, GPS samples or a report-by-report moderation history.

## Temporary creation restriction

The user-level guard stores only:

- user id;
- numeric abuse score;
- restriction expiry, if active;
- last abuse timestamp;
- update timestamp.

Policy:

- score decays by one point for each 7-day period without a new abuse signal;
- score 3-4: creation restricted for 6 hours;
- score 5+: creation restricted for 24 hours;
- score is capped at 10;
- an existing longer restriction is never shortened by a later signal.

Restriction affects only `POST /api/driver/road-reports`.

The restricted user can still:

- read Road Reports;
- confirm ACTIVE/GONE while satisfying the existing fresh-nearby-GPS rule;
- close their own existing report;
- use all other Driver modules.

Restricted creation returns HTTP 429:

```json
{
  "error": "road_report_temporarily_restricted",
  "retryAfterSeconds": 1234
}
```

and a matching `Retry-After` header.

## Admin diagnostics

`GET /api/driver/admin/road-reports`

Access: `Owner` or `Administrator` only.

The response contains:

- current policy constants;
- number of active reports;
- active report trust-state counts;
- number of flagged/restricted users;
- up to 25 current guard rows with user id, effective score, restriction expiry and last abuse timestamp;
- explicit `locationHistoryStored: false`;
- explicit `publicUserRating: false`.

It does not return report IDs, coordinates, GPS history, routes, report text/media or public people ratings.

Non-admin users receive 403. Non-GET methods receive 405.

## Existing safety boundaries preserved

Unchanged:

- Road Report types and TTLs;
- no free text or media;
- create requires Driver profile + enabled fresh GPS;
- create location remains within 2 km of fresh GPS;
- peer confirmation remains within 2 km and requires fresh GPS;
- author can close own report;
- guest list remains read-only and does not expose author identity;
- seven-day closed/expired report retention;
- auth schema version remains 12;
- no Navigation changes;
- no `main` changes;
- no public driver rating.

Road Report module schema moves from version 1 to version 2 additively. Existing rows and votes are preserved; two nullable report lifecycle markers and the user guard table are added.

## Field verification after deployment

With test accounts near the same real location:

1. create a Road Report and confirm ACTIVE from two different peer accounts; it should become `CONFIRMED`;
2. close/clear it with peers and verify normal behavior is retained;
3. do **not** manufacture abuse strikes against production users merely to test restriction;
4. admin diagnostics may be checked read-only with an Owner/Administrator account;
5. confirm diagnostics contain no coordinates/location history.

Synthetic restriction behavior is covered by isolated automated tests and should not be forced against real user accounts in production.
