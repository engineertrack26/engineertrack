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
