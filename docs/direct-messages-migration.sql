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
