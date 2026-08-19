# CODEX HANDOFF — PEOPLE_COMMUNITIES_V1

Date: 2026-08-19 Europe/Warsaw
Status: **READY_FOR_REVIEW — NOT DEPLOYED BY CHATGPT**

## Source

- Repository: `pavelPataP88/PaTaP.eu`
- Source branch: `chatgpt/people-communities-v1`
- Exact base: `codex/local-workspace-snapshot @ d735d21ae9bd5867460f02b0f4a87e82ed280510`
- Code/tests/research HEAD before this handoff document: `45f25efe7467aa75b98ec39cdfbafc3d44ec186f`
- Research: `docs/PEOPLE_COMMUNITIES_V1_RESEARCH.md`
- At handoff preparation the branch was `ahead 29 / behind 0` against the source-of-truth snapshot.

ChatGPT did **not** run npm/tests locally: its container could not resolve GitHub while attempting to materialize the branch. Do not infer PASS from code review alone. The factual verification must happen in the isolated local workspace.

## Objective

Replace the old basic Contacts block with a driver-oriented People/Communities subsystem that connects the already deployed Map, Chat Console V2 and Radio Console V2 without redesigning the final application shell yet.

Core rule:

`one Community = one authoritative member graph + one linked Chat GROUP + one linked Radio GROUP`

Do not allow those three member sets to drift.

## Scope

Expected changed source/test/docs scope:

- `server/people/**`
- `server/driver/routes.js`
- `server/driver/directory.js`
- `server/driver/location.js`
- `driver/contacts/**`
- `driver/driver-card/index.js`
- `driver/chat/index.js` — only exact linked-room opening integration
- `driver/app.js` — only People / exact Chat-Radio navigation integration
- `driver/module-registry.json`
- `scripts/run-auth-tests.js`
- `tests/auth/people-communities.test.js`
- `tests/driver/people-console.test.mjs`
- `package.json`
- People docs

Do not accept unrelated changes to Caddy, `main`, radio transport/backend source, map rendering code, passwords/auth policy or runtime/private files.

## Implemented behavior

### People directory

- Existing `driver_relationships` remains source of truth for requests/accepted contacts.
- Existing `driver_blocks` remains source of truth for blocks.
- New directional contact preferences:
  - favorite;
  - trusted;
  - private note (maximum 120 chars; private to its author).
- Filters:
  - All;
  - Contacts;
  - Favorites;
  - Trusted;
  - Nearby;
  - Requests;
  - Communities;
  - Blocks.
- Search can filter by nickname and driver type.
- Existing map driver card remains usable and reflects new privacy/contact-request state.

### Privacy

New module-local settings:

- discoverability: `EVERYONE | CONTACTS | HIDDEN`;
- nearby visibility: `EVERYONE | CONTACTS | TRUSTED | NOBODY`;
- contact requests: `EVERYONE | NOBODY`;
- community invites: `CONTACTS | NOBODY`;
- vehicle visibility: `EVERYONE | CONTACTS | NOBODY`.

Defaults preserve existing behavior.

`TRUSTED` is directional: the target Driver explicitly decides which accepted contacts may see them nearby.

People `/nearby` returns rounded distance and allowed metadata only; it does not return latitude/longitude.

The old exact-map `/api/driver/nearby` is now filtered through the same People policy before it can return coordinates. GPS OFF still remains the stronger privacy state and removes location as before.

### Communities

Community fields:

- title/description;
- `PUBLIC | PRIVATE`;
- category `GENERAL | TIR | TAXI | DELIVERY | LOCAL`;
- optional country;
- roles `OWNER | MODERATOR | MEMBER`;
- member favorite.

Creating a Community atomically creates:

1. Community;
2. linked Chat GROUP;
3. linked Radio GROUP;
4. matching owner membership/role in all three.

Community PUBLIC/PRIVATE belongs to People. Linked Chat and Radio spaces are internal infrastructure and are forced PRIVATE by DB policy.

Standalone Chat/Radio discovery excludes Community-linked spaces.

### Community membership synchronization

The following are synchronized across People + Chat + Radio:

- public join;
- invitation acceptance;
- role change;
- owner transfer;
- member removal;
- ban/unban;
- leave.

Remove/ban/leave also releases any active Radio speaker lease and pending `UPLOADING` transmission for that member.

Owner must transfer ownership before leaving.

### Membership drift guard

For a Community-linked Chat/Radio space, standalone membership/admin routes return:

`409 { error: "community_managed", ... }`

This applies to join/leave/invite/member-role/member-remove/ban and linked space metadata/delete operations.

GET/read and normal communication remain available:

- Chat messages, replies, reactions, media, polls, read state, pins/preferences;
- Radio PTT/live, history, playback and communication-local state.

DB triggers also remove duplicate internal Chat/Radio invitations and force linked internal spaces PRIVATE.

### Navigation integration

People Community can open the exact linked:

- Chat room;
- Radio channel.

Chat entry adds narrow `openRoom(roomId)` support and clears only local list search/filter before opening it.

Driver app opens the exact Radio channel after activating the existing Radio module and clearing only its local channel-list filter/search.

No new messaging or radio transport was introduced.

## Schema / migration safety

- `PEOPLE_SCHEMA_VERSION = 1` is module-local.
- Global auth migration must remain **12**.
- Migration is additive: new People tables/indexes/triggers only; no `ALTER` or `DROP` of old working tables.
- Existing contacts, blocks, Chat messages, Radio transmissions, GPS records and profiles are preserved by migration.

**Important:** People schema is initialized when the candidate backend starts. Create a real SQLite backup BEFORE the first backend start with this candidate.

Do not publish that backup.

## Intentional destructive product actions

These are user-confirmed runtime actions, not migration behavior:

- blocking/removing a contact can clear contact-scoped private preferences;
- deleting a Community intentionally deletes its linked Community Chat and Radio history/files;
- banning/removing/leaving intentionally removes synchronized linked membership.

Test destructive actions only with temporary test accounts/communities.

## Required verification on `D:\WWW.PATAP.EU`

### 1. Preflight

- Confirm local working source still corresponds to base snapshot `d735d21ae9bd5867460f02b0f4a87e82ed280510` or explicitly reconcile any newer accepted snapshot before applying candidate.
- Review branch diff and reject unrelated changes.
- Create local SQLite backup before starting backend with People code.

### 2. Automated suite

Run in this order:

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

Expected new coverage is included in normal suites:

- `tests/auth/people-communities.test.js` via `npm run test:auth`;
- `tests/driver/people-console.test.mjs` via `npm run test:driver-modules`.

Do not skip old Chat/Radio/Map regressions because People changes legacy directory/location behavior.

If an existing browser mock fails solely because it lacks the new People endpoint, update the mock only after confirming production behavior is correct. Do not weaken functional/security assertions.

### 3. Mandatory temporary-account smoke

Use at least two temporary Driver accounts, preferably three for outsider privacy checks.

Check:

1. Search + request + accept + cancel/remove contact.
2. Favorite / Trusted / private note.
3. `discoverability=HIDDEN`: outsider cannot search; accepted contact still can.
4. `nearbyVisibility=TRUSTED`: non-trusted contact is absent from old map `/nearby`; after target marks them trusted, map marker becomes available.
5. People Nearby shows distance but not coordinates.
6. GPS OFF still clears/removes the driver's location visibility.
7. Create PRIVATE Community.
8. Invite accepted contact via People and accept invite.
9. Member appears in People + linked Chat + linked Radio.
10. People buttons open exact linked Chat room and Radio channel.
11. Change member to MODERATOR and confirm matching role in linked Chat/Radio.
12. Ban/remove and confirm member loses both linked Chat and Radio access.
13. Unban.
14. Owner transfer and then old owner leave.
15. Create PUBLIC Community; join through People without invite.
16. Standalone Chat/Radio discovery must NOT show Community-linked internal spaces.
17. Standalone linked Chat/Radio join/invite/member-management must return `409 community_managed`.
18. Normal Chat messages/media and Radio PTT must still work inside the linked Community spaces.

### 4. Deployment only after PASS

Only after the full automated suite and smoke are acceptable:

- apply candidate to working source;
- restart the Node backend normally (server/schema code changed);
- run stack health command;
- verify `https://patap.eu` and `https://driver.patap.eu`;
- verify guest mode has no private People/GPS/community data;
- sync only accepted code/tests/docs back to `codex/local-workspace-snapshot`;
- write factual result at top of `AI_HANDOFF.md`.

Never publish SQLite, users, GPS data, messages, radio/chat uploads, tokens, passwords, logs, backups, `data/`, `var/` or `node_modules/`.

## Stop conditions

If any mandatory test fails:

- do not deploy;
- do not start the next feature block;
- restore/remove candidate from working tree as appropriate;
- record the exact failure and root cause in `AI_HANDOFF.md` for ChatGPT.

## Known boundaries / future blocks

Not part of PEOPLE_COMMUNITIES_V1:

- public followers/likes/activity feed;
- reputation scoring;
- Parking/Places reviews/status;
- unified Notifications center;
- Voice assistant;
- Routing/navigation;
- final application-shell redesign.

Those remain separate future large blocks.
