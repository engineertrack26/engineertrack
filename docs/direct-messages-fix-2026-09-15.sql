-- Trigger function only; the trigger itself is unchanged; safe to re-run.
-- Adds cleanup of the old mentor's stale case-thread notifications.
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
    DELETE FROM notifications n
    WHERE n.user_id = OLD.mentor_id AND n.type = 'direct_message'
      AND n.data->>'conversationId' IN (SELECT c.id::text FROM conversations c WHERE c.kind = 'case' AND c.subject_id = NEW.id);
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
