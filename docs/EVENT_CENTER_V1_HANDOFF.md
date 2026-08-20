# EVENT_CENTER_V1 — CODEX HANDOFF

Date: 2026-08-20 Europe/Warsaw
Status: **READY_FOR_CODEX_REVIEW — NOT DEPLOYED BY CHATGPT**

## Candidate

- repository: `pavelPataP88/PaTaP.eu`
- authoritative base: `codex/local-workspace-snapshot`
- exact base SHA: `60e939aa8c9d72ecf78d39d6c5c371b8c8cd8d96`
- candidate branch: `chatgpt/event-center-v1`
- code/tests/research HEAD before handoff docs: `2455b5e95cdef7c5700e7d586780c7ad19998ab7`

Do not use an older ChatGPT branch as base.
Do not modify `main`.
Do not start Navigation/Voice or another large block during this review.

## Read first

1. `AI_TASK.md`
2. `docs/EVENT_CENTER_V1_RESEARCH.md`
3. this handoff
4. current real-workspace `AI_HANDOFF.md`
5. current real-workspace engineering state/runbook

## Product implemented

### Global Event Center

The six existing Driver bottom-nav views remain exactly six.
Event Center has **no `view` in module-registry** and therefore does not create a seventh mobile nav button.

UI:
- global bell in top bar;
- unread badge + urgent state;
- desktop/tablet side drawer;
- full-screen drawer on phone;
- category filters;
- unread-only / urgent-only;
- mark all read;
- read/unread;
- archive;
- snooze;
- source mute;
- global/category settings;
- Driving Mode toggle;
- optional Web Push toggle;
- in-app realtime toast when policy permits.

### Priority / attention model

Priorities:
- URGENT
- IMPORTANT
- NORMAL
- SILENT

Driving Mode:
- all events remain in inbox;
- only URGENT may interrupt/push.

Quiet hours:
- use stored timezone;
- non-URGENT interruption/push suppressed.

Category thresholds and source override are independent from event storage.
`IMPORTANT` source mode means NORMAL/SILENT stay in inbox but cannot interrupt/push.
`MUTED` suppresses Event Center interruption/push for that source; the actual domain data remains intact.

### Durable server architecture

Additive Event schema v1, global auth migration remains 12.

Tables:
- `driver_event_schema_meta`
- `driver_event_preferences`
- `driver_event_category_preferences`
- `driver_event_source_overrides`
- `driver_events`
- `driver_event_outbox`
- `driver_push_subscriptions`

Persistent domains write only their own normal domain state. SQLite triggers add small committed-state references to `driver_event_outbox`.
Dispatcher projects those references into per-user Event Center records.

Projected persistent sources:
- Chat committed message;
- contact relationship insert/status change;
- Community invite;
- Community role change;
- Community ban;
- Radio transmission only after COMMITTED;
- Parking occupancy observation.

Road reports are currently memory-backed, so the validated Road POST route performs one explicit Event Center call **after** successful report creation.

Outbox:
- retries failed rows up to 5 attempts;
- retains last error;
- processed rows kept 7 days then pruned no more than hourly.

### Chat policy

- direct message: IMPORTANT;
- explicit mention: IMPORTANT;
- reply to user: IMPORTANT;
- ordinary group/general message: NORMAL;
- existing Chat room mute / notificationLevel is respected;
- blocks are respected;
- room activity dedupes into one unread Event Center item with occurrence count.

### People / Community

V1 creates actionable events for:
- incoming contact request;
- contact accepted;
- community invite;
- community role change;
- community ban.

No generic social-follow/engagement events are added.

### Radio

- direct committed transmission: IMPORTANT;
- non-direct group transmission projects only for a favorite non-muted channel;
- uncommitted/uploading PTT never becomes an Event Center notification.

### Road

Using fresh stored Driver GPS:
- recipients within 5 km can receive ROAD events;
- ACCIDENT or OBSTACLE <=3 km -> URGENT;
- other relevant nearby road event -> IMPORTANT;
- event expires with the Road report;
- no raw GPS history is introduced.

### Parking

Only users who favorited the parking receive Parking availability-change events.
A new occupancy observation is compared with the previous status.
No event when status did not actually change.

### Event lifecycle

Server supports:
- list/filter/page;
- counts;
- exact event read;
- mark read/unread;
- mark all read;
- archive;
- snooze 15m/1h/3h/8h/1d server contract;
- 30-day event retention;
- dedupe/occurrence aggregation.

### Deep links

Structured route objects, not arbitrary URLs.
Client routes to:
- exact Chat room;
- exact Radio channel;
- Driver card;
- People filter;
- Community details + linked Chat/Radio;
- exact Parking card + existing Map bridge;
- Road -> Map context.

### Realtime

`GET /api/driver/events/stream`

Authenticated SSE:
- `event.ready`
- `event.committed`
- `event.counts`

SSE is in-app realtime only. Durable inbox remains authoritative after reconnect/reload.

## Web Push design

### Explicit opt-in

Browser permission is requested **only after the user clicks Push**.
No permission prompt on login/load.

### Wake-only privacy design

PaTaP sends an empty authenticated VAPID POST to the browser push service.
It does **not** send Chat/Parking/Road text as the Web Push payload.

Service Worker wakes and performs authenticated same-origin:

`GET /api/driver/events/overview`

Then the worker displays the actual event.

If previews are disabled, notification body does not contain the event preview.

### VAPID

Local runtime key file:

`DATA_DIR/events/vapid.json`

- P-256;
- ES256 JWT;
- 12-hour token expiry;
- file mode requested 0600;
- never publish this file/private JWK.

### Push SSRF protection

Default accepted PushSubscription hosts:
- `fcm.googleapis.com`
- `updates.push.services.mozilla.com`
- `web.push.apple.com`

Optional extra legitimate hosts must be explicitly configured locally via:

`PATAP_WEB_PUSH_HOSTS`

Do not broaden the default to arbitrary HTTPS endpoints.
Do not add private network hosts.

## Important schema/startup consequence

Event schema and outbox triggers are initialized when the candidate Driver router starts.
Therefore **backup the real SQLite before the first candidate backend start**, even before any manual Event Center action.

VAPID runtime data may be created later when Push config is first requested. It stays local/private.

## Mandatory Codex workflow

### 1. Confirm real workspace state

From `D:\WWW.PATAP.EU`:

```text
git status --short
```

Confirm production corresponds to base `60e939aa8c9d72ecf78d39d6c5c371b8c8cd8d96`, or reconcile/report any newer local delta before applying candidate code.

### 2. Backup real SQLite BEFORE candidate backend start

```text
npm run auth:backup
```

Verify local backup exists. Never commit it.

### 3. Review candidate scope

Compare base against `chatgpt/event-center-v1`.

Expected changed scope:
- `server/events/*` new Event Center backend;
- small Event integration in `server/driver/routes.js`;
- `driver/events/*`;
- `driver/event-worker.js`;
- one global no-view registry entry;
- build/test runner/package test list;
- Event Center tests/docs/AI handoff/task.

Unexpected changes to Caddy, auth password policy, Chat/Radio/People/Parking business logic, bottom-nav CSS, main, runtime DB/media = stop and report.

### 4. Full automated regression

```text
npm ci
npm run test:auth
npm run test:radio-live
npm run test:driver-modules
npm run test:client
npm run test:config
npm run build
npm run verify
npm run test:browser
```

Do not weaken old tests merely to make Event Center pass.

### 5. Event-specific automated expectations

Confirm the suites prove at least:
- auth migration remains 12;
- Event schema v1 additive;
- Event Center has no `view`, exactly six enabled Driver nav views remain;
- contact request -> recipient IMPORTANT event;
- contact accept -> requester event;
- direct Chat committed message -> IMPORTANT event + exact room route;
- Road accident near fresh second Driver -> URGENT event;
- snooze/read/archive behavior;
- SSE ready frame;
- category/global preferences;
- arbitrary HTTPS push endpoint rejected;
- allowed push subscription persistence/revoke;
- VAPID JWT cryptographically verifies ES256/P-256;
- Push request contains VAPID/TTL but **no event body payload**;
- Service Worker fetches event content from same-origin authenticated PaTaP instead of `pushEvent.data`;
- build contains `event-worker.js`;
- existing 390px six-button nav/overflow checks remain strict and PASS.

### 6. Manual two-account Event Center smoke

Use disposable Driver accounts only.

Account A / Account B:
1. A sends B contact request -> B bell count increases and REQUESTS deep-link works.
2. B accepts -> A gets accepted event.
3. Create direct Chat and send text -> recipient gets IMPORTANT Event; open exact Chat room.
4. Send several messages same room -> occurrence aggregation, not unbounded duplicate cards.
5. Mute Chat source in Event Center -> source remains usable in Chat; Event Center no longer interrupts it.
6. Set category CHAT minimum IMPORTANT -> ordinary group NORMAL remains inbox but does not interrupt.
7. Enable Driving Mode -> direct IMPORTANT remains inbox but does not toast/push; nearby URGENT Road still eligible.
8. Quiet hours covering current time -> same non-URGENT suppression.
9. Snooze -> item disappears from default list then can be found with server includeSnoozed contract.
10. Mark read/unread and archive.
11. Open Community event and linked Chat/Radio.
12. Favorite a temporary Parking place, change accepted live status from another allowed nearby test account -> favorite owner gets Parking event and exact parking detail/map bridge.
13. Road report from test GPS near second test GPS -> URGENT event; Map opens.

### 7. Real-device Web Push smoke — REQUIRED BEFORE CLAIMING PUSH VERIFIED

Automated tests verify our VAPID/signing/privacy contract, but real browser push service behavior must be checked on actual devices.

On `https://driver.patap.eu` with a disposable account:
1. Click Push explicitly.
2. Browser permission prompt appears only then.
3. Grant permission; Push button shows enabled.
4. Confirm server overview reports an active subscription.
5. Close/background the Driver tab/app.
6. From second test account create an eligible IMPORTANT event while Driving Mode/quiet hours are off.
7. Confirm system notification arrives.
8. Confirm its body is appropriate to `showPreviews` setting.
9. Tap notification -> existing/new Driver window opens and the exact event route is handled.
10. Disable previews; repeat and ensure sensitive preview text is not displayed.
11. Enable Driving Mode; an IMPORTANT event must **not** produce push, while it still appears in inbox after opening Driver.
12. Create an eligible URGENT Road event; confirm push remains eligible in Driving Mode.
13. Disable Push in UI; subscription is revoked and future push stops.

Recommended smoke browsers:
- Android Chrome (expected FCM endpoint);
- if available, Firefox Android/Desktop;
- iOS/iPadOS installed web app only if the current platform/browser exposes Push API for this site.

If the browser produces a legitimate push host outside the default allow-list, **do not broaden code globally**. Record hostname and configure `PATAP_WEB_PUSH_HOSTS` locally after review.

If real Push fails but the durable inbox/SSE/tests pass, report Event Center core separately from Web Push. Do not claim Web Push verified.

### 8. Regression of existing blocks

Explicitly exercise:
- Map own GPS, nearby drivers, road report;
- Parking search/favorite/card/map;
- Chat direct/group;
- Radio direct/group/PTT;
- People contacts/community;
- Profile/auth/logout.

Bell/drawer must not cover or resize the 390px bottom nav.

### 9. Apply only after code PASS

Only after required automated suites pass:
- apply candidate to real `D:\WWW.PATAP.EU`;
- build;
- restart backend using existing runbook only;
- verify local `/api/health` HTTP 200;
- verify `https://patap.eu`, `https://driver.patap.eu`, and their health endpoints;
- perform Event Center manual smoke;
- perform Web Push smoke before claiming Web Push verified.

### 10. Runtime/private data rules

Never commit:
- SQLite/backup/WAL/SHM;
- `data/events/vapid.json` or any private JWK;
- PushSubscription endpoints/keys;
- users/messages/GPS/events;
- Chat/Radio/Parking media;
- logs;
- test-account credentials.

### 11. Sync authoritative snapshot

After accepted deployment, sync the exact actually tested/applied state into:

`codex/local-workspace-snapshot`

Update real `AI_HANDOFF.md` with:
- final applied source commit;
- exact test counts;
- browser PASS/FAIL;
- backup confirmation;
- Event core manual smoke results;
- Web Push device/browser + result separately;
- any local `PATAP_WEB_PUSH_HOSTS` setting (hostnames only; no subscription secrets);
- any still-outstanding manual checks.

Do not start the next block automatically.

## Failure rule

If any required automated regression fails:
- leave production unchanged;
- do not weaken tests;
- return exact failing test, output and smallest reproduction to ChatGPT.

If only external Web Push delivery fails after code suites/core manual smoke pass:
- keep the result separated as `Event Center core PASS / Web Push manual FAIL or unverified`;
- provide browser/device, permission state, endpoint hostname (not full endpoint), HTTP response if visible, and service-worker console error;
- do not publish the full PushSubscription endpoint or keys.

## ChatGPT verification truth

ChatGPT wrote and statically reviewed the candidate through the GitHub connector.
A local checkout attempt failed before tests because the ChatGPT container could not resolve `github.com` (`Could not resolve host: github.com`).
Therefore ChatGPT has **not run npm/Node/browser tests** and makes no PASS/deployed claim.

