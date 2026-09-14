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
