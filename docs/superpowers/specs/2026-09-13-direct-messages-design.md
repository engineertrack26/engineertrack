# Direct Messages — design

**Date:** 2026-09-13
**Status:** approved in conversation, awaiting written review
**Depends on:** internship groups (`owns_group`, `is_member_of_group`), mentor linking (`student_profiles.mentor_id`), the notifications table, `useRealtimeSubscription`.

## 1. What this is

One-to-one messaging inside an internship group: the advisor with any of
their group's students, students with each other, and a workplace mentor
with the student they are linked to. Text only. A conversation is between
exactly two people and is readable by nobody else — the advisor who owns the
group cannot read two students' messages. Messages live only as long as the
relationship: when a student leaves the group, when the group is archived,
or when a mentor link changes, the affected conversations are **deleted
from the database**, not hidden. Either side of a student↔student or
mentor↔student conversation can block the other; conversations with the
advisor cannot be blocked.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | One-to-one only. No group chat. | "Messages stay between people." The group's shared channel is the stream. |
| 2 | Mentor ↔ their own student is allowed; mentor with nobody else. | The mentor's only relationship in the app is with their students. |
| 3 | Text only, ≤ 2000 characters. | First version; the stream's attachment pattern can be reused later. |
| 4 | Every conversation belongs to a **group** — including mentor↔student (the student's active group at creation). | Makes the lifetime rule uniform: the group's lifecycle governs every conversation. |
| 5 | Leaving the group deletes that student's conversations in that group; archiving deletes the group's conversations; a mentor-link change deletes that mentor↔student conversation. **Deleted, not hidden.** | Owner's decision: messages are not to outlive the relationship, anywhere. |
| 6 | The advisor cannot read student↔student messages. `owns_group` appears in **no** policy on the message tables. | Privacy is the feature. |
| 7 | Blocking: in student↔student and mentor↔student conversations either participant can block the other; the blocked person cannot send, the blocker keeps the history; advisor conversations cannot be blocked. | The one safeguard that costs no privacy. Reporting was deliberately left out — the advisor cannot see content, so a report could not be acted on in-app. |
| 8 | Archiving and leaving show a confirmation that names how many conversations will be deleted. | The deletion is irreversible; the person pressing the button should know. |
| 9 | Messages is a tab (student 5th, advisor 7th, mentor 5th). Placement within Codex's redesigned bars is theirs to settle. | The tab bars were recently slimmed; a tab is what the owner asked for. |
| 10 | No editing, no deleting single messages, no read receipts shown to the other side, no typing indicators. | Out of scope for v1. |

## 3. Data model

### `conversations`
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `group_id` | → `internship_groups` ON DELETE CASCADE | every conversation belongs to a group |
| `kind` | text CHECK in (`member`, `mentor`) | `member`: two of {advisor, active students}; `mentor`: a student and their linked mentor |
| `a_id`, `b_id` | → `profiles` | the two participants, stored with `a_id < b_id` (CHECK) so a pair has one row |
| `created_at`, `last_message_at` | timestamptz | list ordering |

UNIQUE (`group_id`, `a_id`, `b_id`). Index (`group_id`), index on each participant.

### `messages`
`id`, `conversation_id` → `conversations` ON DELETE CASCADE, `sender_id` → `profiles`, `body` text CHECK 1–2000, `created_at`. Index (`conversation_id`, `created_at`).

### `conversation_reads`
`conversation_id` (cascade), `user_id`, `last_read_at`; PK (`conversation_id`, `user_id`). Unread for me = messages in the conversation with `created_at > last_read_at` and `sender_id <> me`.

### `conversation_blocks`
`conversation_id` (cascade), `blocker_id`, `created_at`; PK (`conversation_id`, `blocker_id`). A row means "blocker has blocked the other participant".

## 4. Who may talk to whom — one function

`can_message(p_group_id, p_user, p_other) RETURNS TEXT` (SECURITY DEFINER, STABLE): returns the conversation `kind` the pair is allowed, or NULL.

- `member` when both are *the group's advisor or an active member* (`left_at IS NULL`) and they are not the same person.
- `mentor` when one is an active member student of the group and the other is that student's `student_profiles.mentor_id`.
- NULL otherwise — a mentor and the advisor, a mentor and another student, two people in different groups, anyone with themselves.

Evaluated at conversation creation **and** on every read (see §5), so a relationship that ends closes access even before the deletion trigger has run.

## 5. Authorisation

`can_access_conversation(p_conversation_id)` (SECURITY DEFINER, STABLE): true iff `auth.uid()` is `a_id` or `b_id` of the row **and** `can_message(group_id, a_id, b_id) IS NOT NULL` still holds.

| table | select | insert / update / delete |
|---|---|---|
| `conversations` | `can_access_conversation(id)` | none — `open_conversation` only |
| `messages` | `can_access_conversation(conversation_id)` | none — `send_message` only |
| `conversation_reads` | own row and `can_access_conversation` | none — `mark_conversation_read` only |
| `conversation_blocks` | own row (the blocker) | none — `block_conversation` only |

Every write goes through an RPC; no table has a direct write policy. Nothing here mentions `owns_group`. Mentors, advisors and students are all just "a participant or not".

## 6. RPCs (all SECURITY DEFINER; refusals are stable codes through `mapRpcError`)

- `open_conversation(p_group_id, p_other_id) RETURNS UUID` — `NOT_AUTHENTICATED`; `CANNOT_MESSAGE` when `can_message` is NULL; returns the existing row for the ordered pair or creates it with the returned kind.
- `send_message(p_conversation_id, p_body) RETURNS UUID` — `NOT_AUTHENTICATED`; `CONVERSATION_NOT_FOUND` when the caller is not a participant or the relationship no longer holds; `BLOCKED` when the *other* participant has a block row; `MESSAGE_EMPTY` on blank body. Inserts the message, bumps `last_message_at`, and writes ONE `direct_message` notification for the recipient in the same transaction (`data: { conversationId }`), unless the recipient has blocked the sender (then `BLOCKED` was raised already).
- `mark_conversation_read(p_conversation_id)` — upserts `conversation_reads` for the caller.
- `block_conversation(p_conversation_id, p_block BOOLEAN)` — `CANNOT_BLOCK` when either participant is the group's advisor; otherwise inserts or deletes the caller's block row.
- `list_conversations(p_group_id DEFAULT NULL) RETURNS SETOF JSONB` — the caller's conversations (all groups, or one), each: `{ id, kind, groupId, groupName, otherId, otherName, otherRole, lastMessageAt, lastMessagePreview (≤ 80 chars), unreadCount, blockedByMe, blockedMe }`. `blockedMe` is the only thing the blocked side learns, and only as "you cannot send".
- `list_message_contacts(p_group_id) RETURNS SETOF JSONB` — who the caller may start a conversation with in that group: `{ id, name, role }`. Student: advisor, classmates, linked mentor. Advisor: the group's active students. Mentor: their linked students who are active members of the group.
- `unread_message_count() RETURNS INT` — total across the caller's conversations (tab badge).

Names come from `profiles_public` inside the SECURITY DEFINER functions (the same reason `list_feed_posts` projects names itself).

## 7. Lifetime — deletion triggers

- `group_memberships`: AFTER UPDATE OF `left_at` WHEN old NULL → new set: `DELETE FROM conversations WHERE group_id = NEW.group_id AND (a_id = NEW.student_id OR b_id = NEW.student_id)`.
- `internship_groups`: AFTER UPDATE OF `is_archived` WHEN false → true: `DELETE FROM conversations WHERE group_id = NEW.id`.
- `student_profiles`: AFTER UPDATE OF `mentor_id` WHEN changed: delete `kind = 'mentor'` conversations of that student whose other participant is the OLD mentor.
- Messages, reads and blocks cascade. Un-archiving does not restore anything; there is nothing to restore.

`count_deletable_conversations(p_group_id, p_student_id DEFAULT NULL) RETURNS INT` (owner- or self-checked) backs the confirmation dialogs in decision 8.

## 8. Screens

One component set under `src/components/messages/`, rendered by three route files (`app/(student)/messages.tsx`, `app/(mentor)/messages.tsx`, `app/(advisor)/messages.tsx`) plus a shared `app/(role)/conversation.tsx` (`href: null`, `?id=`).

- **Messages tab** — conversation list from `list_conversations`: other person's name, role label, preview, time, unread badge; empty state "No messages yet". Advisor with several groups: a group chip row (same treatment as the stream). Top right: **New message** → contact picker from `list_message_contacts` → `open_conversation` → navigates to the conversation. A one-line note at the top: "Messages are deleted when the group is archived or when someone leaves it."
- **Conversation** — messages oldest→newest, own/other bubbles, input + send (disabled while sending; `MESSAGE_EMPTY` never reaches the server because the client trims); realtime on `messages` INSERT filtered by `conversation_id` (RLS decides delivery); `mark_conversation_read` on focus and on each received message while focused; menu: **Block / Unblock** (absent when the other participant is the advisor). When `blockedMe`, the input is replaced by "You can't message this person." When the conversation vanishes under you (deleted by a trigger), the next load returns `CONVERSATION_NOT_FOUND` → go back to the list with a short notice.
- **Badge** — `unread_message_count` on tab focus + realtime; `direct_message` notification routes to the conversation (`routeForNotification` for all three roles).
- **Confirmations** — the archive action in `groups.tsx` and the leave action (student profile / advisor's remove-member) read `count_deletable_conversations` and say "N conversations and their messages will be permanently deleted."

## 9. Verification

`docs/direct-messages-verification.sql`, Parts A / B / C (C under `SET LOCAL ROLE authenticated`):

- A: tables, RLS on, `can_message`, `can_access_conversation`, the three triggers, the RPCs; **no policy on the four tables mentions `owns_group`** (asserted from `pg_policies`).
- B: open student↔student, student↔advisor, student↔mentor; mentor↔advisor refused `CANNOT_MESSAGE`; send → 1 message, 1 notification; block → sender gets `BLOCKED`, blocker still sends; advisor conversation `CANNOT_BLOCK`; unread arithmetic; leave → that student's rows gone, the other students' rows remain; archive → zero rows; mentor change → mentor conversation gone.
- C: **the advisor cannot select two students' conversation or its messages** (the case this feature exists for); a student of another group cannot; a participant can (positive control); after the membership is closed, the former participant gets zero rows; `send_message` as a non-participant → `CONVERSATION_NOT_FOUND`.

Jest: `unreadFromReads`, `conversationPair` (ordering), contact-list filtering helpers.

## 10. Out of scope

Group chat, attachments, editing/deleting messages, read receipts, typing indicators, reporting, message search, export, retention beyond the relationship.
