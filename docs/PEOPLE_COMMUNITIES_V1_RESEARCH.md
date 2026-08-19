# PEOPLE_COMMUNITIES_V1 — research and product model

Date: 2026-08-19 Europe/Warsaw
Status: research applied to implementation candidate `chatgpt/people-communities-v1`.

## Problem

PaTaP already has three strong functional surfaces: Map, Chat Console V2 and Radio Console V2. The old Contacts module only knew pending/accepted relationships and blocks. That is not enough to make the three systems work as one driver network.

The next block must answer:

- who is this driver and what relationship do I have with them;
- who can find me and who can see me nearby;
- which contacts are especially important/trusted to me;
- how drivers organize into persistent groups without manually maintaining separate Chat and Radio member lists;
- how one action can move safely between People, Map, Chat and Radio.

## Competitor / adjacent-service research

Only product principles were studied. No competitor code, assets, icons, CSS or exact trade dress are copied.

### Waze

Official Waze community material presents the product as drivers helping other drivers and emphasizes local/community contribution. Its map/reporting model is useful because the value comes from current local information rather than a generic social feed.

Useful principle for PaTaP:

- community activity should improve the road experience;
- freshness and locality matter more than follower counts;
- the product should not become an engagement feed unrelated to driving.

Official source reviewed: Waze Communities — `waze.com/communities` and current Waze community/product material.

### Trucker Path

Official Trucker Path material combines navigation/road intelligence with a large driver community, driver groups, reviews/contributions and in-app driver messaging. Its Pathfinder program explicitly rewards useful, authentic contributions rather than arbitrary activity.

Useful principle for PaTaP:

- driver groups should have a concrete operating purpose;
- permissions matter;
- community identity should connect to real driver utilities;
- contribution/reputation can be added later, but should be based on useful verified activity, not popularity.

Official sources reviewed: Trucker Path product pages, NavPro driver groups, Pathfinder Program, driver messaging help material.

### Truckfly by Michelin

Official Truckfly material combines truck-friendly places, community alerts, ratings/reviews and driver contribution. Its positioning treats other drivers' current experience as a practical source of trust.

Useful principle for PaTaP:

- community should eventually connect people to Parking/Places and road intelligence;
- trust should be contextual and useful;
- participation can later support Parking/Places freshness without exposing more personal data than needed.

Official sources reviewed: Truckfly by Michelin product/community pages.

## PaTaP decision

PaTaP People is **not** a generic social network.

There are no public follower counts, public likes, popularity leaderboard or infinite social feed in V1.

The model is:

`Driver identity -> relationship -> private trust/preferences -> nearby visibility -> communities -> Map / Chat / Radio`

## People model

### Relationship remains authoritative

Existing `driver_relationships` and `driver_blocks` stay authoritative for:

- pending contact request;
- accepted contact;
- block.

No duplicate friendship table was introduced.

### Personal contact layer

A user can privately mark an accepted contact as:

- Favorite;
- Trusted;
- private note (maximum 120 chars, visible only to the user who wrote it).

These are directional. If Alpha trusts Bravo, this does not automatically mean Bravo trusts Alpha.

### Privacy

Each Driver can control:

**Discoverability**
- Everyone;
- Contacts;
- Hidden.

**Nearby / exact map visibility**
- Everyone;
- Contacts;
- Trusted;
- Nobody.

`Trusted` is deliberately directional: the target driver decides who they trust with their nearby visibility.

**Contact requests**
- Everyone;
- Nobody.

**Community invites**
- Contacts;
- Nobody.

**Vehicle visibility**
- Everyone;
- Contacts;
- Nobody.

Defaults preserve the old Driver behavior: discoverable and nearby-visible to everyone unless the user changes privacy.

Turning GPS off remains stronger than every People setting: no coordinate is stored/sent while GPS is disabled.

### Nearby People versus Map

The People `Nearby` response contains only allowed driver metadata plus rounded distance. It does **not** expose latitude/longitude.

The existing Map `/api/driver/nearby` may return exact coordinates only after the same People visibility policy passes. This keeps Map functional while making People privacy real rather than cosmetic.

## Communities

### One community, one member graph

A Community is not a third messaging product.

Creating one Community atomically creates:

1. People Community record;
2. one linked Chat GROUP;
3. one linked Radio GROUP.

The user sees one logical community. Chat and Radio are communication transports belonging to it.

### Community roles

V1 roles:

- OWNER;
- MODERATOR;
- MEMBER.

The role is synchronized into compatible Chat and Radio roles.

Owner transfer changes all three systems in one transaction.

### Public / private

Community itself can be PUBLIC or PRIVATE.

- PUBLIC Community: discover/join through People.
- PRIVATE Community: contact-only invitation.

Its internal Chat/Radio spaces are forced to private infrastructure. They are hidden from standalone Chat/Radio discovery so the user cannot accidentally join only one third of a Community.

### Invitations

A Community invitation is represented once in People.

V1 invitation requires:

- inviter has OWNER or MODERATOR role;
- target is an accepted Driver contact;
- neither side blocks the other;
- target allows community invites;
- target is not already member/banned.

DB policy removes duplicate internal Chat/Radio invitations for Community-linked spaces.

### Membership synchronization

The following are synchronized across People + Chat + Radio in one transaction:

- join;
- accepted invite;
- role change;
- owner transfer;
- remove;
- ban/unban;
- leave.

Removing/leaving also releases an active Radio speaker lease and pending UPLOADING transmission for that member.

### Guard against drift

Standalone Chat/Radio membership management for Community-linked spaces is server-blocked with `community_managed`.

Allowed in linked Chat/Radio:

- messages;
- reactions/replies/media/polls;
- read state/preferences;
- PTT/live audio/history;
- pins and other communication-local state.

Managed only in People:

- join/leave;
- invite;
- roles;
- member removal;
- bans;
- Community metadata;
- deletion.

## People Console V1

The old Contacts view becomes `Люди` while keeping the existing `contacts` view id for compatibility.

Filters:

- All;
- Contacts;
- Favorites;
- Trusted;
- Nearby;
- Requests;
- Communities;
- Blocks.

Driver cards can expose, subject to policy:

- nickname;
- driver type;
- country;
- vehicle;
- GPS/visibility state;
- nearby distance;
- relationship;
- favorite/trusted status;
- user's private note.

Actions connect existing product blocks:

- Map/card;
- Direct Chat;
- Direct Radio for accepted contacts;
- contact request/accept/cancel/remove;
- favorite/trusted/note;
- block/unblock.

Community cards connect directly to the exact linked Chat room and Radio channel.

## Explicit non-goals for V1

Not implemented in this block:

- public social followers;
- public likes / popularity ranking;
- public activity feed;
- exact GPS in People Nearby response;
- automatic contact creation from shared Community membership;
- reputation score;
- parking/place reviews (belongs to Parking/Places block);
- push notification center (belongs to Notifications block);
- E2EE changes (separate security architecture).

## Future hooks

This model intentionally prepares later large blocks:

- Parking / Places: community/trusted-driver freshness and reviews;
- Notifications: one notification source for relationship/community events;
- Voice assistant: “открой сообщество”, “вызови водителя”, “кто из доверенных рядом”;
- Routing: community/place intelligence along a route;
- final UI shell: `Map | Radio | Chat | People` becomes a real interconnected app rather than four unrelated tabs.
