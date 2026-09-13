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

-- ---- list_mentor_message_contacts ----
-- A mentor's students may sit in different groups; each row carries the
-- group a conversation would be opened in. SECURITY DEFINER because the
-- mentor cannot read group_memberships directly.
CREATE OR REPLACE FUNCTION list_mentor_message_contacts()
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object('id', pp.id,
                            'name', trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')),
                            'role', 'student', 'groupId', m.group_id, 'groupName', g.name)
  FROM student_profiles sp
  JOIN group_memberships m ON m.student_id = sp.id AND m.left_at IS NULL
  JOIN internship_groups g ON g.id = m.group_id
  JOIN profiles_public pp ON pp.id = sp.id
  WHERE sp.mentor_id = auth.uid()
    AND can_message(m.group_id, auth.uid(), sp.id) IS NOT NULL
  ORDER BY pp.first_name, pp.last_name;
END;
$$;
GRANT EXECUTE ON FUNCTION list_mentor_message_contacts() TO authenticated;

-- ---- unread_message_count ----
CREATE OR REPLACE FUNCTION unread_message_count()
RETURNS INT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(sum((x->>'unreadCount')::int), 0)::int FROM list_conversations(NULL) AS x;
$$;
GRANT EXECUTE ON FUNCTION unread_message_count() TO authenticated;

-- ---- count_deletable_conversations ----
-- Backs the "N conversations will be permanently deleted" confirmations.
-- Note: this RPC returns a number, never a message body -- it is the one
-- place owns_group is used in the whole feature. Part A of the verification
-- file checks *policies*, not functions, so this does not conflict with the
-- "owns_group appears in no policy on these tables" assertion.
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
