# EVENT_CENTER_V1 — research and product decisions

Date: 2026-08-20 (Europe/Warsaw)
Status: implementation candidate; not deployed by ChatGPT
Base: `codex/local-workspace-snapshot @ 60e939aa8c9d72ecf78d39d6c5c371b8c8cd8d96`

## Problem

PaTaP already has Map, Chat, Radio, People/Communities and Parking. Each can generate information that may require action. A generic bell that mirrors every activity would create noise and, for a driver, would be actively harmful. The block therefore has two separate responsibilities:

1. keep a reliable server-side history of actionable events;
2. decide whether a particular event is allowed to interrupt the driver now.

The inbox is the source of truth. Toasts, SSE and Web Push are delivery channels, not the source of truth.

## Competitor / platform research

### Slack Activity

Useful pattern:
- one activity/inbox surface rather than separate notification lists;
- unread badge and filtering;
- activity is triaged rather than treated as a social feed;
- opening an item leads back to its actual context.

Sources:
- https://slack.com/help/articles/46751260742035-Introducing-the-new-Activity-view-in-Slack/
- https://slack.com/help/articles/360043207674-Manage-notifications-in-Slack

### Microsoft Teams Activity

Useful pattern:
- actor + reason + time + preview/context;
- activity item is a navigation object: it should open the underlying message/thread/activity;
- unread/read state belongs to the activity feed, independently from the source object.

Source:
- https://support.microsoft.com/en-us/office/explore-the-activity-feed-in-microsoft-teams-91c635a1-644a-4c60-9c98-233db3e13a56

### Discord notification controls

Useful pattern:
- mute/override at a source level;
- broad category defaults plus per-source exceptions;
- suppressing notification noise does not require deleting the underlying source/history.

Source:
- https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101

### Zello

Useful pattern:
- ordinary voice history and explicit attention/call alert are distinct concepts;
- urgency should be intentional, not inferred from every piece of voice traffic.

Source:
- https://support.zello.com/hc/en-us/articles/230748407-Call-Alerts

### Waze / driver distraction

Useful pattern:
- alerts in a driving product are constrained by relevance and immediacy;
- the product must minimize the number of interruptions while driving rather than maximize engagement.

Source:
- https://support.google.com/waze/answer/13786535

### Android notification guidance

Useful pattern:
- channel/notification importance must correspond to actual urgency;
- high priority is not a marketing/engagement tool;
- user control over interruption is part of the notification architecture.

Source:
- https://developer.android.com/develop/ui/views/notifications/channels

### Web Push / service workers / VAPID

Verified platform model:
- Push API wakes a service worker even when the page is not currently open;
- permission/subscription is explicitly user-controlled;
- a PushSubscription endpoint is a capability URL and must be protected;
- VAPID authenticates the application server using ES256 / P-256.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- https://www.rfc-editor.org/rfc/rfc8292
- https://www.rfc-editor.org/rfc/rfc8030

## PaTaP product decisions

### 1. Event Center is not a seventh bottom-nav section

The six existing Driver work sections remain the six bottom navigation buttons.

Event Center is global UI:

`bell + unread badge -> drawer`

Desktop/tablet: right-side drawer.
Phone: full-screen drawer.

Reason: notifications are cross-cutting state, not another work domain. Adding a seventh navigation item would also regress the verified 390px six-button navigation.

### 2. Attention budget

Every event is classified into exactly one priority:

- `URGENT` — immediate safety/operational attention is justified;
- `IMPORTANT` — actionable, but normally can wait until safe interaction;
- `NORMAL` — belongs in inbox; usually no interruption required;
- `SILENT` — history/context only.

Examples in V1:
- nearby accident/obstacle within the urgent radius: URGENT;
- direct chat / mention / reply: IMPORTANT;
- contact request / community invite or role change: IMPORTANT;
- direct radio transmission: IMPORTANT;
- favorite Parking meaningful availability state change: IMPORTANT/NORMAL;
- ordinary group chat: NORMAL;
- non-favorite group radio is not projected as noise.

### 3. Driving Mode

When Driving Mode is enabled:
- events still enter the server inbox;
- only `URGENT` can create in-app interruption or Web Push;
- IMPORTANT/NORMAL/SILENT remain available for later review.

This is deliberately an attention policy, not event deletion.

### 4. Quiet hours

Quiet hours use the user's stored timezone and local clock.
Non-URGENT interrupt/push is suppressed during the window.
URGENT remains eligible.

### 5. Category and source controls

Categories:
- CHAT
- PEOPLE
- COMMUNITY
- RADIO
- ROAD
- PARKING
- SYSTEM

Per category:
- inbox enabled;
- push enabled;
- minimum interruption priority.

Per source:
- ALL;
- IMPORTANT (source stays in inbox but NORMAL/SILENT cannot interrupt);
- MUTED (source stays in existing domain data, but Event Center does not interrupt/push it).

### 6. Durable committed-state projection

Event Center does not become a second business-logic implementation.
Existing domains continue to validate and commit their own data.

For persistent domains, SQLite triggers write a durable outbox entry only as part of the successful transaction/statement. A dispatcher projects the committed state into user events.

Sources currently projected:
- committed Chat messages;
- contact relationship state;
- community invite/role/ban;
- committed Radio transmissions;
- Parking occupancy observations.

Road reports are currently memory-backed, so the existing validated Road route makes one explicit post-success call to Event Center.

Benefits:
- rejected actions do not create notifications;
- rollback also rolls back the outbox row;
- existing Chat/Radio/People/Parking route code remains largely untouched;
- a transient notification dispatcher failure does not lose the source event.

Processed outbox rows are retained for seven days for diagnosis, then pruned. Failed rows stop retrying after five attempts and preserve the last error.

### 7. Dedupe / occurrence aggregation

Open unread events may use a dedupe key.
Repeated activity updates the existing event and increments `occurrenceCount` rather than producing unbounded duplicate cards.

Examples:
- several messages from the same room;
- repeated status changes from the same parking source;
- repeated activity around the same community/source.

### 8. Deep links, not dead notifications

An event carries structured `route_json`, not a raw arbitrary URL.
Supported routes include:
- exact Chat room/message context;
- exact Radio channel;
- Driver card;
- People filter;
- exact Community detail + linked Chat/Radio;
- exact Parking detail + existing Map bridge;
- Road report -> Map context.

The browser client interprets known route kinds. It does not execute arbitrary URLs from event data.

### 9. Privacy-preserving Web Push

PaTaP does not send event/message content as Web Push payload.

Flow:

`Event committed -> empty authenticated VAPID POST -> browser push service wakes service worker -> service worker fetches /api/driver/events/overview directly from PaTaP with the authenticated cookie -> browser displays the event`

Therefore FCM / Mozilla / Apple push infrastructure receives a wake signal, not Chat/Parking/Road event text from PaTaP.

If the user disables previews, the service worker omits the event preview from the visible notification body.

Push is optional. The server inbox works without notification permission or Push API support.

### 10. Push endpoint SSRF boundary

A stored PushSubscription endpoint can otherwise become a server-side request target.
V1 only accepts known browser push hosts by default:
- `fcm.googleapis.com`
- `updates.push.services.mozilla.com`
- `web.push.apple.com`

Additional legitimate enterprise/browser hosts require explicit local `PATAP_WEB_PUSH_HOSTS` configuration.
No private VAPID key or endpoint allow-list secret is committed to GitHub.

### 11. VAPID keys

Keys are generated locally into:

`DATA_DIR/events/vapid.json`

The file is runtime/private data and must never be committed.
The public P-256 key is exposed to the authenticated Driver client through `/api/driver/events/push-config`.

## V1 scope

Implemented V1 includes:
- durable inbox;
- priorities;
- unread counts/badge;
- category filtering;
- read/unread;
- mark-all-read;
- archive;
- snooze;
- category preferences;
- source mute/important-only override;
- Driving Mode;
- quiet hours;
- in-app SSE realtime and toasts;
- deep links;
- optional background Web Push wakeup;
- server-side event retention;
- outbox retry/retention.

Not claimed in V1:
- native Android/iOS push SDK;
- guaranteed cross-browser Web Push until real-device manual smoke is completed;
- automated inference that the vehicle is moving (Driving Mode is currently a user setting; Navigation may later provide stronger driving context);
- AI summarization of events;
- engagement/recommendation notifications;
- marketing notifications.

## Product rule

Event Center exists to reduce missed operational information **and** reduce unnecessary interruption.
It must never optimize for notification volume or engagement.
