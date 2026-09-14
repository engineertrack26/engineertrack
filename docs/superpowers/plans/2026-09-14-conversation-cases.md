# Conversations v2 — Case Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalise direct messages from a two-column pair to a participants table, add the advisor-opened three-way "case" thread (advisor + student + mentor) and the advisor↔mentor 1:1, keeping every v1 guarantee (participant-only access re-checked on every read, deletion with the relationship, no `owns_group` in any policy).

**Architecture:** One migration file replaces v1's tables (no production data exists): `conversations` loses `a_id/b_id`, gains `kind ∈ {member, mentor, staff, case}`, `subject_id`, `pair_key`; `conversation_participants` holds who is in. `can_message` grows a `staff` branch; `can_access_conversation` branches on kind. RPCs are rewritten against participants; `open_case` and `list_case_candidates` are new. The client adds `title`/`participants` to the summary, a case row style, sender names in case bubbles, and an advisor "New case" flow. Verification Parts A/B/C are extended.

**Tech Stack:** Expo SDK 57 / RN 0.86 / TS 6 / Supabase (Postgres, RLS, SECURITY DEFINER RPCs, realtime) / Zustand / i18next / jest.

**Spec:** `docs/superpowers/specs/2026-09-14-conversation-cases-design.md` (binding); v1 spec `docs/superpowers/specs/2026-09-13-direct-messages-design.md` for everything it does not override.

## Global Constraints

- SQL applied by the owner in the Supabase SQL editor, one file per submission, in order: `docs/direct-messages-migration.sql` (v2, **drops and recreates** the message tables — acceptable per spec decision 9), `docs/direct-messages-rpcs.sql`, then `docs/direct-messages-verification.sql` Parts A / B / C separately. Anonymous `$$` only; `grep -o '\$\$' <file> | wc -l` even; idempotent after the first run (`DROP TABLE IF EXISTS … CASCADE`, `CREATE OR REPLACE`).
- **No policy on `conversations`, `conversation_participants`, `messages`, `conversation_reads`, `conversation_blocks` may mention `owns_group`**; no direct INSERT/UPDATE/DELETE policy on any of them; `can_message` stays `REVOKE … FROM PUBLIC, authenticated`. Part A asserts all three.
- Access predicate: participant **and** relationship still holds (spec §3). Archived group → no access, no new conversations.
- Blocking only for `kind IN ('member','mentor')` and never when the advisor is a participant; `CANNOT_BLOCK` otherwise.
- Error codes (new): `CANNOT_OPEN_CASE`, `CASE_NEEDS_MENTOR`; mapped in `src/utils/rpcErrors.ts`; English copy in `en.json` `errors.*` only (other locales fall back).
- `list_conversations` row: `{ id, kind, groupId, groupName, subjectId, title, participants:[{id,name,role}], otherId, otherName, otherRole, lastMessageAt, lastMessagePreview, unreadCount, blockedByMe, blockedMe }` — `otherId/otherName/otherRole` NULL for cases; `blocked*` false for cases and staff.
- Shared working tree with a parallel Codex session: stage by explicit path only; never `git add -A`/`.`, stash, checkout, reset; never touch a file not named in the task. Locale files: add keys to `en.json` only; use `t(key, 'Default')` everywhere; `tabs.*` keys must exist in all seven locales (a Codex test asserts it) — this plan adds none.
- `noUnusedLocals`/`noUnusedParameters`; path aliases; `mapRpcError` for every refusal; no bare `catch {}`; `LoadFailedBanner` on failed loads.
- Gates per task: `npx tsc --noEmit` silent; `npx jest --silent` green (baseline 48 suites / 407 tests at plan time).
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` (+ the session line the tooling adds).

---

## File Structure

**SQL (rewrite in place — single home for each)**
- `docs/direct-messages-migration.sql` — tables v2, `can_message`, `conversation_other`, `can_access_conversation`, policies, triggers, realtime.
- `docs/direct-messages-rpcs.sql` — `open_conversation`, `open_case`, `list_case_candidates`, `send_message`, `mark_conversation_read`, `block_conversation`, `list_conversations`, `list_messages`, `list_message_contacts`, `list_mentor_message_contacts`, `unread_message_count`, `count_deletable_conversations`.
- `docs/direct-messages-verification.sql` — Parts A / B / C extended.

**Client**
- Modify: `src/types/messages.ts`, `src/services/messages.ts`, `src/utils/rpcErrors.ts`, `src/utils/messageHelpers.ts` (+ test), `src/components/messages/ConversationList.tsx`, `src/components/messages/MessageBubble.tsx`, `src/components/screens/ConversationScreen.tsx`, `src/components/screens/MessagesScreen.tsx`, `src/i18n/locales/en.json` (errors + messages keys).

---

### Task 1: Migration v2 — participants, kinds, access, lifetime

**Files:**
- Rewrite: `docs/direct-messages-migration.sql`
- Modify: `docs/direct-messages-verification.sql` (Part A only)

**Interfaces:**
- Produces: tables above; `can_message(p_group_id, p_user, p_other) RETURNS TEXT` ∈ {member, mentor, staff, NULL}; `conversation_other(p_conversation_id, p_user) RETURNS UUID`; `can_access_conversation(p_conversation_id) RETURNS BOOLEAN`; triggers `trg_dm_membership_closed`, `trg_dm_group_archived`, `trg_dm_mentor_changed`, `trg_dm_conversation_deleted`.

- [ ] **Step 1: Replace the migration file with this content**

```sql
-- ============================================
-- Conversations v2: direct messages (member / mentor / staff) and case
-- threads (advisor + student + mentor). Replaces v1 wholesale -- no
-- production rows existed. Apply order: this file, docs/direct-messages-rpcs.sql,
-- then docs/direct-messages-verification.sql part by part.
--
-- Privacy is the feature: a conversation is readable by its participants and
-- nobody else. owns_group appears in NO policy here (Part A asserts it).
-- ============================================

DROP TABLE IF EXISTS conversation_blocks CASCADE;
DROP TABLE IF EXISTS conversation_reads CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversation_participants CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;

CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('member', 'mentor', 'staff', 'case')),
  -- case: the student the case is about; NULL otherwise
  subject_id      UUID REFERENCES profiles(id) ON DELETE CASCADE,
  -- 1:1: least(id)||':'||greatest(id) of the two participants; NULL for a case
  pair_key        TEXT,
  created_by      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  CONSTRAINT conversations_case_has_subject CHECK ((kind = 'case') = (subject_id IS NOT NULL)),
  CONSTRAINT conversations_case_has_no_pair CHECK ((kind = 'case') = (pair_key IS NULL)),
  UNIQUE (group_id, pair_key),
  UNIQUE (group_id, subject_id)
);
CREATE INDEX idx_conversations_group ON conversations(group_id);

CREATE TABLE conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_conversation_participants_user ON conversation_participants(user_id);

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);

CREATE TABLE conversation_reads (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE conversation_blocks (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  blocker_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, blocker_id)
);

-- ---- The one relationship rule for 1:1 conversations ----
-- member: both are the group's advisor or an active member.
-- mentor: an active member and their linked mentor.
-- staff:  the group's advisor and the current mentor of an active member.
-- NULL:   anything else, and always for an archived group.
CREATE OR REPLACE FUNCTION can_message(p_group_id UUID, p_user UUID, p_other UUID)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN p_user IS NULL OR p_other IS NULL OR p_user = p_other THEN NULL
    WHEN EXISTS (SELECT 1 FROM internship_groups g WHERE g.id = p_group_id AND g.is_archived) THEN NULL
    WHEN (EXISTS (SELECT 1 FROM internship_groups g WHERE g.id = p_group_id AND g.advisor_id = p_user)
          OR EXISTS (SELECT 1 FROM group_memberships m WHERE m.group_id = p_group_id AND m.student_id = p_user AND m.left_at IS NULL))
     AND (EXISTS (SELECT 1 FROM internship_groups g WHERE g.id = p_group_id AND g.advisor_id = p_other)
          OR EXISTS (SELECT 1 FROM group_memberships m WHERE m.group_id = p_group_id AND m.student_id = p_other AND m.left_at IS NULL))
      THEN 'member'
    WHEN EXISTS (SELECT 1 FROM group_memberships m JOIN student_profiles sp ON sp.id = m.student_id
                 WHERE m.group_id = p_group_id AND m.left_at IS NULL
                   AND ((m.student_id = p_user AND sp.mentor_id = p_other)
                     OR (m.student_id = p_other AND sp.mentor_id = p_user)))
      THEN 'mentor'
    WHEN EXISTS (SELECT 1 FROM internship_groups g
                 JOIN group_memberships m ON m.group_id = g.id AND m.left_at IS NULL
                 JOIN student_profiles sp ON sp.id = m.student_id
                 WHERE g.id = p_group_id
                   AND ((g.advisor_id = p_user AND sp.mentor_id = p_other)
                     OR (g.advisor_id = p_other AND sp.mentor_id = p_user)))
      THEN 'staff'
    ELSE NULL
  END;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
-- Not callable from PostgREST: it is a relationship oracle.
REVOKE EXECUTE ON FUNCTION can_message(UUID, UUID, UUID) FROM PUBLIC, authenticated;

-- The other participant of a 1:1 (NULL for a case or a non-participant).
CREATE OR REPLACE FUNCTION conversation_other(p_conversation_id UUID, p_user UUID)
RETURNS UUID AS $$
  SELECT cp.user_id FROM conversation_participants cp
  JOIN conversations c ON c.id = cp.conversation_id
  WHERE cp.conversation_id = p_conversation_id AND c.kind <> 'case' AND cp.user_id <> p_user
    AND EXISTS (SELECT 1 FROM conversation_participants me WHERE me.conversation_id = p_conversation_id AND me.user_id = p_user)
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
REVOKE EXECUTE ON FUNCTION conversation_other(UUID, UUID) FROM PUBLIC, authenticated;

-- True iff the caller is a participant AND the relationship still holds.
-- The only predicate the five policies use; re-evaluated on every read.
CREATE OR REPLACE FUNCTION can_access_conversation(p_conversation_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
    JOIN internship_groups g ON g.id = c.group_id
    WHERE c.id = p_conversation_id
      AND NOT g.is_archived
      AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = auth.uid())
      AND CASE WHEN c.kind = 'case' THEN
            EXISTS (SELECT 1 FROM group_memberships m WHERE m.group_id = c.group_id AND m.student_id = c.subject_id AND m.left_at IS NULL)
            AND (g.advisor_id = auth.uid() OR c.subject_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.id = c.subject_id AND sp.mentor_id = auth.uid()))
          ELSE can_message(c.group_id, auth.uid(), conversation_other(c.id, auth.uid())) IS NOT NULL
          END
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION can_access_conversation(UUID) TO authenticated;

-- ---- RLS: SELECT only; every write is an RPC ----
ALTER TABLE conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_reads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_blocks       ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_select ON conversations FOR SELECT TO authenticated
  USING (can_access_conversation(id));
CREATE POLICY conversation_participants_select ON conversation_participants FOR SELECT TO authenticated
  USING (can_access_conversation(conversation_id));
CREATE POLICY messages_select ON messages FOR SELECT TO authenticated
  USING (can_access_conversation(conversation_id));
CREATE POLICY conversation_reads_select ON conversation_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND can_access_conversation(conversation_id));
CREATE POLICY conversation_blocks_select ON conversation_blocks FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

-- ---- Lifetime ----
-- A membership closing deletes every conversation the student is in, in that group (cases included: they are its subject).
CREATE OR REPLACE FUNCTION trg_dm_membership_closed_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM conversations c
  WHERE c.group_id = NEW.group_id
    AND (c.subject_id = NEW.student_id
         OR EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = NEW.student_id));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dm_membership_closed ON group_memberships;
CREATE TRIGGER trg_dm_membership_closed
  AFTER UPDATE OF left_at ON group_memberships
  FOR EACH ROW WHEN (OLD.left_at IS NULL AND NEW.left_at IS NOT NULL)
  EXECUTE FUNCTION trg_dm_membership_closed_fn();

-- Archiving deletes every conversation of the group.
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
  FOR EACH ROW WHEN (OLD.is_archived = false AND NEW.is_archived = true)
  EXECUTE FUNCTION trg_dm_group_archived_fn();

-- A mentor link changing: the 1:1 with the old mentor is deleted; a case is
-- re-pointed (old mentor out, new mentor in -- the old mentor's messages stay,
-- they are the record); the old mentor's staff conversations go where they no
-- longer mentor an active member of that group.
CREATE OR REPLACE FUNCTION trg_dm_mentor_changed_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.mentor_id IS NOT NULL THEN
    DELETE FROM conversations c
    WHERE c.kind = 'mentor'
      AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = NEW.id)
      AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = OLD.mentor_id);
    DELETE FROM conversation_participants cp USING conversations c
    WHERE cp.conversation_id = c.id AND c.kind = 'case' AND c.subject_id = NEW.id AND cp.user_id = OLD.mentor_id;
    DELETE FROM conversations c
    WHERE c.kind = 'staff'
      AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = OLD.mentor_id)
      AND NOT EXISTS (SELECT 1 FROM group_memberships m JOIN student_profiles sp ON sp.id = m.student_id
                      WHERE m.group_id = c.group_id AND m.left_at IS NULL AND sp.mentor_id = OLD.mentor_id);
  END IF;
  IF NEW.mentor_id IS NOT NULL THEN
    INSERT INTO conversation_participants (conversation_id, user_id)
    SELECT c.id, NEW.mentor_id FROM conversations c WHERE c.kind = 'case' AND c.subject_id = NEW.id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dm_mentor_changed ON student_profiles;
CREATE TRIGGER trg_dm_mentor_changed
  AFTER UPDATE OF mentor_id ON student_profiles
  FOR EACH ROW WHEN (OLD.mentor_id IS DISTINCT FROM NEW.mentor_id)
  EXECUTE FUNCTION trg_dm_mentor_changed_fn();

-- A conversation's notifications carry an 80-character preview; they go with it.
CREATE OR REPLACE FUNCTION trg_dm_conversation_deleted_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM notifications WHERE type = 'direct_message' AND data->>'conversationId' = OLD.id::text;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_dm_conversation_deleted ON conversations;
CREATE TRIGGER trg_dm_conversation_deleted
  AFTER DELETE ON conversations FOR EACH ROW EXECUTE FUNCTION trg_dm_conversation_deleted_fn();

-- ---- Realtime (messages INSERT only; never REPLICA IDENTITY FULL) ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;
```

- [ ] **Step 2: Part A** — in the verification file's Part A: the table array becomes `['conversations','conversation_participants','messages','conversation_reads','conversation_blocks']`; the constraint check becomes `conversations_case_has_subject` and `conversations_case_has_no_pair`; the function array adds `'conversation_other'`; keep the `owns_group`-absent, write-policy-absent, `can_message`-not-executable and publication checks; add `IF has_function_privilege('authenticated', 'conversation_other(uuid,uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: conversation_other is callable by authenticated'; END IF;`. Trigger list unchanged (four names).

- [ ] **Step 3: Lint** — even `$$` count in both files. Commit `feat(messages): conversations v2 schema — participants, kinds, case access, lifetime`.

---

### Task 2: RPCs v2 and verification Parts B / C

**Files:**
- Rewrite: `docs/direct-messages-rpcs.sql`
- Modify: `docs/direct-messages-verification.sql` (Parts B, C)

**Interfaces (all SECURITY DEFINER, GRANT TO authenticated):**
- `open_conversation(p_group_id, p_other_id) → uuid` — `CANNOT_MESSAGE`.
- `open_case(p_group_id, p_student_id) → uuid` — `CANNOT_OPEN_CASE` (caller does not own the group or student not an active member), `CASE_NEEDS_MENTOR`.
- `list_case_candidates(p_group_id) → SETOF JSONB {id, name, role:'student', hasCase}` — advisor only (`CANNOT_OPEN_CASE`); active members with a linked mentor.
- `send_message`, `mark_conversation_read`, `block_conversation`, `list_conversations`, `list_messages`, `list_message_contacts`, `list_mentor_message_contacts`, `unread_message_count`, `count_deletable_conversations` — signatures as v1.

- [ ] **Step 1: Replace the RPC file**

```sql
-- ============================================
-- Conversations v2 RPCs. Apply after docs/direct-messages-migration.sql.
-- All SECURITY DEFINER; the actor is always auth.uid().
-- ============================================

-- ---- open_conversation (1:1) ----
CREATE OR REPLACE FUNCTION open_conversation(p_group_id UUID, p_other_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_kind TEXT; v_key TEXT; v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  v_kind := can_message(p_group_id, auth.uid(), p_other_id);
  IF v_kind IS NULL THEN RAISE EXCEPTION 'CANNOT_MESSAGE'; END IF;
  v_key := LEAST(auth.uid(), p_other_id)::text || ':' || GREATEST(auth.uid(), p_other_id)::text;
  SELECT id INTO v_id FROM conversations WHERE group_id = p_group_id AND pair_key = v_key;
  IF v_id IS NULL THEN
    INSERT INTO conversations (group_id, kind, pair_key, created_by) VALUES (p_group_id, v_kind, v_key, auth.uid())
    ON CONFLICT (group_id, pair_key) DO UPDATE SET kind = EXCLUDED.kind
    RETURNING id INTO v_id;
    INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_id, auth.uid()), (v_id, p_other_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION open_conversation(UUID, UUID) TO authenticated;

-- ---- open_case (advisor + student + mentor) ----
CREATE OR REPLACE FUNCTION open_case(p_group_id UUID, p_student_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_mentor UUID; v_name TEXT; v_new BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM internship_groups g WHERE g.id = p_group_id AND g.advisor_id = auth.uid() AND NOT g.is_archived)
     OR NOT EXISTS (SELECT 1 FROM group_memberships m WHERE m.group_id = p_group_id AND m.student_id = p_student_id AND m.left_at IS NULL) THEN
    RAISE EXCEPTION 'CANNOT_OPEN_CASE';
  END IF;
  SELECT sp.mentor_id INTO v_mentor FROM student_profiles sp WHERE sp.id = p_student_id;
  IF v_mentor IS NULL THEN RAISE EXCEPTION 'CASE_NEEDS_MENTOR'; END IF;
  SELECT id INTO v_id FROM conversations WHERE group_id = p_group_id AND subject_id = p_student_id;
  IF v_id IS NULL THEN
    INSERT INTO conversations (group_id, kind, subject_id, created_by) VALUES (p_group_id, 'case', p_student_id, auth.uid())
    RETURNING id INTO v_id;
    v_new := true;
  END IF;
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_id, auth.uid()), (v_id, p_student_id), (v_id, v_mentor) ON CONFLICT DO NOTHING;
  IF v_new THEN
    SELECT trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')) INTO v_name FROM profiles_public pp WHERE pp.id = auth.uid();
    INSERT INTO notifications (user_id, title, body, type, data)
    SELECT u, 'Case opened', coalesce(nullif(v_name, ''), 'Your advisor') || ' opened a case thread with you.',
           'direct_message', jsonb_build_object('conversationId', v_id)
    FROM unnest(ARRAY[p_student_id, v_mentor]) AS u;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION open_case(UUID, UUID) TO authenticated;

-- ---- list_case_candidates ----
CREATE OR REPLACE FUNCTION list_case_candidates(p_group_id UUID)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM internship_groups g WHERE g.id = p_group_id AND g.advisor_id = auth.uid()) THEN
    RAISE EXCEPTION 'CANNOT_OPEN_CASE';
  END IF;
  RETURN QUERY
  SELECT jsonb_build_object('id', pp.id, 'name', trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')),
                            'role', 'student',
                            'hasCase', EXISTS (SELECT 1 FROM conversations c WHERE c.group_id = p_group_id AND c.subject_id = pp.id))
  FROM group_memberships m
  JOIN student_profiles sp ON sp.id = m.student_id AND sp.mentor_id IS NOT NULL
  JOIN profiles_public pp ON pp.id = m.student_id
  WHERE m.group_id = p_group_id AND m.left_at IS NULL
  ORDER BY pp.first_name, pp.last_name;
END;
$$;
GRANT EXECUTE ON FUNCTION list_case_candidates(UUID) TO authenticated;

-- ---- send_message ----
CREATE OR REPLACE FUNCTION send_message(p_conversation_id UUID, p_body TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c conversations%ROWTYPE; v_other UUID; v_msg UUID; v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF btrim(coalesce(p_body, '')) = '' THEN RAISE EXCEPTION 'MESSAGE_EMPTY'; END IF;
  SELECT * INTO v_c FROM conversations WHERE id = p_conversation_id;
  IF v_c.id IS NULL OR NOT can_access_conversation(p_conversation_id) THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
  IF v_c.kind IN ('member', 'mentor') THEN
    v_other := conversation_other(p_conversation_id, auth.uid());
    IF EXISTS (SELECT 1 FROM conversation_blocks WHERE conversation_id = p_conversation_id AND blocker_id = v_other) THEN
      RAISE EXCEPTION 'BLOCKED';
    END IF;
  END IF;

  INSERT INTO messages (conversation_id, sender_id, body) VALUES (p_conversation_id, auth.uid(), btrim(p_body)) RETURNING id INTO v_msg;
  UPDATE conversations SET last_message_at = now() WHERE id = p_conversation_id;
  INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES (p_conversation_id, auth.uid(), now())
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;

  SELECT trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')) INTO v_name FROM profiles_public pp WHERE pp.id = auth.uid();
  -- One notification per other participant (two in a case).
  INSERT INTO notifications (user_id, title, body, type, data)
  SELECT cp.user_id, 'New message', coalesce(nullif(v_name, ''), 'Someone') || ': ' || left(btrim(p_body), 80),
         'direct_message', jsonb_build_object('conversationId', p_conversation_id)
  FROM conversation_participants cp WHERE cp.conversation_id = p_conversation_id AND cp.user_id <> auth.uid();
  RETURN v_msg;
END;
$$;
GRANT EXECUTE ON FUNCTION send_message(UUID, TEXT) TO authenticated;

-- ---- mark_conversation_read ---- (as v1)
CREATE OR REPLACE FUNCTION mark_conversation_read(p_conversation_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT can_access_conversation(p_conversation_id) THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
  INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES (p_conversation_id, auth.uid(), now())
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
END;
$$;
GRANT EXECUTE ON FUNCTION mark_conversation_read(UUID) TO authenticated;

-- ---- block_conversation ----
-- Only student<->student and mentor<->student; never staff, never a case, never with the advisor.
CREATE OR REPLACE FUNCTION block_conversation(p_conversation_id UUID, p_block BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c conversations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_c FROM conversations WHERE id = p_conversation_id;
  IF v_c.id IS NULL OR NOT EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = p_conversation_id AND cp.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'CONVERSATION_NOT_FOUND';
  END IF;
  IF v_c.kind NOT IN ('member', 'mentor')
     OR EXISTS (SELECT 1 FROM internship_groups g JOIN conversation_participants cp ON cp.user_id = g.advisor_id
                WHERE g.id = v_c.group_id AND cp.conversation_id = p_conversation_id) THEN
    RAISE EXCEPTION 'CANNOT_BLOCK';
  END IF;
  IF p_block THEN
    INSERT INTO conversation_blocks (conversation_id, blocker_id) VALUES (p_conversation_id, auth.uid()) ON CONFLICT DO NOTHING;
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
    'subjectId', c.subject_id,
    'title', CASE WHEN c.kind = 'case' THEN trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, ''))
                  ELSE trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')) END,
    'participants', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', pp.id,
                        'name', trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')), 'role', pp.role)
                        ORDER BY pp.role, pp.first_name), '[]'::jsonb)
                     FROM conversation_participants cp JOIN profiles_public pp ON pp.id = cp.user_id WHERE cp.conversation_id = c.id),
    'otherId', o.id,
    'otherName', CASE WHEN o.id IS NULL THEN NULL ELSE trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')) END,
    'otherRole', o.role,
    'lastMessageAt', c.last_message_at,
    'lastMessagePreview', (SELECT left(m.body, 80) FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1),
    'unreadCount', (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> auth.uid()
                    AND m.created_at > coalesce((SELECT r.last_read_at FROM conversation_reads r WHERE r.conversation_id = c.id AND r.user_id = auth.uid()), '-infinity'::timestamptz)),
    'blockedByMe', c.kind IN ('member','mentor') AND EXISTS (SELECT 1 FROM conversation_blocks b WHERE b.conversation_id = c.id AND b.blocker_id = auth.uid()),
    'blockedMe',   c.kind IN ('member','mentor') AND EXISTS (SELECT 1 FROM conversation_blocks b WHERE b.conversation_id = c.id AND b.blocker_id = o.id)
  )
  FROM conversations c
  JOIN internship_groups g ON g.id = c.group_id
  LEFT JOIN profiles_public o ON o.id = conversation_other(c.id, auth.uid())
  LEFT JOIN profiles_public s ON s.id = c.subject_id
  WHERE (p_group_id IS NULL OR c.group_id = p_group_id)
    AND can_access_conversation(c.id)
  ORDER BY coalesce(c.last_message_at, c.created_at) DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION list_conversations(UUID) TO authenticated;

-- ---- list_messages ---- (as v1)
CREATE OR REPLACE FUNCTION list_messages(p_conversation_id UUID, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INT DEFAULT 50)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT can_access_conversation(p_conversation_id) THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object('id', m.id, 'senderId', m.sender_id, 'body', m.body, 'createdAt', m.created_at)
  FROM messages m WHERE m.conversation_id = p_conversation_id AND (p_before IS NULL OR m.created_at < p_before)
  ORDER BY m.created_at DESC LIMIT GREATEST(1, LEAST(p_limit, 100));
END;
$$;
GRANT EXECUTE ON FUNCTION list_messages(UUID, TIMESTAMPTZ, INT) TO authenticated;

-- ---- list_message_contacts ---- (as v1; can_message's staff branch now surfaces mentors to the advisor and the advisor to mentors)
CREATE OR REPLACE FUNCTION list_message_contacts(p_group_id UUID)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object('id', pp.id, 'name', trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')), 'role', pp.role)
  FROM (
    SELECT g.advisor_id AS id FROM internship_groups g WHERE g.id = p_group_id
    UNION SELECT m.student_id FROM group_memberships m WHERE m.group_id = p_group_id AND m.left_at IS NULL
    UNION SELECT sp.mentor_id FROM group_memberships m JOIN student_profiles sp ON sp.id = m.student_id
          WHERE m.group_id = p_group_id AND m.left_at IS NULL AND sp.mentor_id IS NOT NULL
  ) cand
  JOIN profiles_public pp ON pp.id = cand.id
  WHERE cand.id <> auth.uid() AND can_message(p_group_id, auth.uid(), cand.id) IS NOT NULL
  ORDER BY pp.role, pp.first_name, pp.last_name;
END;
$$;
GRANT EXECUTE ON FUNCTION list_message_contacts(UUID) TO authenticated;

-- ---- list_mentor_message_contacts ---- (students + their groups' advisors)
CREATE OR REPLACE FUNCTION list_mentor_message_contacts()
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object('id', pp.id, 'name', trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')),
                            'role', pp.role, 'groupId', x.group_id, 'groupName', x.group_name)
  FROM (
    SELECT sp.id AS contact, m.group_id, g.name AS group_name
    FROM student_profiles sp JOIN group_memberships m ON m.student_id = sp.id AND m.left_at IS NULL
    JOIN internship_groups g ON g.id = m.group_id WHERE sp.mentor_id = auth.uid()
    UNION
    SELECT g.advisor_id, g.id, g.name
    FROM student_profiles sp JOIN group_memberships m ON m.student_id = sp.id AND m.left_at IS NULL
    JOIN internship_groups g ON g.id = m.group_id WHERE sp.mentor_id = auth.uid()
  ) x
  JOIN profiles_public pp ON pp.id = x.contact
  WHERE can_message(x.group_id, auth.uid(), x.contact) IS NOT NULL
  ORDER BY pp.role, pp.first_name, pp.last_name;
END;
$$;
GRANT EXECUTE ON FUNCTION list_mentor_message_contacts() TO authenticated;

-- ---- unread_message_count ---- (as v1)
CREATE OR REPLACE FUNCTION unread_message_count()
RETURNS INT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(sum((x->>'unreadCount')::int), 0)::int FROM list_conversations(NULL) AS x;
$$;
GRANT EXECUTE ON FUNCTION unread_message_count() TO authenticated;

-- ---- count_deletable_conversations ---- (owns_group in a FUNCTION only; Part A checks policies)
CREATE OR REPLACE FUNCTION count_deletable_conversations(p_group_id UUID, p_student_id UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (owns_group(p_group_id) OR (p_student_id IS NOT NULL AND p_student_id = auth.uid())) THEN RAISE EXCEPTION 'NOT_GROUP_OWNER'; END IF;
  SELECT count(*) INTO n FROM conversations c
  WHERE c.group_id = p_group_id
    AND (p_student_id IS NULL OR c.subject_id = p_student_id
         OR EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = p_student_id));
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION count_deletable_conversations(UUID, UUID) TO authenticated;
```

- [ ] **Step 2: Part B** — keep v1's B1–B13 but update the ones that referenced `a_id/b_id`: B1 asserts `kind='member'` via `conversations`; B13's counts use `EXISTS participant` instead of `stu IN (a_id,b_id)`. Add, after B10 (mentor change) and before B13, keeping the archive last:

```sql
  -- B14 advisor opens a case: 3 participants, 2 notifications
  BEGIN
    IF mentor IS NULL THEN
      log := log || 'B14 advisor opens a case' || E'\t' || 'SKIP: needs a mentor profile' || E'\n';
    ELSE
      UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;
      DELETE FROM notifications WHERE type = 'direct_message' AND user_id IN (stu, mentor);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
      c_case := open_case(grp, stu);
      SELECT count(*) INTO n FROM conversation_participants WHERE conversation_id = c_case;
      SELECT count(*) INTO m FROM notifications WHERE type = 'direct_message' AND (data->>'conversationId')::uuid = c_case;
      log := log || 'B14 advisor opens a case' || E'\t' || CASE WHEN n = 3 AND m = 2 AND open_case(grp, stu) = c_case THEN '3 participants, 2 notified, reopen idempotent' ELSE 'FAIL: ' || n || ' participants, ' || m || ' notifications' END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B14 advisor opens a case' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B15 the student cannot open a case
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM open_case(grp, stu);
      log := log || 'B15 student cannot open a case' || E'\t' || 'FAIL: opened' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'B15 student cannot open a case' || E'\t' || CASE WHEN SQLERRM LIKE 'CANNOT_OPEN_CASE%' THEN 'CANNOT_OPEN_CASE' ELSE 'FAIL: ' || SQLERRM END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN log := log || 'B15 student cannot open a case' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B16 a message in the case notifies the two others; blocking is refused
  BEGIN
    IF c_case IS NULL THEN
      log := log || 'B16 case message and block' || E'\t' || 'SKIP: no case' || E'\n';
    ELSE
      DELETE FROM notifications WHERE type = 'direct_message' AND (data->>'conversationId')::uuid = c_case;
      PERFORM send_message(c_case, 'hello both');
      SELECT count(*) INTO n FROM notifications WHERE type = 'direct_message' AND (data->>'conversationId')::uuid = c_case AND user_id IN (adv, mentor);
      BEGIN
        PERFORM block_conversation(c_case, true); m := 0;
      EXCEPTION WHEN OTHERS THEN m := CASE WHEN SQLERRM LIKE 'CANNOT_BLOCK%' THEN 1 ELSE 0 END; END;
      log := log || 'B16 case message and block' || E'\t' || CASE WHEN n = 2 AND m = 1 THEN '2 notified, CANNOT_BLOCK' ELSE 'FAIL: ' || n || ' notified, block refused ' || m END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B16 case message and block' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B17 staff conversation advisor<->mentor opens
  BEGIN
    IF mentor IS NULL THEN
      log := log || 'B17 advisor-mentor opens as staff' || E'\t' || 'SKIP: needs a mentor profile' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
      c_staff := open_conversation(grp, mentor);
      SELECT count(*) INTO n FROM conversations WHERE id = c_staff AND kind = 'staff';
      log := log || 'B17 advisor-mentor opens as staff' || E'\t' || CASE WHEN n = 1 THEN 'staff' ELSE 'FAIL' END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B17 advisor-mentor opens as staff' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B18 mentor unlinked: the old mentor leaves the case, the case survives with 2 participants, the staff 1:1 is gone
  BEGIN
    IF c_case IS NULL THEN
      log := log || 'B18 mentor change re-points the case' || E'\t' || 'SKIP: no case' || E'\n';
    ELSE
      UPDATE student_profiles SET mentor_id = NULL WHERE id = stu;
      SELECT count(*) INTO n FROM conversation_participants WHERE conversation_id = c_case;
      SELECT count(*) INTO m FROM conversations WHERE id = c_staff;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM list_messages(c_case); v := 0;
      EXCEPTION WHEN OTHERS THEN v := CASE WHEN SQLERRM LIKE 'CONVERSATION_NOT_FOUND%' THEN 1 ELSE 0 END; END;
      UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;
      SELECT count(*) INTO k FROM conversation_participants WHERE conversation_id = c_case;
      log := log || 'B18 mentor change re-points the case' || E'\t' || CASE WHEN n = 2 AND m = 0 AND v = 1 AND k = 3 THEN 'old mentor out, staff 1:1 gone, old mentor refused, re-link adds them back' ELSE 'FAIL: ' || n || ' / ' || m || ' / ' || v || ' / ' || k END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B18 mentor change re-points the case' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;
```
Declare `c_case UUID; c_staff UUID; k INT;` in the block. B11 (archive) additionally asserts `count(*) FROM conversations WHERE group_id = grp` = 0 covers cases. Update the header list and the "Expected: N rows" line.

- [ ] **Step 3: Part C** — after C6, still inside the same transaction shape (re-run setup as owner: open a case for `stu` as `adv` via impersonation before `SET LOCAL ROLE`), add:
  - C7 `another student reads the case` → `SELECT count(*) FROM messages WHERE conversation_id = c_case` as `stu2` → 0 rows (SKIP without stu2);
  - C8 `the subject's mentor reads the case` → `list_messages(c_case)` as `mentor` → no error (positive control);
  - C9 `the advisor reads the case` → 1 row of `conversations` visible (the advisor is a participant here, unlike C2).
  Store `probe.case` in a GUC in the setup block.

- [ ] **Step 4: Lint, commit** `feat(messages): conversations v2 RPCs — open_case, staff 1:1, participants; Parts B/C`. Hand the three files to the owner in order (migration, rpcs, A, B, C).

---

### Task 3: Client — types, service, helpers, list row, conversation screen, New case

**Files:**
- Modify: `src/types/messages.ts`, `src/services/messages.ts`, `src/utils/rpcErrors.ts`, `src/utils/messageHelpers.ts`, `src/utils/__tests__/messageHelpers.test.ts`, `src/components/messages/ConversationList.tsx`, `src/components/messages/MessageBubble.tsx`, `src/components/screens/ConversationScreen.tsx`, `src/components/screens/MessagesScreen.tsx`, `src/i18n/locales/en.json`

- [ ] **Step 1: Types**

```ts
export type ConversationKind = 'member' | 'mentor' | 'staff' | 'case';
export interface Participant { id: string; name: string; role: string }
export interface ConversationSummary {
  id: string; kind: ConversationKind; groupId: string; groupName: string;
  /** The student a case is about; null for 1:1. */
  subjectId: string | null;
  /** Case: the student's name. 1:1: the other participant's name. */
  title: string;
  participants: Participant[];
  otherId: string | null; otherName: string | null; otherRole: string | null;
  lastMessageAt?: string; lastMessagePreview?: string; unreadCount: number;
  blockedByMe: boolean; blockedMe: boolean;
}
```
`Message`, `MessageContact` unchanged. `toSummary` maps the new fields (`participants` default `[]`, `title` default `otherName ?? ''`).

- [ ] **Step 2: Failing tests** — append to `messageHelpers.test.ts`:
```ts
import { senderName, conversationSubtitle } from '@/utils/messageHelpers';
describe('senderName', () => {
  const parts = [{ id: 'a', name: 'Ayşe', role: 'student' }, { id: 'm', name: 'Mert', role: 'mentor' }];
  it('resolves a participant and falls back to a label for a departed one', () => {
    expect(senderName(parts, 'm', 'Former participant')).toBe('Mert');
    expect(senderName(parts, 'gone', 'Former participant')).toBe('Former participant');
  });
});
describe('conversationSubtitle', () => {
  it('lists the other participants of a case and the role for a 1:1', () => {
    const parts = [{ id: 'a', name: 'Ayşe', role: 'student' }, { id: 'm', name: 'Mert', role: 'mentor' }, { id: 'd', name: 'Deniz', role: 'advisor' }];
    expect(conversationSubtitle('case', parts, 'd', (r) => r)).toBe('Ayşe, Mert');
    expect(conversationSubtitle('mentor', parts.slice(0, 2), 'a', (r) => `R:${r}`)).toBe('R:mentor');
  });
});
```
Implement:
```ts
export function senderName(participants: Participant[], senderId: string, fallback: string): string {
  return participants.find((p) => p.id === senderId)?.name || fallback;
}
/** Case: the other participants' names. 1:1: the other's role label. */
export function conversationSubtitle(kind: ConversationKind, participants: Participant[], me: string, roleLabel: (role: string) => string): string {
  const others = participants.filter((p) => p.id !== me);
  if (kind === 'case') return others.map((p) => p.name).join(', ');
  return others[0] ? roleLabel(others[0].role) : '';
}
```

- [ ] **Step 3: Service + errors** — `messageService.openCase(groupId, studentId) → rpc<string>('open_case', { p_group_id, p_student_id })`; `listCaseCandidates(groupId) → rpc<Array<{id,name,role,hasCase}>>('list_case_candidates', { p_group_id })`. `ERROR_KEYS`: `CANNOT_OPEN_CASE: 'errors.cannotOpenCase'`, `CASE_NEEDS_MENTOR: 'errors.caseNeedsMentor'`. `en.json` `errors`: `cannotOpenCase: "Only the group's advisor can open a case for an active member."`, `caseNeedsMentor: "This student has no linked mentor yet, so a case can't be opened."`; `messages`: `caseLabel: "Case"`, `newCase: "New case"`, `pickCaseStudent: "Open a case for which student?"`, `caseHint: "A case is a thread between you, the student and their mentor."`, `caseExists: "Case already open"`, `formerParticipant: "Former participant"`, `roleStaff: "Advisor · Mentor"`.

- [ ] **Step 4: ConversationRow** — `item.title` instead of `otherName`; for `kind === 'case'`: avatar shows an Ionicons `people` icon, name line prefixed with `t('messages.caseLabel','Case') + ' · '`, meta = `conversationSubtitle(...)` (names); for 1:1 meta = role label as before (`staff` → `t('messages.roleStaff', …)` when the other is a mentor/advisor). Take `me: string` as a prop.

- [ ] **Step 5: MessageBubble** — optional `senderName?: string`; when set and `!mine`, render it above the body in `styles.sender` (12px, `colors.textSecondary`).

- [ ] **Step 6: ConversationScreen** — header: `summary.title`; second line: for a case `conversationSubtitle('case', participants, user.id, …)`, else `groupName`; bubbles: `senderName={summary.kind === 'case' && !mine ? senderName(summary.participants, m.senderId, t('messages.formerParticipant','Former participant')) : undefined}`; `canBlock = summary && ['member','mentor'].includes(summary.kind) && summary.otherRole !== 'advisor' && role !== 'advisor'`; `blockConfirm` uses `summary.title`.

- [ ] **Step 7: MessagesScreen** — advisor only: a second header button **New case** (`Ionicons 'people-outline'`) → `caseCandidates` via `messageService.listCaseCandidates(groupId)` (needs a selected group; the chip row already exists) → reuse `ContactPicker` with a different title (`t('messages.pickCaseStudent', …)`) and a hint line; picking calls `openCase` → navigate. Rows with `hasCase` show `t('messages.caseExists','Case already open')` as their role line. Pass `me={user.id}` to `ConversationRow`.

- [ ] **Step 8: Gates and commit** `feat(messages): case threads on the client — titles, participants, sender names, New case`.

---

### Task 4: Device walk

1. Advisor → Messages → **New case** → pick a student → thread opens with title = student name and "Ayşe, Mert" under it; the student and the mentor each get a "Case opened" notification and see "Case · Ayşe" in their list.
2. Any of the three sends → the other two get a notification; bubbles from others show the sender's name; no Block button.
3. Advisor → New message → picks the mentor → 1:1 (`staff`); mentor → New message → sees the advisor listed.
4. Change the student's mentor (mentor unlinks / a new mentor links by code) → the old mentor's thread list loses the case; the new mentor sees it with the history.
5. Remove the student from the group → the case is gone for everyone; the count in the confirm included it.
6. Student↔mentor 1:1 still blocks/unblocks; a case cannot.

## Risks

- **`can_access_conversation` cost**: one more EXISTS per row than v1 (the participants lookup). Fine at consortium scale; index `idx_conversation_participants_user` covers the badge query.
- **Drop-and-recreate**: correct only while no real conversations exist. If the owner has piloted DMs with real users before applying v2, stop and write a data-preserving migration instead (backfill participants from `a_id/b_id`, compute `pair_key`).
- **Codex overlap**: `en.json`, `ConversationScreen`, `MessagesScreen` may be open in the parallel session; the implementer checks `git status --porcelain` per file and reports BLOCKED rather than editing a dirty file.
