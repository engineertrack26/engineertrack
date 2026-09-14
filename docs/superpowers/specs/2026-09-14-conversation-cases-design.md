# Conversations v2 — case threads (advisor + student + mentor) — design

**Date:** 2026-09-14
**Status:** approved in conversation, awaiting written review
**Supersedes in part:** `2026-09-13-direct-messages-design.md` (§3 data model, §4–§6). Everything not mentioned here stays as designed there.
**Why:** the owners' original workflow (`workflow_diagram tr.pdf`, Dec 2025) names one collaboration step explicitly — "major issue → a three-way discussion (advisor, mentor, student)". Direct messages v1 built 1:1 only and refused mentor↔advisor entirely. This revision keeps 1:1 (to be removed after the pilot if unused) and adds the three-way thread.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Participants live in a table, not in two columns. `conversations.a_id/b_id` are gone; `conversation_participants` holds 2 rows for a 1:1 and 3 for a case. | The only thing that stood between v1 and a three-way thread. |
| 2 | Kinds: `member` (advisor↔student, student↔student), `mentor` (mentor↔their student), `staff` (advisor↔mentor of an active member — new), `case` (advisor + student + the student's mentor — new). | `staff` is the diagram's "minor issue: the advisor comments"; `case` is its "major issue". |
| 3 | A case is opened by the advisor only, for one student, in the student's group; at most one case per student per group. It cannot be opened without a linked mentor (a two-person case is a `member` conversation). | Opening a case is the advisor's escalation decision. |
| 4 | Case participants follow the relationship: when the student's mentor changes, the old mentor is removed from the case and the new one added; the old mentor's messages stay (they are the record). A 1:1 `mentor` conversation is still deleted on that change, as in v1. | A case is a resolution record; a 1:1 is a private channel. |
| 5 | Access = participant **and** the relationship still holds: student → active member of the group; advisor → owns the group; mentor → currently linked to the case's subject (case) or to the other participant (1:1). Nobody else, ever; `owns_group` still appears in no policy. | Same predicate shape as v1, generalised. |
| 6 | Lifetime as v1: membership closed → every conversation the student is in (cases included, they are the subject); group archived → all; mentor link changed → `mentor` 1:1s deleted, cases re-pointed (decision 4). Notifications die with the conversation. | Unchanged owner decision: messages do not outlive the relationship. |
| 7 | Blocking only in `member` student↔student and `mentor` conversations; never in `staff` or `case`. | Cases are supervised by design; blocking there would defeat them. |
| 8 | Messages in a case show the sender's name; 1:1 bubbles do not. The list shows a case as "Case · <student name>" with the three names underneath. | Three people need attribution. |
| 9 | No production data exists yet, so v2 **drops and recreates** the four tables in one migration file (the v1 files are replaced, not layered). | A migration of nothing is a rewrite. |
| 10 | 1:1 conversations stay in the pilot; if the owners find them unused after testing, removing them is a `can_message` change and a UI flag, not a schema change. | Owner's decision 2026-09-14. |

## 2. Data model

```
conversations
  id uuid pk
  group_id → internship_groups ON DELETE CASCADE
  kind text CHECK IN ('member','mentor','staff','case')
  subject_id → profiles (NULL unless kind='case': the student the case is about)
  pair_key text (NULL for case: least(id)||':'||greatest(id) of the two participants)
  created_by → profiles
  created_at, last_message_at
  UNIQUE (group_id, pair_key)      -- one 1:1 per pair per group (pair_key NULL for cases, so cases never collide here)
  UNIQUE (group_id, subject_id)    -- one case per student per group (subject_id NULL for 1:1s)
  CHECK ((kind='case') = (subject_id IS NOT NULL))
  CHECK ((kind='case') = (pair_key IS NULL))

conversation_participants
  conversation_id → conversations ON DELETE CASCADE
  user_id → profiles ON DELETE CASCADE
  added_at
  PK (conversation_id, user_id)

messages, conversation_reads, conversation_blocks: as v1.
```

## 3. Authorisation

`can_message(p_group_id, p_user, p_other) RETURNS TEXT` — as v1 plus: `'staff'` when one is the group's advisor and the other is the current mentor of an active member of the group; `NULL` for an archived group (v1 fix kept).

`can_access_conversation(p_conversation_id) RETURNS BOOLEAN`, evaluated on every read and write:
- caller is in `conversation_participants`, and
- `kind='case'`: the subject is an active member of the group, the group is not archived, and the caller is the group's advisor **or** the subject **or** the subject's current mentor;
- otherwise: `can_message(group_id, caller, the other participant) IS NOT NULL`.

Policies (SELECT only, as v1): `conversations` / `messages` / `conversation_reads` / `conversation_participants` via `can_access_conversation`; `conversation_blocks` own rows. No direct write policy anywhere. Part A asserts `owns_group` absent from all five tables' policies and `can_message` not executable by `authenticated`.

## 4. RPCs (SECURITY DEFINER; stable codes via `mapRpcError`)

- `open_conversation(p_group_id, p_other_id) → uuid` — as v1; inserts two participant rows; `pair_key` computed.
- **`open_case(p_group_id, p_student_id) → uuid`** — caller must own the group (`CANNOT_OPEN_CASE` otherwise), student must be an active member with a linked mentor (`CASE_NEEDS_MENTOR`); returns the existing case if one exists; inserts advisor, student, mentor participants; writes ONE `direct_message` notification to the student and one to the mentor ("<advisor> opened a case").
- `send_message(p_conversation_id, p_body) → uuid` — as v1; `BLOCKED` only when `kind IN ('member','mentor')` and the other participant has a block row; one `direct_message` notification per **other** participant.
- `mark_conversation_read`, `block_conversation` (raises `CANNOT_BLOCK` for `staff`/`case` and for any conversation with the advisor), `list_messages`, `unread_message_count`, `count_deletable_conversations`, `list_message_contacts`, `list_mentor_message_contacts` — as v1 (contacts for the advisor now include the mentors of active members, role `mentor`; for a mentor, the group's advisor, role `advisor`).
- `list_conversations(p_group_id DEFAULT NULL)` — rows gain `subjectId`, `title` (case: the student's name; 1:1: the other's name), `participants: [{id, name, role}]`. `otherId/otherName/otherRole` remain for 1:1 and are NULL for cases. `blockedByMe/blockedMe` false for cases.

## 5. Lifetime triggers

- `group_memberships.left_at` NULL→set: delete every conversation the student participates in within that group.
- `internship_groups.is_archived` false→true: delete the group's conversations.
- `student_profiles.mentor_id` changed: delete `kind='mentor'` conversations between the student and the old mentor; for `kind='case'` rows where `subject_id` = the student: delete the old mentor's participant row, insert the new mentor's (if any). `staff` conversations between the old mentor and the advisor are deleted when the mentor no longer mentors any active member of that group.
- `conversations` AFTER DELETE: delete the `direct_message` notifications that point at it (v1 fix kept).

## 6. Screens

- **Messages list**: a case row reads "Case · Ayşe Yılmaz" with a case icon and the three participant names; sorted with the rest by last activity. Advisor: a second button **New case** → student picker (active members with a linked mentor) → `open_case` → the conversation. (An entry point from Student Monitor is optional and lands later — that file belongs to the parallel session.)
- **Conversation**: header shows the title and, for a case, the participants line; bubbles from others carry the sender's name in a case; Block absent for `staff` and `case`. Everything else unchanged.
- **Contact picker**: advisor sees students and mentors; mentor sees their students and the advisor(s) of their students' groups; student unchanged.
- Confirmations (archive / remove / join-another-group) unchanged — `count_deletable_conversations` counts cases too.

## 7. Verification (Parts A / B / C, replacing v1's file)

- A: five tables, RLS, SELECT-only, no `owns_group` in policies, `can_message` internal, participants table, the two partial uniques, four triggers.
- B (adds to v1's cases): advisor opens a case → 3 participants; the student cannot open one (`CANNOT_OPEN_CASE`); without a mentor → `CASE_NEEDS_MENTOR`; reopening returns the same id; a message in the case notifies the two others; mentor change swaps the participant and the old mentor gets `CONVERSATION_NOT_FOUND`; `staff` conversation advisor↔mentor opens; blocking in a case → `CANNOT_BLOCK`; the student leaving deletes the case.
- C (`SET LOCAL ROLE authenticated`): a second student cannot read the case (0 rows); the subject's mentor can; an advisor of another group cannot; after the archive nobody can.

## 8. Out of scope

Group chat beyond the fixed triad, adding arbitrary participants, case status (open/closed) and resolution notes, attachments, editing/deleting messages. A case "closed" flag with a summary is the obvious next step if the owners use cases.
