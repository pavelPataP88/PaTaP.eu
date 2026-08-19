# Driver PaTaP — Chat Console V2 research

Date: 2026-08-19 Europe/Warsaw

## Goal

Turn Driver PaTaP Chat from a basic room/message view into a first-class messenger while keeping the existing GENERAL / COUNTRY / DIRECT history, Driver identity, contact/block rules and realtime WebSocket transport.

The design is original PaTaP UI. It does not copy WhatsApp or Telegram source code, assets or exact trade dress.

## Official product references reviewed

### WhatsApp / Meta

- WhatsApp group chat upgrades (2026): improved polls, `@all`, creating side chats from an existing group.
  - https://about.fb.com/news/2026/08/were-upgrading-your-whatsapp-group-chats/
- WhatsApp message editing: edit sent messages for up to 15 minutes, with an edited marker.
  - https://about.fb.com/news/2023/05/edit-whatsapp-messages/
- WhatsApp chat filters: All / Unread / Groups as a fast inbox-navigation pattern.
  - https://about.fb.com/news/2024/04/whatsapp-chat-filters/
- WhatsApp polls and forwarding with captions.
  - https://about.fb.com/news/2023/05/whatsapp-polls-updates-sharing-with-captions/
- WhatsApp Communities: group administration, reactions, file sharing and structured communities.
  - https://about.fb.com/news/2022/04/our-vision-for-communities-on-whatsapp/

### Telegram

- Telegram FAQ — groups: unified history, editing/deleting, instant search, replies, mentions, smart notifications, pinned messages, granular admins/permissions, files, topics and public groups.
  - https://telegram.org/faq
- Telegram FAQ — multi-device/cloud sync and large-group communication model.
  - https://telegram.org/faq?setln=en

## Product principles taken from the research

1. **Inbox first.** A messenger needs a fast conversation list with filters, unread/mention indicators, drafts and pinned/favorite rooms.
2. **Conversation context must survive scale.** Replies, forwards, mentions, search, pins and message history are core rather than optional decoration.
3. **Group permissions are server rules.** Owner/admin/moderator/member/read-only behavior must be enforced by the backend, not only hidden in the UI.
4. **Media is a protocol, not a URL field.** Upload is two-phase and authorized; only a completed server-side upload can be attached to a message.
5. **Realtime is advisory; stored state is authoritative.** WebSocket events update quickly, while protected HTTP endpoints remain the personalized source of truth for read state, poll votes and room state.
6. **Mobile is a first-class layout.** On narrow screens, room list and active conversation become two app-like full-screen states.
7. **Idempotency matters on mobile networks.** Reusing the same `clientMessageId` for the same request returns the same message; reusing it with different content is a conflict.
8. **Deletion needs compatibility and storage cleanup.** New UI can show tombstones, old clients may hide deleted messages, and physical attachment files are removed only when no message still references them.
9. **Do not claim cryptography that does not exist.** This block does not implement a client-to-client E2EE key protocol, so the UI must not display an E2EE badge or promise WhatsApp-style end-to-end encryption.

## Implemented in CHAT_CONSOLE_V2

### Inbox / room model

- GENERAL, COUNTRY and existing DIRECT remain supported.
- Real GROUP rooms: PUBLIC / PRIVATE.
- Group roles: OWNER / ADMIN / MODERATOR / MEMBER / READONLY.
- Group invite flow; public discovery/join; leave; remove; ban/unban backend support.
- Owner transfer.
- Favorite, archive, mute, pin rank, notification level (`ALL`, `MENTIONS`, `NONE`).
- Conversation filters: All / Direct / Groups / Country / Archive.
- Drafts stored server-side per room/user.
- Unread and mention counters.
- Last-message previews.

### Messages

- Text up to 4000 characters.
- Idempotent `clientMessageId` semantics preserved.
- Replies.
- Forwarding between rooms that the sender can access.
- 15-minute own-message editing.
- Delete for me.
- Delete for everyone / moderator deletion where allowed.
- New Chat Console can display deletion tombstones; legacy GET remains compatible by hiding them.
- 12 curated reactions.
- `@nickname` and `@all` mentions.
- Send/read/delivered state model.
- Search inside accessible chats.
- Up to 5 pinned messages per room.
- Per-user disappearing-message timer for *new* messages from that browser: Off / 1h / 24h / 7d / 30d.

### Attachments / voice

- Two-phase upload authorization.
- IMAGE / VIDEO / AUDIO / FILE.
- Size limits by kind; global maximum 25 MiB.
- MIME allow-list and safe file names.
- Files stored outside the public static tree under runtime `data/chat`.
- Authenticated attachment download.
- Byte Range support for media seeking.
- Voice-message recording via MediaRecorder with pause/resume/cancel and a five-minute cap.
- Audio playback speeds 1x / 1.5x / 2x.
- Reference-counted file cleanup when messages/groups are deleted.

### Polls

- Up to 12 options.
- Single or multiple selection.
- Backend model also supports anonymous/closesAt fields.
- Live refresh without exposing another user's personalized vote state in the broadcast payload.

### Realtime / presence

- Existing authenticated WebSocket is retained.
- Room subscriptions.
- Typing state.
- New message event.
- Aggregated reaction event.
- Generic refresh for personalized room/message state when required.
- 12-second overview polling remains a resilience fallback.

### PaTaP integration

- From a DIRECT chat, user can jump directly to the existing PaTaP Radio direct channel.
- Driver nickname/profile identity remains the account identity shown in chat.
- Existing Driver contact/block rules remain enforced.

## Explicitly not claimed / not implemented in this block

These are separate engineering projects, not fake UI buttons:

- WhatsApp-compatible or Signal-protocol E2EE and multi-device key management.
- Voice/video calls inside Chat (PaTaP Radio remains a separate function).
- Telegram-style Topics/forum subthreads.
- Global sticker/GIF catalog and sticker pack ecosystem.
- Server-generated rich link previews with URL-fetch security controls.
- Large-scale push-notification infrastructure for native background delivery.

Those features can be future blocks after this messenger foundation is verified on the real site.
