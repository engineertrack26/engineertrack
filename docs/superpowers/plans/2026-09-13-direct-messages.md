# Direct Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-to-one text messaging inside an internship group — advisor↔student, student↔student, mentor↔their student — readable by the two participants only, deleted from the database when the relationship ends, with per-conversation blocking.

**Architecture:** Four tables (`conversations`, `messages`, `conversation_reads`, `conversation_blocks`) with no direct write policy; every write is a `SECURITY DEFINER` RPC. One relationship function, `can_message(group, a, b)`, decides who may talk and is re-evaluated on every read through `can_access_conversation`, so `owns_group` never appears in a message policy. Three triggers delete conversations when a membership closes, a group is archived, or a mentor link changes. Realtime on `messages` INSERT, notifications written in-transaction. One component set under `src/components/messages/`, rendered by three route files.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / TypeScript 6 / Supabase (Postgres, RLS, realtime) / Zustand / i18next / jest.

**Spec:** `docs/superpowers/specs/2026-09-13-direct-messages-design.md`

## Global Constraints

- SQL is applied by the user in the Supabase SQL editor, one file per submission, in this order: `docs/direct-messages-migration.sql`, `docs/direct-messages-rpcs.sql`, `docs/direct-messages-verification.sql` (Part A, then B, then C, each its own submission). Anonymous `$$` only; every SQL file's `grep -o '\$\$' <file> | wc -l` is even. Idempotent; re-applyable.
- **No policy on `conversations`, `messages`, `conversation_reads`, `conversation_blocks` may mention `owns_group`** — Part A asserts it from `pg_policies`.
- No table in this feature has a direct INSERT/UPDATE/DELETE policy; writes go through the RPCs.
- Body ≤ 2000 characters as a CHECK; preview ≤ 80 characters.
- New RPC codes, mapped in `src/utils/rpcErrors.ts`: `CANNOT_MESSAGE`, `CONVERSATION_NOT_FOUND`, `BLOCKED`, `MESSAGE_EMPTY`, `CANNOT_BLOCK`.
- **The tree is shared with a parallel Codex session** that often has uncommitted work (advisor screens, locale files). Every implementer stages by explicit path only — never `git add -A` / `git add .`, never stash, checkout or reset — and never touches a file it was not told to. If `src/i18n/locales/en.json` is uncommitted when a task needs keys, the task uses `t(key, 'Default')` in code and leaves the keys out; if it is clean, add them to `en.json` only (never the other six).
- Path aliases (`@/...`), never relative imports out of `src/`. `noUnusedLocals` / `noUnusedParameters` are on. Every user-facing string through `t()`.
- Gates: `npx tsc --noEmit` silent; `npx jest --silent` green at the baseline you measure at task start plus what the task adds (state both numbers).
- Do not touch `src/components/feed/**`, `src/services/feed.ts`, `docs/group-feed-*.sql`, or any file under `src/components/advisor/`, `src/components/student/`, `src/components/mentor/` except where a task names it.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` (plus the `Claude-Session:` line if your tooling adds one).

---

## File Structure

**SQL (create)**
- `docs/direct-messages-migration.sql` — tables, `can_message`, `can_access_conversation`, RLS, three deletion triggers, realtime publication.
- `docs/direct-messages-rpcs.sql` — `open_conversation`, `send_message`, `mark_conversation_read`, `block_conversation`, `list_conversations`, `list_message_contacts`, `unread_message_count`, `count_deletable_conversations`.
- `docs/direct-messages-verification.sql` — Parts A / B / C.

**Client (create)**
- `src/types/messages.ts` — `ConversationSummary`, `Message`, `MessageContact`.
- `src/services/messages.ts` — `messageService`.
- `src/utils/messageHelpers.ts` + test — `previewText`, `dayGroups`.
- `src/components/messages/ConversationList.tsx`, `ContactPicker.tsx`, `MessageBubble.tsx`, `index.ts`.
- `src/components/screens/MessagesScreen.tsx`, `src/components/screens/ConversationScreen.tsx`.
- `app/(student)/messages.tsx`, `app/(mentor)/messages.tsx`, `app/(advisor)/messages.tsx`; `app/(student)/conversation.tsx`, `app/(mentor)/conversation.tsx`, `app/(advisor)/conversation.tsx`.

**Client (modify)**
- `src/utils/rpcErrors.ts`, `src/types/notification.ts`, `src/utils/notificationRoutes.ts` + test, `src/components/screens/NotificationsScreen.tsx` (icon map), `src/i18n/locales/en.json`.
- `app/(student)/_layout.tsx`, `app/(mentor)/_layout.tsx`, `app/(advisor)/_layout.tsx` — a `messages` tab with a badge, a hidden `conversation` route.
- `src/components/advisor/GroupCenter.tsx` (archive confirm), `app/(advisor)/student-monitor.tsx` (remove-member confirm) — Task 6 only, one sentence each.

---

### Task 1: Migration — tables, the relationship rule, RLS, deletion triggers

**Files:**
- Create: `docs/direct-messages-migration.sql`
- Create: `docs/direct-messages-verification.sql` (Part A only; Parts B and C are appended in Task 2)

**Interfaces:**
- Consumes: `owns_group(uuid)`, `is_member_of_group(uuid)` (`docs/internship-groups-rls-recursion-fix.sql`), `student_profiles.mentor_id`, `profiles_public(id, first_name, last_name, role)`.
- Produces: the four tables; `can_message(p_group_id UUID, p_user UUID, p_other UUID) RETURNS TEXT`; `can_access_conversation(p_conversation_id UUID) RETURNS BOOLEAN`; triggers `trg_dm_membership_closed`, `trg_dm_group_archived`, `trg_dm_mentor_changed`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================
-- Direct messages: tables, the one relationship rule, RLS, and the three
-- deletion triggers. Idempotent and safe to re-apply. Apply order: this
-- file, then docs/direct-messages-rpcs.sql, then the verification file.
-- Anonymous dollar-quoting only in the Supabase SQL editor.
--
-- Privacy is the feature: a conversation is readable by its two
-- participants and nobody else. owns_group appears in NO policy here --
-- the advisor who owns the group is, in these tables, just a participant
-- or not. Part A of the verification file asserts that from pg_policies.
-- ============================================

-- ---- conversations ----
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('member', 'mentor')),
  a_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  b_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  -- One row per pair: participants are stored in id order.
  CONSTRAINT conversations_pair_ordered CHECK (a_id < b_id),
  UNIQUE (group_id, a_id, b_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_group ON conversations(group_id);
CREATE INDEX IF NOT EXISTS idx_conversations_a ON conversations(a_id);
CREATE INDEX IF NOT EXISTS idx_conversations_b ON conversations(b_id);

-- ---- messages ----
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

-- ---- conversation_reads ----
CREATE TABLE IF NOT EXISTS conversation_reads (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- ---- conversation_blocks ----
CREATE TABLE IF NOT EXISTS conversation_blocks (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  blocker_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, blocker_id)
);

-- ---- The one relationship rule ----
-- Returns the conversation kind two people are allowed in this group, or
-- NULL. Evaluated when a conversation is opened AND on every read (through
-- can_access_conversation), so a relationship that has ended closes access
-- even before the deletion trigger has run.
CREATE OR REPLACE FUNCTION can_message(p_group_id UUID, p_user UUID, p_other UUID)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN p_user IS NULL OR p_other IS NULL OR p_user = p_other THEN NULL
    -- member: both are the group's advisor or an active member
    WHEN (SELECT EXISTS (SELECT 1 FROM internship_groups g WHERE g.id = p_group_id AND g.advisor_id = p_user)
          OR EXISTS (SELECT 1 FROM group_memberships m WHERE m.group_id = p_group_id AND m.student_id = p_user AND m.left_at IS NULL))
     AND (SELECT EXISTS (SELECT 1 FROM internship_groups g WHERE g.id = p_group_id AND g.advisor_id = p_other)
          OR EXISTS (SELECT 1 FROM group_memberships m WHERE m.group_id = p_group_id AND m.student_id = p_other AND m.left_at IS NULL))
      THEN 'member'
    -- mentor: one is an active member of the group, the other is that student's linked mentor
    WHEN EXISTS (SELECT 1 FROM group_memberships m JOIN student_profiles sp ON sp.id = m.student_id
                 WHERE m.group_id = p_group_id AND m.left_at IS NULL
                   AND ((m.student_id = p_user AND sp.mentor_id = p_other)
                     OR (m.student_id = p_other AND sp.mentor_id = p_user)))
      THEN 'mentor'
    ELSE NULL
  END;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION can_message(UUID, UUID, UUID) TO authenticated;

-- True iff the caller is one of the two participants AND the relationship
-- still holds. This is the only predicate the four policies use.
CREATE OR REPLACE FUNCTION can_access_conversation(p_conversation_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = p_conversation_id
      AND auth.uid() IN (c.a_id, c.b_id)
      AND can_message(c.group_id, c.a_id, c.b_id) IS NOT NULL
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION can_access_conversation(UUID) TO authenticated;

-- ---- RLS: SELECT only; every write is an RPC ----
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_reads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT TO authenticated
  USING (can_access_conversation(id));

DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT TO authenticated
  USING (can_access_conversation(conversation_id));

DROP POLICY IF EXISTS conversation_reads_select ON conversation_reads;
CREATE POLICY conversation_reads_select ON conversation_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND can_access_conversation(conversation_id));

DROP POLICY IF EXISTS conversation_blocks_select ON conversation_blocks;
CREATE POLICY conversation_blocks_select ON conversation_blocks FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

-- ---- Lifetime: messages do not outlive the relationship ----
-- A membership closing deletes that student's conversations in that group.
CREATE OR REPLACE FUNCTION trg_dm_membership_closed_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM conversations
  WHERE group_id = NEW.group_id AND (a_id = NEW.student_id OR b_id = NEW.student_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dm_membership_closed ON group_memberships;
CREATE TRIGGER trg_dm_membership_closed
  AFTER UPDATE OF left_at ON group_memberships
  FOR EACH ROW
  WHEN (OLD.left_at IS NULL AND NEW.left_at IS NOT NULL)
  EXECUTE FUNCTION trg_dm_membership_closed_fn();

-- Archiving deletes every conversation of the group. Un-archiving restores
-- nothing; there is nothing left to restore.
CREATE OR REPLACE FUNCTION trg_dm_group_archived_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM conversations WHERE group_id = NEW.id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dm_group_archived ON internship_groups;
CREATE TRIGGER trg_dm_group_archived
  AFTER UPDATE OF is_archived ON internship_groups
  FOR EACH ROW
  WHEN (OLD.is_archived = false AND NEW.is_archived = true)
  EXECUTE FUNCTION trg_dm_group_archived_fn();

-- A mentor link changing deletes the student's conversation with the OLD
-- mentor. Only mentor-kind rows; the student's group conversations stay.
CREATE OR REPLACE FUNCTION trg_dm_mentor_changed_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.mentor_id IS NOT NULL THEN
    DELETE FROM conversations
    WHERE kind = 'mentor'
      AND ((a_id = NEW.id AND b_id = OLD.mentor_id) OR (a_id = OLD.mentor_id AND b_id = NEW.id));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dm_mentor_changed ON student_profiles;
CREATE TRIGGER trg_dm_mentor_changed
  AFTER UPDATE OF mentor_id ON student_profiles
  FOR EACH ROW
  WHEN (OLD.mentor_id IS DISTINCT FROM NEW.mentor_id)
  EXECUTE FUNCTION trg_dm_mentor_changed_fn();

-- ---- Realtime: the conversation screen listens for new messages ----
-- Never set REPLICA IDENTITY FULL on messages: Realtime does not apply RLS
-- to DELETE events and would broadcast deleted bodies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;
```

- [ ] **Step 2: Write verification Part A**

Create `docs/direct-messages-verification.sql`:

```sql
-- ============================================================
-- Direct messages verification. Run in the Supabase SQL editor, one part
-- per submission. Anonymous dollar-quoting only.
-- Apply order: docs/direct-messages-migration.sql, docs/direct-messages-rpcs.sql,
-- then this file.
-- PART A is STRUCTURAL (owner session bypasses RLS). Part C evaluates the
-- policies under SET LOCAL ROLE authenticated.
-- ============================================================

-- ============================================================
-- PART A — schema assertions. Expected: one row "PASS: schema assertions held".
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversations','messages','conversation_reads','conversation_blocks'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      RAISE EXCEPTION 'FAIL: table % is missing', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'FAIL: RLS is not enabled on %', t;
    END IF;
    -- SELECT-only: any INSERT/UPDATE/DELETE policy is a second write path.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND cmd <> 'SELECT') THEN
      RAISE EXCEPTION 'FAIL: % has a direct write policy', t;
    END IF;
    -- Privacy: owns_group must not appear in any policy on these tables.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t
               AND (coalesce(qual, '') LIKE '%owns_group%' OR coalesce(with_check, '') LIKE '%owns_group%')) THEN
      RAISE EXCEPTION 'FAIL: a policy on % mentions owns_group -- the advisor must not be able to read messages', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_pair_ordered') THEN
    RAISE EXCEPTION 'FAIL: conversations_pair_ordered CHECK is missing';
  END IF;
  FOREACH t IN ARRAY ARRAY['can_message','can_access_conversation'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = t) THEN
      RAISE EXCEPTION 'FAIL: %() is missing', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['trg_dm_membership_closed','trg_dm_group_archived','trg_dm_mentor_changed'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'FAIL: trigger % is missing', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    RAISE EXCEPTION 'FAIL: messages is not in the supabase_realtime publication';
  END IF;
  RAISE NOTICE 'PASS: schema assertions held';
END $$;
SELECT 'PASS: schema assertions held' AS result;

-- Parts B and C are appended by Task 2.
```

- [ ] **Step 3: Lint**

Run: `grep -o '\$\$' docs/direct-messages-migration.sql | wc -l` and the same for the verification file. Expected: even numbers.

- [ ] **Step 4: Commit**

```bash
git add docs/direct-messages-migration.sql docs/direct-messages-verification.sql
git commit -m "feat(messages): tables, the relationship rule, RLS and deletion triggers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: RPCs and verification Parts B / C

**Files:**
- Create: `docs/direct-messages-rpcs.sql`
- Modify: `docs/direct-messages-verification.sql` (append Parts B and C, replacing the `-- Parts B and C are appended by Task 2.` marker)

**Interfaces:**
- Consumes: Task 1.
- Produces (all `GRANT EXECUTE … TO authenticated`, all `SECURITY DEFINER`, actor = `auth.uid()`):
  - `open_conversation(p_group_id UUID, p_other_id UUID) RETURNS UUID` — `NOT_AUTHENTICATED`, `CANNOT_MESSAGE`.
  - `send_message(p_conversation_id UUID, p_body TEXT) RETURNS UUID` — `NOT_AUTHENTICATED`, `CONVERSATION_NOT_FOUND`, `BLOCKED`, `MESSAGE_EMPTY`.
  - `mark_conversation_read(p_conversation_id UUID) RETURNS VOID` — `CONVERSATION_NOT_FOUND`.
  - `block_conversation(p_conversation_id UUID, p_block BOOLEAN) RETURNS VOID` — `CONVERSATION_NOT_FOUND`, `CANNOT_BLOCK`.
  - `list_conversations(p_group_id UUID DEFAULT NULL) RETURNS SETOF JSONB` — rows shaped `{ id, kind, groupId, groupName, otherId, otherName, otherRole, lastMessageAt, lastMessagePreview, unreadCount, blockedByMe, blockedMe }`, ordered by `coalesce(last_message_at, created_at) DESC`.
  - `list_messages(p_conversation_id UUID, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INT DEFAULT 50) RETURNS SETOF JSONB` — `{ id, senderId, body, createdAt }`, newest first (client reverses), keyset on `created_at`.
  - `list_message_contacts(p_group_id UUID) RETURNS SETOF JSONB` — `{ id, name, role }`.
  - `unread_message_count() RETURNS INT`.
  - `count_deletable_conversations(p_group_id UUID, p_student_id UUID DEFAULT NULL) RETURNS INT` — `NOT_GROUP_OWNER` unless the caller owns the group or is the named student.

- [ ] **Step 1: Write the RPCs**

```sql
-- ============================================
-- Direct messages RPCs. Apply after docs/direct-messages-migration.sql.
-- All SECURITY DEFINER; the actor is always auth.uid().
-- ============================================

-- ---- open_conversation ----
CREATE OR REPLACE FUNCTION open_conversation(p_group_id UUID, p_other_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_kind TEXT; v_a UUID; v_b UUID; v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  v_kind := can_message(p_group_id, auth.uid(), p_other_id);
  IF v_kind IS NULL THEN RAISE EXCEPTION 'CANNOT_MESSAGE'; END IF;
  v_a := LEAST(auth.uid(), p_other_id);
  v_b := GREATEST(auth.uid(), p_other_id);
  SELECT id INTO v_id FROM conversations WHERE group_id = p_group_id AND a_id = v_a AND b_id = v_b;
  IF v_id IS NULL THEN
    INSERT INTO conversations (group_id, kind, a_id, b_id) VALUES (p_group_id, v_kind, v_a, v_b)
    ON CONFLICT (group_id, a_id, b_id) DO UPDATE SET kind = EXCLUDED.kind
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION open_conversation(UUID, UUID) TO authenticated;

-- ---- send_message ----
CREATE OR REPLACE FUNCTION send_message(p_conversation_id UUID, p_body TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c conversations%ROWTYPE; v_other UUID; v_msg UUID; v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF btrim(coalesce(p_body, '')) = '' THEN RAISE EXCEPTION 'MESSAGE_EMPTY'; END IF;
  SELECT * INTO v_c FROM conversations WHERE id = p_conversation_id;
  IF v_c.id IS NULL OR auth.uid() NOT IN (v_c.a_id, v_c.b_id)
     OR can_message(v_c.group_id, v_c.a_id, v_c.b_id) IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_NOT_FOUND';
  END IF;
  v_other := CASE WHEN v_c.a_id = auth.uid() THEN v_c.b_id ELSE v_c.a_id END;
  IF EXISTS (SELECT 1 FROM conversation_blocks WHERE conversation_id = p_conversation_id AND blocker_id = v_other) THEN
    RAISE EXCEPTION 'BLOCKED';
  END IF;

  INSERT INTO messages (conversation_id, sender_id, body)
  VALUES (p_conversation_id, auth.uid(), btrim(p_body)) RETURNING id INTO v_msg;
  UPDATE conversations SET last_message_at = now() WHERE id = p_conversation_id;
  -- The sender has read their own message.
  INSERT INTO conversation_reads (conversation_id, user_id, last_read_at)
  VALUES (p_conversation_id, auth.uid(), now())
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;

  SELECT trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, ''))
  INTO v_name FROM profiles_public pp WHERE pp.id = auth.uid();
  INSERT INTO notifications (user_id, title, body, type, data)
  VALUES (v_other, 'New message',
          coalesce(nullif(v_name, ''), 'Someone') || ': ' || left(btrim(p_body), 80),
          'direct_message', jsonb_build_object('conversationId', p_conversation_id));
  RETURN v_msg;
END;
$$;
GRANT EXECUTE ON FUNCTION send_message(UUID, TEXT) TO authenticated;

-- ---- mark_conversation_read ----
CREATE OR REPLACE FUNCTION mark_conversation_read(p_conversation_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT can_access_conversation(p_conversation_id) THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
  INSERT INTO conversation_reads (conversation_id, user_id, last_read_at)
  VALUES (p_conversation_id, auth.uid(), now())
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
END;
$$;
GRANT EXECUTE ON FUNCTION mark_conversation_read(UUID) TO authenticated;

-- ---- block_conversation ----
-- Advisor conversations cannot be blocked in either direction.
CREATE OR REPLACE FUNCTION block_conversation(p_conversation_id UUID, p_block BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c conversations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_c FROM conversations WHERE id = p_conversation_id;
  IF v_c.id IS NULL OR auth.uid() NOT IN (v_c.a_id, v_c.b_id) THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM internship_groups g WHERE g.id = v_c.group_id AND g.advisor_id IN (v_c.a_id, v_c.b_id)) THEN
    RAISE EXCEPTION 'CANNOT_BLOCK';
  END IF;
  IF p_block THEN
    INSERT INTO conversation_blocks (conversation_id, blocker_id) VALUES (p_conversation_id, auth.uid())
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM conversation_blocks WHERE conversation_id = p_conversation_id AND blocker_id = auth.uid();
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION block_conversation(UUID, BOOLEAN) TO authenticated;

-- ---- list_conversations ----
CREATE OR REPLACE FUNCTION list_conversations(p_group_id UUID DEFAULT NULL)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'groupId', c.group_id, 'groupName', g.name,
    'otherId', o.id,
    'otherName', trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')),
    'otherRole', o.role,
    'lastMessageAt', c.last_message_at,
    'lastMessagePreview', (SELECT left(m.body, 80) FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1),
    'unreadCount', (SELECT count(*) FROM messages m
                    WHERE m.conversation_id = c.id AND m.sender_id <> auth.uid()
                      AND m.created_at > coalesce((SELECT r.last_read_at FROM conversation_reads r
                                                   WHERE r.conversation_id = c.id AND r.user_id = auth.uid()), '-infinity'::timestamptz)),
    'blockedByMe', EXISTS (SELECT 1 FROM conversation_blocks b WHERE b.conversation_id = c.id AND b.blocker_id = auth.uid()),
    'blockedMe',   EXISTS (SELECT 1 FROM conversation_blocks b WHERE b.conversation_id = c.id AND b.blocker_id = o.id)
  )
  FROM conversations c
  JOIN internship_groups g ON g.id = c.group_id
  JOIN profiles_public o ON o.id = CASE WHEN c.a_id = auth.uid() THEN c.b_id ELSE c.a_id END
  WHERE auth.uid() IN (c.a_id, c.b_id)
    AND (p_group_id IS NULL OR c.group_id = p_group_id)
    AND can_message(c.group_id, c.a_id, c.b_id) IS NOT NULL
  ORDER BY coalesce(c.last_message_at, c.created_at) DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION list_conversations(UUID) TO authenticated;

-- ---- list_messages ----
CREATE OR REPLACE FUNCTION list_messages(p_conversation_id UUID, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INT DEFAULT 50)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT can_access_conversation(p_conversation_id) THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object('id', m.id, 'senderId', m.sender_id, 'body', m.body, 'createdAt', m.created_at)
  FROM messages m
  WHERE m.conversation_id = p_conversation_id
    AND (p_before IS NULL OR m.created_at < p_before)
  ORDER BY m.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
END;
$$;
GRANT EXECUTE ON FUNCTION list_messages(UUID, TIMESTAMPTZ, INT) TO authenticated;

-- ---- list_message_contacts ----
-- Who the caller may start a conversation with in this group.
CREATE OR REPLACE FUNCTION list_message_contacts(p_group_id UUID)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object('id', pp.id,
                            'name', trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')),
                            'role', pp.role)
  FROM (
    SELECT g.advisor_id AS id FROM internship_groups g WHERE g.id = p_group_id
    UNION
    SELECT m.student_id FROM group_memberships m WHERE m.group_id = p_group_id AND m.left_at IS NULL
    UNION
    SELECT sp.mentor_id FROM group_memberships m JOIN student_profiles sp ON sp.id = m.student_id
    WHERE m.group_id = p_group_id AND m.left_at IS NULL AND sp.mentor_id IS NOT NULL
  ) cand
  JOIN profiles_public pp ON pp.id = cand.id
  WHERE cand.id <> auth.uid()
    AND can_message(p_group_id, auth.uid(), cand.id) IS NOT NULL
  ORDER BY pp.role, pp.first_name, pp.last_name;
END;
$$;
GRANT EXECUTE ON FUNCTION list_message_contacts(UUID) TO authenticated;

-- ---- unread_message_count ----
CREATE OR REPLACE FUNCTION unread_message_count()
RETURNS INT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(sum((x->>'unreadCount')::int), 0)::int FROM list_conversations(NULL) AS x;
$$;
GRANT EXECUTE ON FUNCTION unread_message_count() TO authenticated;

-- ---- count_deletable_conversations ----
-- Backs the "N conversations will be permanently deleted" confirmations.
CREATE OR REPLACE FUNCTION count_deletable_conversations(p_group_id UUID, p_student_id UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (owns_group(p_group_id) OR (p_student_id IS NOT NULL AND p_student_id = auth.uid())) THEN
    RAISE EXCEPTION 'NOT_GROUP_OWNER';
  END IF;
  SELECT count(*) INTO n FROM conversations c
  WHERE c.group_id = p_group_id
    AND (p_student_id IS NULL OR p_student_id IN (c.a_id, c.b_id));
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION count_deletable_conversations(UUID, UUID) TO authenticated;
```

Note: `owns_group` is used in `count_deletable_conversations` only — an RPC that returns a number, never a message. Part A checks *policies*, not functions; keep it that way and say so in the function's comment.

- [ ] **Step 2: Append Part B**

```sql
-- ============================================================
-- PART B — RPC behaviour, owner-run with impersonated auth.uid().
-- Submit BEGIN..ROLLBACK in one go. Needs an advisor, two students and a
-- mentor profile; cases needing a second student or a mentor SKIP otherwise.
--   B1  student<->student opens as kind member
--   B2  student<->advisor opens as kind member
--   B3  student<->mentor opens as kind mentor
--   B4  mentor<->advisor refused CANNOT_MESSAGE
--   B5  send -> 1 message, 1 notification to the other side, last_message_at set
--   B6  block: blocked sender gets BLOCKED, blocker still sends
--   B7  advisor conversation: block refused CANNOT_BLOCK
--   B8  unread: 1 for the recipient, 0 after mark_conversation_read
--   B9  membership closed -> that student's conversations gone, the others remain
--   B10 mentor changed -> mentor conversation gone, member conversations remain
--   B11 archive -> zero conversations for the group
-- Expected: eleven rows, none beginning FAIL / ABORTED.
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; stu2 UUID; mentor UUID; grp UUID;
  c_ss UUID; c_sa UUID; c_sm UUID; msg UUID; n INT; m INT; log TEXT := '';
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu2 FROM profiles WHERE role = 'student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role = 'mentor' ORDER BY created_at LIMIT 1;
  IF adv IS NULL OR stu IS NULL THEN
    PERFORM set_config('probe.results', 'B1-B11' || E'\t' || 'SKIP: needs an advisor and a student' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe messages') RETURNING id INTO grp;
  UPDATE group_memberships SET left_at = now() WHERE student_id IN (stu, stu2) AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  IF stu2 IS NOT NULL THEN INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu2); END IF;
  IF mentor IS NOT NULL THEN UPDATE student_profiles SET mentor_id = mentor WHERE id = stu; END IF;

  -- B1
  BEGIN
    IF stu2 IS NULL THEN
      log := log || 'B1 student-student opens as member' || E'\t' || 'SKIP: needs a second student' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
      c_ss := open_conversation(grp, stu2);
      SELECT count(*) INTO n FROM conversations WHERE id = c_ss AND kind = 'member';
      log := log || 'B1 student-student opens as member' || E'\t' || CASE WHEN n = 1 THEN 'member' ELSE 'FAIL: ' || n END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B1 student-student opens as member' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B2
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    c_sa := open_conversation(grp, adv);
    SELECT count(*) INTO n FROM conversations WHERE id = c_sa AND kind = 'member';
    log := log || 'B2 student-advisor opens as member' || E'\t' || CASE WHEN n = 1 THEN 'member' ELSE 'FAIL: ' || n END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B2 student-advisor opens as member' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B3
  BEGIN
    IF mentor IS NULL THEN
      log := log || 'B3 student-mentor opens as mentor' || E'\t' || 'SKIP: needs a mentor profile' || E'\n';
    ELSE
      c_sm := open_conversation(grp, mentor);
      SELECT count(*) INTO n FROM conversations WHERE id = c_sm AND kind = 'mentor';
      log := log || 'B3 student-mentor opens as mentor' || E'\t' || CASE WHEN n = 1 THEN 'mentor' ELSE 'FAIL: ' || n END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B3 student-mentor opens as mentor' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B4
  BEGIN
    IF mentor IS NULL THEN
      log := log || 'B4 mentor-advisor refused' || E'\t' || 'SKIP: needs a mentor profile' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM open_conversation(grp, adv);
        log := log || 'B4 mentor-advisor refused' || E'\t' || 'FAIL: opened' || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || 'B4 mentor-advisor refused' || E'\t' || CASE WHEN SQLERRM LIKE 'CANNOT_MESSAGE%' THEN 'CANNOT_MESSAGE' ELSE 'FAIL: ' || SQLERRM END || E'\n';
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B4 mentor-advisor refused' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B5 (student -> advisor)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    DELETE FROM notifications WHERE type = 'direct_message' AND (data->>'conversationId')::uuid = c_sa;
    msg := send_message(c_sa, 'hello advisor');
    SELECT count(*) INTO n FROM messages WHERE conversation_id = c_sa;
    SELECT count(*) INTO m FROM notifications WHERE type = 'direct_message' AND user_id = adv AND (data->>'conversationId')::uuid = c_sa;
    log := log || 'B5 send writes message and notifies the other side' || E'\t'
        || CASE WHEN n = 1 AND m = 1 AND (SELECT last_message_at FROM conversations WHERE id = c_sa) IS NOT NULL
                THEN '1 message, 1 notification, last_message_at set' ELSE 'FAIL: ' || n || ' messages, ' || m || ' notifications' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B5 send writes message and notifies the other side' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B6 (student-student block)
  BEGIN
    IF stu2 IS NULL THEN
      log := log || 'B6 block stops the other side, not the blocker' || E'\t' || 'SKIP: needs a second student' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', stu2, 'role', 'authenticated')::text, true);
      PERFORM block_conversation(c_ss, true);
      PERFORM send_message(c_ss, 'blocker can still write');
      PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM send_message(c_ss, 'should be refused');
        log := log || 'B6 block stops the other side, not the blocker' || E'\t' || 'FAIL: blocked sender got through' || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || 'B6 block stops the other side, not the blocker' || E'\t'
            || CASE WHEN SQLERRM LIKE 'BLOCKED%' THEN 'BLOCKED for the blocked, sent for the blocker' ELSE 'FAIL: ' || SQLERRM END || E'\n';
      END;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', stu2, 'role', 'authenticated')::text, true);
      PERFORM block_conversation(c_ss, false);
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B6 block stops the other side, not the blocker' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B7
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM block_conversation(c_sa, true);
      log := log || 'B7 advisor conversation cannot be blocked' || E'\t' || 'FAIL: blocked' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'B7 advisor conversation cannot be blocked' || E'\t' || CASE WHEN SQLERRM LIKE 'CANNOT_BLOCK%' THEN 'CANNOT_BLOCK' ELSE 'FAIL: ' || SQLERRM END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN log := log || 'B7 advisor conversation cannot be blocked' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B8 (advisor's unread for c_sa after B5)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    SELECT (x->>'unreadCount')::int INTO n FROM list_conversations(grp) x WHERE (x->>'id')::uuid = c_sa;
    PERFORM mark_conversation_read(c_sa);
    SELECT (x->>'unreadCount')::int INTO m FROM list_conversations(grp) x WHERE (x->>'id')::uuid = c_sa;
    log := log || 'B8 unread count then read' || E'\t' || CASE WHEN n = 1 AND m = 0 THEN '1 then 0' ELSE 'FAIL: ' || n || ' then ' || m END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B8 unread count then read' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B9 (stu2 leaves)
  BEGIN
    IF stu2 IS NULL THEN
      log := log || 'B9 leaving deletes that student conversations only' || E'\t' || 'SKIP: needs a second student' || E'\n';
    ELSE
      UPDATE group_memberships SET left_at = now() WHERE group_id = grp AND student_id = stu2;
      SELECT count(*) INTO n FROM conversations WHERE id = c_ss;
      SELECT count(*) INTO m FROM conversations WHERE id = c_sa;
      log := log || 'B9 leaving deletes that student conversations only' || E'\t' || CASE WHEN n = 0 AND m = 1 THEN 'gone, other kept' ELSE 'FAIL: ' || n || ' / ' || m END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B9 leaving deletes that student conversations only' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B10 (mentor changed)
  BEGIN
    IF mentor IS NULL THEN
      log := log || 'B10 mentor change deletes the mentor conversation' || E'\t' || 'SKIP: needs a mentor profile' || E'\n';
    ELSE
      UPDATE student_profiles SET mentor_id = NULL WHERE id = stu;
      SELECT count(*) INTO n FROM conversations WHERE id = c_sm;
      SELECT count(*) INTO m FROM conversations WHERE id = c_sa;
      log := log || 'B10 mentor change deletes the mentor conversation' || E'\t' || CASE WHEN n = 0 AND m = 1 THEN 'gone, member kept' ELSE 'FAIL: ' || n || ' / ' || m END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B10 mentor change deletes the mentor conversation' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B11 (archive)
  BEGIN
    UPDATE internship_groups SET is_archived = true WHERE id = grp;
    SELECT count(*) INTO n FROM conversations WHERE group_id = grp;
    log := log || 'B11 archive deletes every conversation' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: ' || n END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B11 archive deletes every conversation' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;
```

- [ ] **Step 3: Append Part C**

```sql
-- ============================================================
-- PART C — the policies, actually evaluated. Submit BEGIN..ROLLBACK in one go.
--   C1 participant reads own conversation and message      1 / 1   (positive control)
--   C2 THE ADVISOR reads two students' conversation         0 rows  (the reason this feature exists)
--   C3 the advisor reads their message                      0 rows
--   C4 a student of another group reads it                  0 rows
--   C5 non-participant send_message                         CONVERSATION_NOT_FOUND
--   C6 after the membership is closed, the former participant  0 rows (and list_conversations empty)
-- C2-C4 need a second student; they SKIP otherwise.
-- ============================================================
BEGIN;

DO $$
DECLARE adv UUID; stu UUID; stu2 UUID; stuB UUID; grp UUID; grpB UUID; c UUID; msg UUID;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu2 FROM profiles WHERE role = 'student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT id INTO stuB FROM profiles WHERE role = 'student' AND id NOT IN (stu, coalesce(stu2, stu)) ORDER BY created_at LIMIT 1;
  IF adv IS NULL OR stu IS NULL THEN PERFORM set_config('probe.ready', 'no', true); RETURN; END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe messages A') RETURNING id INTO grp;
  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe messages B') RETURNING id INTO grpB;
  UPDATE group_memberships SET left_at = now() WHERE student_id IN (stu, stu2, stuB) AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  IF stu2 IS NOT NULL THEN INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu2); END IF;
  IF stuB IS NOT NULL THEN INSERT INTO group_memberships (group_id, student_id) VALUES (grpB, stuB); END IF;

  -- The conversation under test: stu <-> stu2 when possible, else stu <-> adv.
  IF stu2 IS NOT NULL THEN
    INSERT INTO conversations (group_id, kind, a_id, b_id) VALUES (grp, 'member', LEAST(stu, stu2), GREATEST(stu, stu2)) RETURNING id INTO c;
  ELSE
    INSERT INTO conversations (group_id, kind, a_id, b_id) VALUES (grp, 'member', LEAST(stu, adv), GREATEST(stu, adv)) RETURNING id INTO c;
  END IF;
  INSERT INTO messages (conversation_id, sender_id, body) VALUES (c, stu, 'private') RETURNING id INTO msg;

  PERFORM set_config('probe.ready', 'yes', true);
  PERFORM set_config('probe.adv', adv::text, true);
  PERFORM set_config('probe.stu', stu::text, true);
  PERFORM set_config('probe.stu2', coalesce(stu2::text, ''), true);
  PERFORM set_config('probe.stuB', coalesce(stuB::text, ''), true);
  PERFORM set_config('probe.grp', grp::text, true);
  PERFORM set_config('probe.c', c::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE adv UUID; stu UUID; stu2 UUID; stuB UUID; c UUID; n INT; m INT; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results', 'C1-C6' || E'\t' || 'SKIP: needs an advisor and a student' || E'\n', true); RETURN;
  END IF;
  adv := current_setting('probe.adv')::uuid; stu := current_setting('probe.stu')::uuid;
  stu2 := NULLIF(current_setting('probe.stu2'), '')::uuid; stuB := NULLIF(current_setting('probe.stuB'), '')::uuid;
  c := current_setting('probe.c')::uuid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM conversations WHERE id = c;
    SELECT count(*) INTO m FROM messages WHERE conversation_id = c;
    log := log || 'C1 participant reads own conversation and message' || E'\t' || CASE WHEN n = 1 AND m = 1 THEN '1 / 1' ELSE 'FAIL: ' || n || ' / ' || m END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C1 participant reads own conversation and message' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;

  IF stu2 IS NULL THEN
    log := log || 'C2 THE ADVISOR reads two students conversation' || E'\t' || 'SKIP: needs a second student' || E'\n';
    log := log || 'C3 the advisor reads their message' || E'\t' || 'SKIP: needs a second student' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO n FROM conversations WHERE id = c;
      log := log || 'C2 THE ADVISOR reads two students conversation' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: the advisor can see it' END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C2 THE ADVISOR reads two students conversation' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
    BEGIN
      SELECT count(*) INTO n FROM messages WHERE conversation_id = c;
      log := log || 'C3 the advisor reads their message' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: the advisor can read it' END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C3 the advisor reads their message' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
  END IF;

  IF stuB IS NULL THEN
    log := log || 'C4 student of another group reads it' || E'\t' || 'SKIP: needs a third student' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stuB, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO n FROM messages WHERE conversation_id = c;
      log := log || 'C4 student of another group reads it' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: leaked' END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C4 student of another group reads it' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM send_message(c, 'intruder');
    log := log || 'C5 non-participant send_message' || E'\t' || CASE WHEN stu2 IS NULL THEN 'n/a: the advisor is a participant here' ELSE 'FAIL: sent' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C5 non-participant send_message' || E'\t' || CASE WHEN SQLERRM LIKE 'CONVERSATION_NOT_FOUND%' THEN 'CONVERSATION_NOT_FOUND' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

RESET ROLE;
-- C6: close stu's membership as owner, then read as stu.
DO $$
DECLARE stu UUID; grp UUID;
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  stu := current_setting('probe.stu')::uuid; grp := current_setting('probe.grp')::uuid;
  UPDATE group_memberships SET left_at = now() WHERE group_id = grp AND student_id = stu;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE stu UUID; c UUID; n INT; m INT; log TEXT;
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  stu := current_setting('probe.stu')::uuid; c := current_setting('probe.c')::uuid;
  log := current_setting('probe.results', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM messages WHERE conversation_id = c;
    SELECT count(*) INTO m FROM list_conversations(NULL);
    log := log || 'C6 former participant after leaving' || E'\t' || CASE WHEN n = 0 AND m = 0 THEN '0 rows, list empty' ELSE 'FAIL: ' || n || ' rows, ' || m || ' listed' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C6 former participant after leaving' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
  PERFORM set_config('probe.results', log, true);
END $$;
RESET ROLE;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;
```

- [ ] **Step 4: Lint and commit**

Even `$$` counts in both files, then:
```bash
git add docs/direct-messages-rpcs.sql docs/direct-messages-verification.sql
git commit -m "feat(messages): RPCs and verification Parts B / C

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand the three files to the user**, in order, one per message; Part B eleven rows, Part C six rows. C2 is the row that matters: it must read `0 rows`.

---

### Task 3: Client foundation — types, service, error codes, routes, helpers

**Files:**
- Create: `src/types/messages.ts`, `src/services/messages.ts`, `src/utils/messageHelpers.ts`, `src/utils/__tests__/messageHelpers.test.ts`
- Modify: `src/utils/rpcErrors.ts`, `src/types/notification.ts`, `src/utils/notificationRoutes.ts`, `src/utils/__tests__/notificationRoutes.test.ts`, `src/components/screens/NotificationsScreen.tsx` (icon map), `src/i18n/locales/en.json` (if clean — see Global Constraints)

**Interfaces:**
- Consumes: Task 2's RPC shapes; `RpcError` from `src/services/rpcError.ts` (services import it as `./rpcError`); `mapRpcError` from `@/utils/rpcErrors`.
- Produces: `messageService.{listConversations, listMessages, listContacts, openConversation, sendMessage, markRead, setBlocked, unreadCount, countDeletable}`; `previewText(body, max)`, `dayGroups(messages, locale)`; `routeForNotification('direct_message', {conversationId}, role)` → `/(role)/conversation?id=`.

- [ ] **Step 1: Types**

```ts
// src/types/messages.ts
export type ConversationKind = 'member' | 'mentor';

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  groupId: string;
  groupName: string;
  otherId: string;
  otherName: string;
  otherRole: 'student' | 'mentor' | 'advisor' | string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unreadCount: number;
  blockedByMe: boolean;
  /** The other side has blocked me: I can read, I cannot send. */
  blockedMe: boolean;
}

export interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface MessageContact {
  id: string;
  name: string;
  role: string;
}
```

- [ ] **Step 2: Failing tests for the helpers**

```ts
// src/utils/__tests__/messageHelpers.test.ts
import { previewText, dayGroups } from '@/utils/messageHelpers';

describe('previewText', () => {
  it('collapses whitespace and newlines to single spaces', () => {
    expect(previewText('hi\n\nthere   you', 80)).toBe('hi there you');
  });
  it('cuts at the limit with an ellipsis, never mid-surrogate', () => {
    expect(previewText('a'.repeat(100), 10)).toBe('aaaaaaaaa…');
    expect(previewText('😀😀😀😀', 3)).toBe('😀😀…');
  });
  it('returns the text unchanged when it fits', () => {
    expect(previewText('short', 80)).toBe('short');
  });
});

describe('dayGroups', () => {
  const m = (id: string, iso: string) => ({ id, senderId: 's', body: id, createdAt: iso });
  it('groups consecutive messages by local calendar day, oldest first', () => {
    const groups = dayGroups([m('a', '2026-09-12T23:30:00+03:00'), m('b', '2026-09-13T00:10:00+03:00'), m('c', '2026-09-13T09:00:00+03:00')], 'en');
    expect(groups.map((g) => g.messages.map((x) => x.id))).toEqual([['a'], ['b', 'c']]);
    expect(groups[0].label).not.toBe(groups[1].label);
  });
  it('returns no groups for no messages', () => {
    expect(dayGroups([], 'en')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to see it fail** — `npx jest src/utils/__tests__/messageHelpers.test.ts` → cannot find module.

- [ ] **Step 4: Implement**

```ts
// src/utils/messageHelpers.ts
import type { Message } from '@/types/messages';

/** One-line preview for the conversation list. Counts code points, not
 *  UTF-16 units, so an emoji is never split. */
export function previewText(body: string, max: number): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return chars.slice(0, Math.max(0, max - 1)).join('') + '…';
}

export interface DayGroup { key: string; label: string; messages: Message[] }

/** Messages (any order in) → groups by LOCAL calendar day, oldest first,
 *  each labelled with the locale's date. */
export function dayGroups(messages: Message[], locale: string): DayGroup[] {
  const sorted = [...messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out: DayGroup[] = [];
  for (const msg of sorted) {
    const d = new Date(msg.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.messages.push(msg);
    else out.push({ key, label: d.toLocaleDateString(locale), messages: [msg] });
  }
  return out;
}
```

- [ ] **Step 5: Run to see it pass** — 5 tests.

- [ ] **Step 6: Error codes, notification type, routes**

`src/utils/rpcErrors.ts` `ERROR_KEYS` gains:
```ts
  CANNOT_MESSAGE: 'errors.cannotMessage',
  CONVERSATION_NOT_FOUND: 'errors.conversationNotFound',
  BLOCKED: 'errors.blocked',
  MESSAGE_EMPTY: 'errors.messageEmpty',
  CANNOT_BLOCK: 'errors.cannotBlock',
```
`src/types/notification.ts`: add `| 'direct_message'`. `NotificationsScreen.tsx` icon map: `direct_message: { name: 'chatbubble-ellipses-outline', color: colors.primary }` (or the map's shape). `src/utils/notificationRoutes.ts`: in ALL THREE role switches add
```ts
        case 'direct_message': {
          const id = str(data?.conversationId);
          return id ? { pathname: '/(student)/conversation', params: { id } } : { pathname: '/(student)/messages' };
        }
```
with the role's own group in the pathname. Test (append to the existing file):
```ts
  it('sends a direct message to the conversation for every role', () => {
    for (const role of ['student', 'mentor', 'advisor'] as const) {
      expect(routeForNotification('direct_message', { conversationId: 'c1' }, role)).toEqual({
        pathname: `/(${role})/conversation`, params: { id: 'c1' },
      });
      expect(routeForNotification('direct_message', {}, role)?.pathname).toBe(`/(${role})/messages`);
    }
  });
```

- [ ] **Step 7: Service**

```ts
// src/services/messages.ts
import { supabase } from './supabase';
import { RpcError } from './rpcError';
import type { ConversationSummary, Message, MessageContact } from '@/types/messages';

export const MESSAGES_PAGE_SIZE = 50;

function toSummary(r: Record<string, unknown>): ConversationSummary {
  return {
    id: r.id as string,
    kind: r.kind as ConversationSummary['kind'],
    groupId: r.groupId as string,
    groupName: (r.groupName as string) || '',
    otherId: r.otherId as string,
    otherName: (r.otherName as string) || '',
    otherRole: (r.otherRole as string) || '',
    lastMessageAt: (r.lastMessageAt as string) || undefined,
    lastMessagePreview: (r.lastMessagePreview as string) || undefined,
    unreadCount: Number(r.unreadCount) || 0,
    blockedByMe: !!r.blockedByMe,
    blockedMe: !!r.blockedMe,
  };
}

function toMessage(r: Record<string, unknown>): Message {
  return { id: r.id as string, senderId: r.senderId as string, body: (r.body as string) || '', createdAt: r.createdAt as string };
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new RpcError(error.message);
  return data as T;
}

export const messageService = {
  listConversations: async (groupId?: string) =>
    ((await rpc<Array<Record<string, unknown>>>('list_conversations', { p_group_id: groupId ?? null })) || []).map(toSummary),
  /** Newest first from the server; returned oldest first for rendering. */
  listMessages: async (conversationId: string, before?: string) =>
    ((await rpc<Array<Record<string, unknown>>>('list_messages', { p_conversation_id: conversationId, p_before: before ?? null, p_limit: MESSAGES_PAGE_SIZE })) || []).map(toMessage).reverse(),
  listContacts: async (groupId: string): Promise<MessageContact[]> =>
    ((await rpc<Array<Record<string, unknown>>>('list_message_contacts', { p_group_id: groupId })) || []).map((r) => ({ id: r.id as string, name: (r.name as string) || '', role: (r.role as string) || '' })),
  openConversation: (groupId: string, otherId: string) => rpc<string>('open_conversation', { p_group_id: groupId, p_other_id: otherId }),
  sendMessage: (conversationId: string, body: string) => rpc<string>('send_message', { p_conversation_id: conversationId, p_body: body }),
  markRead: (conversationId: string) => rpc<void>('mark_conversation_read', { p_conversation_id: conversationId }),
  setBlocked: (conversationId: string, block: boolean) => rpc<void>('block_conversation', { p_conversation_id: conversationId, p_block: block }),
  unreadCount: async () => Number(await rpc<number>('unread_message_count', {})) || 0,
  countDeletable: (groupId: string, studentId?: string) => rpc<number>('count_deletable_conversations', { p_group_id: groupId, p_student_id: studentId ?? null }),
};
```

- [ ] **Step 8: i18n** — if `en.json` is clean, add under `errors`: `cannotMessage: "You can't message this person."`, `conversationNotFound: "This conversation is no longer available."`, `blocked: "You can't message this person."`, `messageEmpty: "Write a message first."`, `cannotBlock: "Conversations with your advisor can't be blocked."`; under `tabs`: `messages: "Messages"`; and a top-level `messages` block:
```json
"messages": {
  "title": "Messages", "empty": "No messages yet.", "newMessage": "New message",
  "pickContact": "Who do you want to message?", "noContacts": "Nobody to message in this group yet.",
  "placeholder": "Write a message…", "send": "Send",
  "blocked": "You can't message this person.", "block": "Block", "unblock": "Unblock",
  "blockConfirm": "{{name}} will no longer be able to message you. You keep the conversation.",
  "lifetimeNote": "Messages are deleted when the group is archived or when someone leaves it.",
  "gone": "This conversation is no longer available.",
  "roleStudent": "Student", "roleMentor": "Mentor", "roleAdvisor": "Advisor",
  "deleteWarning_one": "{{count}} conversation and its messages will be permanently deleted.",
  "deleteWarning_other": "{{count}} conversations and their messages will be permanently deleted."
}
```
If `en.json` is NOT clean, skip this step and note it; Tasks 4–6 then use `t(key, 'Default')` with these exact texts.

- [ ] **Step 9: Gates and commit** — tsc silent; jest baseline + 1 suite / + 6 tests (5 helper + 1 routes).
```bash
git add src/types/messages.ts src/services/messages.ts src/utils/messageHelpers.ts src/utils/__tests__/messageHelpers.test.ts src/utils/rpcErrors.ts src/types/notification.ts src/utils/notificationRoutes.ts src/utils/__tests__/notificationRoutes.test.ts src/components/screens/NotificationsScreen.tsx
# plus src/i18n/locales/en.json only if Step 8 ran
git commit -m "feat(messages): client types, service, error codes, routes and helpers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Screens — conversation list, contact picker, conversation, routes, tabs

**Files:**
- Create: `src/components/messages/ConversationList.tsx`, `src/components/messages/ContactPicker.tsx`, `src/components/messages/MessageBubble.tsx`, `src/components/messages/index.ts`, `src/components/screens/MessagesScreen.tsx`, `src/components/screens/ConversationScreen.tsx`, six route files under `app/(student|mentor|advisor)/{messages,conversation}.tsx`
- Modify: the three `_layout.tsx` files

**Interfaces:**
- Consumes: `messageService`, `previewText`, `dayGroups`, `useRealtimeSubscription`, `LoadFailedBanner`, `mapRpcError`, `groupService.listMyGroups` / `getMyGroup`, `useAuthStore`.
- Produces: `MessagesScreen({ role })`, `ConversationScreen({ role })` reading `?id=`.

- [ ] **Step 1: `MessageBubble`**

```tsx
// src/components/messages/MessageBubble.tsx
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius } from '@/theme';
import type { Message } from '@/types/messages';

export function MessageBubble({ message, mine, locale }: { message: Message; mine: boolean; locale: string }) {
  const time = new Date(message.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
        <Text style={[styles.body, mine && styles.bodyMine]}>{message.body}</Text>
        <Text style={[styles.time, mine && styles.timeMine]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.lg },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.divider },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  bodyMine: { color: '#fff' },
  time: { fontSize: 11, color: colors.textSecondary, marginTop: 2, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.8)' },
});
```

- [ ] **Step 2: `ConversationList`**

```tsx
// src/components/messages/ConversationList.tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '@/theme';
import type { ConversationSummary } from '@/types/messages';

function roleLabel(role: string, t: (k: string, d?: string) => string): string {
  if (role === 'advisor') return t('messages.roleAdvisor', 'Advisor');
  if (role === 'mentor') return t('messages.roleMentor', 'Mentor');
  return t('messages.roleStudent', 'Student');
}

export function ConversationRow({ item, onPress, locale }: { item: ConversationSummary; onPress: () => void; locale: string }) {
  const { t } = useTranslation();
  const when = item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleDateString(locale) : '';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{item.otherName.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}</Text></View>
      <View style={{ flex: 1 }}>
        <View style={styles.top}>
          <Text style={[styles.name, item.unreadCount > 0 && styles.nameUnread]} numberOfLines={1}>{item.otherName}</Text>
          <Text style={styles.when}>{when}</Text>
        </View>
        <Text style={styles.meta}>{roleLabel(item.otherRole, t)} · {item.groupName}</Text>
        {!!item.lastMessagePreview && <Text style={[styles.preview, item.unreadCount > 0 && styles.previewUnread]} numberOfLines={1}>{item.lastMessagePreview}</Text>}
      </View>
      {item.unreadCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + '20', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, fontSize: 15, color: colors.text },
  nameUnread: { fontWeight: '700' },
  when: { fontSize: 11, color: colors.textSecondary },
  meta: { fontSize: 12, color: colors.textSecondary },
  preview: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  previewUnread: { color: colors.text, fontWeight: '500' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', marginTop: 60, gap: spacing.sm },
  emptyText: { fontSize: 14, color: colors.textSecondary },
  note: { fontSize: 12, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.sm, marginBottom: spacing.sm },
});
export const conversationListStyles = styles;
```

- [ ] **Step 3: `ContactPicker`** (a modal listing `MessageContact[]`, grouped label per role, tap → `onPick(contact)`):

```tsx
// src/components/messages/ContactPicker.tsx
import { Modal, View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';
import type { MessageContact } from '@/types/messages';

interface Props { visible: boolean; contacts: MessageContact[] | null; onPick: (c: MessageContact) => void; onClose: () => void }

export function ContactPicker({ visible, contacts, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const label = (role: string) => role === 'advisor' ? t('messages.roleAdvisor', 'Advisor') : role === 'mentor' ? t('messages.roleMentor', 'Mentor') : t('messages.roleStudent', 'Student');
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
          <Text style={styles.title}>{t('messages.pickContact', 'Who do you want to message?')}</Text>
          <View style={{ width: 24 }} />
        </View>
        {contacts === null ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={contacts}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>{t('messages.noContacts', 'Nobody to message in this group yet.')}</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => onPick(item)} activeOpacity={0.7}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.role}>{label(item.role)}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  list: { paddingHorizontal: spacing.lg },
  row: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  name: { fontSize: 15, color: colors.text },
  role: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: 40 },
});
```

- [ ] **Step 4: `index.ts`** exporting the three.

- [ ] **Step 5: `MessagesScreen`**

```tsx
// src/components/screens/MessagesScreen.tsx
import { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { messageService } from '@/services/messages';
import { groupService } from '@/services/group';
import { mapRpcError } from '@/utils/rpcErrors';
import { LoadFailedBanner } from '@/components/common';
import { ConversationRow, conversationListStyles, ContactPicker } from '@/components/messages';
import { colors, spacing, borderRadius } from '@/theme';
import type { ConversationSummary, MessageContact } from '@/types/messages';

interface Props { role: 'student' | 'mentor' | 'advisor' }
interface GroupChoice { id: string; name: string; isArchived?: boolean }

export function MessagesScreen({ role }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [groups, setGroups] = useState<GroupChoice[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [picker, setPicker] = useState(false);
  const [contacts, setContacts] = useState<MessageContact[] | null>(null);
  const request = useRef(0);

  // Which group a NEW conversation is opened in. Student: their active
  // group. Advisor: the selected chip. Mentor: the group of the student they
  // pick -- resolved in the picker (see openWith) because a mentor's
  // students may sit in different groups.
  const loadGroups = useCallback(async () => {
    if (!user) return;
    try {
      if (role === 'advisor') {
        const list = await groupService.listMyGroups(user.id);
        const choices = list.map((g) => ({ id: g.id, name: g.name, isArchived: g.isArchived }));
        setGroups(choices);
        setGroupId((cur) => (cur && choices.some((g) => g.id === cur) ? cur : (choices.find((g) => !g.isArchived) ?? choices[0])?.id ?? null));
      } else if (role === 'student') {
        const g = await groupService.getMyGroup(user.id);
        setGroups(g ? [{ id: g.id, name: g.name }] : []);
        setGroupId(g?.id ?? null);
      }
    } catch (err) {
      console.error('Messages groups load error:', err);
      setLoadFailed(true);
    }
  }, [user, role]);

  const load = useCallback(async () => {
    const req = ++request.current;
    setLoadFailed(false);
    try {
      // The list is always ALL of my conversations; the advisor's chip only
      // decides where a new one is opened.
      const list = await messageService.listConversations();
      if (req !== request.current) return;
      setItems(list);
    } catch (err) {
      if (req !== request.current) return;
      console.error('Messages load error:', err);
      setLoadFailed(true);
    } finally {
      if (req === request.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadGroups(); load(); }, [loadGroups, load]));

  const onRefresh = useCallback(async () => { setRefreshing(true); await loadGroups(); await load(); setRefreshing(false); }, [loadGroups, load]);

  async function openPicker() {
    setPicker(true);
    setContacts(null);
    try {
      if (role === 'mentor') {
        // A mentor's contacts are their linked students, each in their own
        // group. list_message_contacts is per group, so ask per student's
        // group: read the mentor's students, resolve each student's group.
        const students = await groupService.listMentorStudentGroups(user!.id);
        setContacts(students);
      } else if (groupId) {
        setContacts(await messageService.listContacts(groupId));
      } else {
        setContacts([]);
      }
    } catch (err) {
      console.warn('Contacts load failed:', err instanceof Error ? err.message : err);
      setContacts([]);
    }
  }

  async function openWith(contact: MessageContact & { groupId?: string }) {
    const gid = contact.groupId ?? groupId;
    if (!gid) return;
    try {
      const id = await messageService.openConversation(gid, contact.id);
      setPicker(false);
      router.push({ pathname: `/(${role})/conversation`, params: { id } } as never);
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    }
  }

  if (!user) return null;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t('messages.title', 'Messages')}</Text>
        <TouchableOpacity style={styles.newBtn} onPress={openPicker} activeOpacity={0.7}>
          <Ionicons name="create-outline" size={18} color={colors.primary} />
          <Text style={styles.newText}>{t('messages.newMessage', 'New message')}</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ConversationRow item={item} locale={i18n.language} onPress={() => router.push({ pathname: `/(${role})/conversation`, params: { id: item.id } } as never)} />}
        ListHeaderComponent={
          <View>
            {loadFailed && <LoadFailedBanner onRetry={() => { loadGroups(); load(); }} />}
            <Text style={conversationListStyles.note}>{t('messages.lifetimeNote', 'Messages are deleted when the group is archived or when someone leaves it.')}</Text>
            {role === 'advisor' && groups.length > 1 && (
              <View style={styles.chipRow}>
                {groups.map((g) => (
                  <TouchableOpacity key={g.id} style={[styles.chip, g.id === groupId && styles.chipActive, g.isArchived && { opacity: 0.6 }]} onPress={() => setGroupId(g.id)} activeOpacity={0.7}>
                    <Text style={[styles.chipText, g.id === groupId && styles.chipTextActive]} numberOfLines={1}>{g.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={loading ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} /> : (
          <View style={conversationListStyles.empty}>
            <Ionicons name="chatbubbles-outline" size={48} color={colors.textDisabled} />
            <Text style={conversationListStyles.emptyText}>{t('messages.empty', 'No messages yet.')}</Text>
          </View>
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
      />
      <ContactPicker visible={picker} contacts={contacts} onPick={openWith} onClose={() => setPicker(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: borderRadius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, maxWidth: 160 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
});
```

**The mentor's contacts** need a helper that does not exist yet: add to `src/services/group.ts`
```ts
  /** For a mentor: each linked student who is an active member of a group,
   *  with that group's id -- a mentor's students may sit in different groups,
   *  and a conversation is opened in the student's group. */
  async listMentorStudentGroups(mentorId: string): Promise<Array<{ id: string; name: string; role: string; groupId: string }>> {
    const { data, error } = await supabase
      .from('student_profiles')
      .select('id, profiles_public!inner(first_name, last_name), group_memberships!inner(group_id, left_at)')
      .eq('mentor_id', mentorId)
      .is('group_memberships.left_at', null);
    if (error) throw error;
    return (data || []).map((r) => {
      const row = r as Record<string, unknown>;
      const p = row.profiles_public as Record<string, unknown> | null;
      const m = (row.group_memberships as Array<Record<string, unknown>>)[0];
      return { id: row.id as string, name: `${(p?.first_name as string) || ''} ${(p?.last_name as string) || ''}`.trim(), role: 'student', groupId: m?.group_id as string };
    });
  },
```
The embed names depend on the FKs PostgREST can see: `student_profiles.id → profiles(id)` and `profiles_public.id → profiles(id)` do NOT give a direct `student_profiles → profiles_public` relationship. If PostgREST refuses the embed, do it in two queries: (1) `student_profiles.select('id').eq('mentor_id', me)`, (2) `group_memberships.select('student_id, group_id').in('student_id', ids).is('left_at', null)`, (3) `profiles_public.select('id, first_name, last_name').in('id', ids)`. Write whichever works; say which in the report.

- [ ] **Step 6: `ConversationScreen`**

```tsx
// src/components/screens/ConversationScreen.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { messageService, MESSAGES_PAGE_SIZE } from '@/services/messages';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { mapRpcError } from '@/utils/rpcErrors';
import { dayGroups } from '@/utils/messageHelpers';
import { LoadFailedBanner } from '@/components/common';
import { MessageBubble } from '@/components/messages';
import { colors, spacing, borderRadius } from '@/theme';
import type { ConversationSummary, Message } from '@/types/messages';

interface Props { role: 'student' | 'mentor' | 'advisor' }
const BODY_MAX = 2000;

export function ConversationScreen({ role }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const user = useAuthStore((s) => s.user);
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const focused = useRef(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    const req = ++request.current;
    setLoadFailed(false);
    try {
      const [all, page] = await Promise.all([messageService.listConversations(), messageService.listMessages(id)]);
      if (req !== request.current) return;
      const mine = all.find((c) => c.id === id) ?? null;
      if (!mine) {
        // Deleted under us (membership closed, group archived) or never ours.
        Alert.alert(t('common.error'), t('messages.gone', 'This conversation is no longer available.'));
        router.back();
        return;
      }
      setSummary(mine);
      setMessages(page);
      setHasMore(page.length === MESSAGES_PAGE_SIZE);
      await messageService.markRead(id);
    } catch (err) {
      if (req !== request.current) return;
      const { code } = mapRpcError(err instanceof Error ? err.message : '');
      if (code === 'CONVERSATION_NOT_FOUND') {
        Alert.alert(t('common.error'), t('messages.gone', 'This conversation is no longer available.'));
        router.back();
        return;
      }
      console.error('Conversation load error:', err);
      setLoadFailed(true);
    } finally {
      if (req === request.current) setLoading(false);
    }
  }, [id, router, t]);

  useFocusEffect(useCallback(() => { focused.current = true; load(); return () => { focused.current = false; }; }, [load]));

  // New rows arrive by realtime; RLS decides delivery (a non-participant
  // never receives them). The payload carries the row, and a message row
  // needs no signing or joining, so it is appended directly.
  useRealtimeSubscription({
    table: 'messages',
    event: 'INSERT',
    filter: id ? `conversation_id=eq.${id}` : undefined,
    enabled: !!id,
    onPayload: (payload) => {
      const row = (payload as { new?: Record<string, unknown> }).new;
      if (!row?.id) return;
      const incoming: Message = { id: row.id as string, senderId: row.sender_id as string, body: (row.body as string) || '', createdAt: row.created_at as string };
      setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
      if (focused.current && id && incoming.senderId !== user?.id) messageService.markRead(id).catch(() => undefined);
    },
  });

  async function loadMore() {
    if (!id || !hasMore || messages.length === 0) return;
    try {
      const older = await messageService.listMessages(id, messages[0].createdAt);
      const seen = new Set(messages.map((m) => m.id));
      setMessages((prev) => [...older.filter((m) => !seen.has(m.id)), ...prev]);
      setHasMore(older.length === MESSAGES_PAGE_SIZE);
    } catch (err) {
      console.warn('Older messages load failed:', err instanceof Error ? err.message : err);
    }
  }

  async function send() {
    const body = text.trim();
    if (!id || !body || sending) return;
    setSending(true);
    try {
      await messageService.sendMessage(id, body);
      setText('');
      // The realtime INSERT appends it; if realtime is late, the next load will.
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setSending(false);
    }
  }

  function toggleBlock() {
    if (!summary || !id) return;
    const block = !summary.blockedByMe;
    const doIt = async () => {
      try {
        await messageService.setBlocked(id, block);
        setSummary({ ...summary, blockedByMe: block });
      } catch (err) {
        const { key } = mapRpcError(err instanceof Error ? err.message : '');
        Alert.alert(t('common.error'), t(key));
      }
    };
    if (!block) { void doIt(); return; }
    Alert.alert(t('messages.block', 'Block'), t('messages.blockConfirm', '{{name}} will no longer be able to message you. You keep the conversation.', { name: summary.otherName }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('messages.block', 'Block'), style: 'destructive', onPress: () => void doIt() },
    ]);
  }

  const canBlock = summary && summary.otherRole !== 'advisor' && role !== 'advisor';
  const groups = dayGroups(messages, i18n.language);
  const flat = groups.flatMap((g) => [{ type: 'day' as const, key: g.key, label: g.label }, ...g.messages.map((m) => ({ type: 'msg' as const, key: m.id, message: m }))]);

  if (!user) return null;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}><Ionicons name="chevron-back" size={26} color={colors.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{summary?.otherName ?? ''}</Text>
          {!!summary && <Text style={styles.meta} numberOfLines={1}>{summary.groupName}</Text>}
        </View>
        {canBlock && (
          <TouchableOpacity onPress={toggleBlock} hitSlop={8}>
            <Text style={styles.blockText}>{summary?.blockedByMe ? t('messages.unblock', 'Unblock') : t('messages.block', 'Block')}</Text>
          </TouchableOpacity>
        )}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loadFailed && <View style={{ paddingHorizontal: spacing.lg }}><LoadFailedBanner onRetry={load} /></View>}
        {loading ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={flat}
            keyExtractor={(x) => x.key}
            renderItem={({ item }) => item.type === 'day'
              ? <Text style={styles.day}>{item.label}</Text>
              : <MessageBubble message={item.message} mine={item.message.senderId === user.id} locale={i18n.language} />}
            contentContainerStyle={styles.list}
            onStartReached={loadMore}
            onStartReachedThreshold={0.2}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          />
        )}
        {summary?.blockedMe ? (
          <View style={styles.blockedBar}><Text style={styles.blockedText}>{t('messages.blocked', "You can't message this person.")}</Text></View>
        ) : (
          <View style={styles.inputRow}>
            <TextInput style={styles.input} placeholder={t('messages.placeholder', 'Write a message…')} placeholderTextColor={colors.textSecondary} value={text} onChangeText={(v) => setText(v.slice(0, BODY_MAX))} multiline editable={!sending} />
            <TouchableOpacity onPress={send} disabled={sending || !text.trim()} hitSlop={8} accessibilityLabel={t('messages.send', 'Send')}>
              {sending ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="send" size={22} color={text.trim() ? colors.primary : colors.textDisabled} />}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textSecondary },
  blockText: { fontSize: 14, fontWeight: '600', color: colors.error },
  list: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  day: { alignSelf: 'center', fontSize: 11, color: colors.textSecondary, marginVertical: spacing.sm },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  input: { flex: 1, maxHeight: 120, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: 8 },
  blockedBar: { padding: spacing.md, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.divider },
  blockedText: { fontSize: 13, color: colors.textSecondary },
});
```
`mapRpcError` returns `{ code, key }` — confirm the field is named `code` in `src/utils/rpcErrors.ts` (it is: `RpcErrorInfo.code`). If `onStartReached` is not typed in this RN version, drop it and load older messages with a "Load earlier" pressable at the top instead.

- [ ] **Step 7: Routes and tabs**

Six route files, each three lines, e.g. `app/(student)/messages.tsx`: `import { MessagesScreen } from '@/components/screens/MessagesScreen'; export default function StudentMessagesScreen() { return <MessagesScreen role="student" />; }` and `app/(student)/conversation.tsx` likewise with `ConversationScreen`. Same for mentor and advisor.

In each `_layout.tsx`: add a visible `<Tabs.Screen name="messages" options={{ title: t('tabs.messages', 'Messages'), tabBarIcon: … 'chatbubbles-outline', tabBarBadge: unreadMessages > 0 ? (unreadMessages > 99 ? '99+' : unreadMessages) : undefined }} />` where `unreadMessages` is state loaded via `messageService.unreadCount()` on mount and on every focus of the tab navigator (a `useFocusEffect` in the layout is not available — use the existing pattern: the mentor layout already computes `pendingCount`; read how it refreshes and follow it), and a hidden `<Tabs.Screen name="conversation" options={{ href: null, tabBarStyle: { display: 'none' } }} />`. Place the messages tab where the current bar reads naturally (before `profile`). Report the resulting visible-tab counts.

- [ ] **Step 8: Gates and commit**

tsc silent; jest unchanged from Task 3's number. Stage the created files, the three layouts, and `src/services/group.ts`. Commit `feat(messages): conversations, contact picker, conversation screen, tabs`.

---

### Task 5: Unread badge freshness and notification wiring

**Files:**
- Modify: the three `_layout.tsx` (if Task 4 left the badge on mount-only), `src/store/notificationStore.ts` (optional realtime hook) — **decide in this task, do not touch `notificationStore` if a layout-level realtime subscription on `messages` suffices.**

- [ ] **Step 1:** In each layout, subscribe with `useRealtimeSubscription({ table: 'messages', event: 'INSERT', enabled: !!user, onPayload: () => refreshUnread() })` — RLS delivers only rows in the user's conversations, so every event is relevant. Also refresh on `direct_message` notification arrival if the notification store exposes a hook; otherwise the tab-focus refresh from Task 4 is enough.
- [ ] **Step 2:** Confirm `routeForNotification('direct_message', …)` from Task 3 opens the conversation from both the push tap handler (`app/_layout.tsx`, which already delegates to it) and the in-app notifications list.
- [ ] **Step 3:** tsc / jest; commit `feat(messages): live unread badge`.

---

### Task 6: Deletion warnings on archive and remove-member

**Files:**
- Modify: `src/components/advisor/GroupCenter.tsx` (`confirmArchive`), `app/(advisor)/student-monitor.tsx` (`confirmRemove`)

These two files belong to the parallel Codex session. Before editing, `git status --porcelain` them: if either is modified/uncommitted, STOP and report `BLOCKED` with the file name — do not edit a file someone else has open. If clean, make exactly this change in each:

- [ ] **Step 1 — archive:** in `confirmArchive`, before the `Alert.alert`, fetch `const n = await messageService.countDeletable(group.id).catch(() => 0);` and append to the confirm body: `'\n\n' + t('messages.deleteWarning', { count: n })` when `n > 0` (plural keys `deleteWarning_one/_other` from Task 3; use `defaultValue_one/_other` options if `en.json` was not updated). `confirmArchive` becomes async; keep its lock semantics.
- [ ] **Step 2 — remove member:** in `confirmRemove`, same pattern with `messageService.countDeletable(groupId, member.studentId)` (check the `GroupMember` field name for the student id).
- [ ] **Step 3:** tsc / jest; stage only the two files; commit `feat(messages): say how many conversations archiving or removing will delete`.

---

### Task 7: Walk it on a device

SQL applied (Task 2, Parts A/B/C clean — C2 `0 rows`).

1. Student: Messages tab, "New message" lists advisor + classmates + mentor; open one with a classmate, send → appears; the classmate's device shows it live, badge increments; open it → badge clears.
2. Advisor: cannot see that conversation anywhere (list shows only their own); "New message" lists the selected group's students; chip switch changes the contact list.
3. Mentor: "New message" lists their linked students; send; the student sees it.
4. Block: student A blocks B → B's input replaced by "You can't message this person."; A still sends; unblock restores. In an advisor conversation the Block action is absent.
5. Advisor removes student B from the group → the confirm says "N conversations…"; after confirming, B's conversations are gone on every device; A's other conversations remain.
6. Archive the group → confirm names the count; all conversations gone.
7. Tap a `direct_message` notification → the conversation opens.
8. Airplane mode + open a conversation → `LoadFailedBanner`, not an empty chat.

---

## Risks

- **C2 is the privacy proof.** If it ever reads anything but `0 rows`, nothing else in this plan matters.
- **`can_message` runs on every row read** (through `can_access_conversation`). It is three EXISTS subqueries on indexed columns; fine at this scale, but it is the place to look if the conversation list ever slows.
- **Deletion is irreversible and trigger-driven.** The confirmations (Task 6) are the only guard; if Task 6 is blocked by the shared tree, ship without them and say so loudly.
- **The mentor's contact list** depends on an embed PostgREST may or may not resolve; the two-query fallback in Task 4 is the safe path.
