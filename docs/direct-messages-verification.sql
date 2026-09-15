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
  FOREACH t IN ARRAY ARRAY['conversations','conversation_participants','messages','conversation_reads','conversation_blocks'] LOOP
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

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_case_has_subject') THEN
    RAISE EXCEPTION 'FAIL: conversations_case_has_subject CHECK is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_case_has_no_pair') THEN
    RAISE EXCEPTION 'FAIL: conversations_case_has_no_pair CHECK is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_group_id_pair_key_key') THEN
    RAISE EXCEPTION 'FAIL: unique (group_id, pair_key) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_group_id_subject_id_key') THEN
    RAISE EXCEPTION 'FAIL: unique (group_id, subject_id) is missing';
  END IF;
  FOREACH t IN ARRAY ARRAY['can_message','can_access_conversation','conversation_other'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = t) THEN
      RAISE EXCEPTION 'FAIL: %() is missing', t;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'can_message(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: can_message is callable by authenticated -- it must stay internal';
  END IF;
  IF has_function_privilege('authenticated', 'conversation_other(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: conversation_other is callable by authenticated';
  END IF;
  FOREACH t IN ARRAY ARRAY['trg_dm_membership_closed','trg_dm_group_archived','trg_dm_mentor_changed','trg_dm_conversation_deleted'] LOOP
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

-- ============================================================
-- PART B — RPC behaviour, owner-run with impersonated auth.uid().
-- Submit BEGIN..ROLLBACK in one go. Needs an advisor, two students and a
-- mentor profile; cases needing a second student or a mentor SKIP otherwise.
--   B1  student<->student opens as kind member
--   B2  student<->advisor opens as kind member
--   B3  student<->mentor opens as kind mentor
--   B4  mentor with a student they do not mentor refused CANNOT_MESSAGE
--   B5  send -> 1 message, 1 notification to the other side, last_message_at set
--   B6  block (student-student, or mentor-student when there is one student): blocked sender gets BLOCKED, blocker still sends
--   B7  advisor conversation: block refused CANNOT_BLOCK
--   B8  unread: 1 for the recipient, 0 after mark_conversation_read
--   B9  membership closed -> that student's conversations gone, the others remain
--   B10 mentor changed -> mentor conversation gone, member conversations remain
--   B19 open_case without a mentor -> CASE_NEEDS_MENTOR
--   B14 advisor opens a case -> 3 participants, 2 notified, reopen idempotent
--   B15 the student cannot open a case -> CANNOT_OPEN_CASE
--   B16 a message in the case notifies the two others; blocking is refused
--   B17 staff conversation advisor<->mentor opens as kind staff
--   B18 mentor unlinked -> the old mentor leaves the case, the case survives; the staff 1:1 is gone unless the mentor still mentors another active member
--   B13 re-joining own group keeps conversations
--   B12 mentor contacts list the linked student with the group
--   B11 archive -> zero conversations for the group (cases included), zero notifications
-- Expected: nineteen rows, none beginning FAIL / ABORTED.
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; stu2 UUID; mentor UUID; grp UUID;
  c_ss UUID; c_sa UUID; c_sm UUID; c_case UUID; c_staff UUID; msg UUID;
  n INT; m INT; k INT; k2 INT; k3 INT; v INT; log TEXT := '';
  v_bc UUID; v_blocker UUID; v_code TEXT;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu2 FROM profiles WHERE role = 'student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role = 'mentor' ORDER BY created_at LIMIT 1;
  IF adv IS NULL OR stu IS NULL THEN
    PERFORM set_config('probe.results', 'B1-B19' || E'\t' || 'SKIP: needs an advisor and a student' || E'\n', true);
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

  -- B4 (in v2, advisor<->mentor is a real 'staff' pairing -- B17 asserts that;
  -- the surviving CANNOT_MESSAGE negative control is a mentor and a student
  -- they do not mentor)
  BEGIN
    IF mentor IS NULL THEN
      log := log || 'B4 mentor with a student they do not mentor refused CANNOT_MESSAGE' || E'\t' || 'SKIP: needs a mentor profile' || E'\n';
    ELSIF stu2 IS NULL THEN
      log := log || 'B4 mentor with a student they do not mentor refused CANNOT_MESSAGE' || E'\t' || 'SKIP: needs a second student' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM open_conversation(grp, stu2);
        log := log || 'B4 mentor with a student they do not mentor refused CANNOT_MESSAGE' || E'\t' || 'FAIL: opened' || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || 'B4 mentor with a student they do not mentor refused CANNOT_MESSAGE' || E'\t' || CASE WHEN SQLERRM LIKE 'CANNOT_MESSAGE%' THEN 'CANNOT_MESSAGE' ELSE 'FAIL: ' || SQLERRM END || E'\n';
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B4 mentor with a student they do not mentor refused CANNOT_MESSAGE' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

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

  -- B6 (student-student or mentor-student block)
  BEGIN
    v_bc := NULL; v_blocker := NULL;
    IF stu2 IS NOT NULL THEN
      v_bc := c_ss;
      v_blocker := stu2;
    ELSIF mentor IS NOT NULL THEN
      v_bc := c_sm;
      v_blocker := mentor;
    ELSE
      log := log || 'B6 block stops the other side, not the blocker' || E'\t' || 'SKIP: needs a second student or a mentor' || E'\n';
    END IF;

    IF v_bc IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_blocker, 'role', 'authenticated')::text, true);
      PERFORM block_conversation(v_bc, true);
      PERFORM send_message(v_bc, 'blocker can still write');
      PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM send_message(v_bc, 'should be refused');
        log := log || 'B6 block stops the other side, not the blocker' || E'\t' || 'FAIL: blocked sender got through' || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || 'B6 block stops the other side, not the blocker' || E'\t'
            || CASE WHEN SQLERRM LIKE 'BLOCKED%' THEN 'BLOCKED for the blocked, sent for the blocker' ELSE 'FAIL: ' || SQLERRM END || E'\n';
      END;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_blocker, 'role', 'authenticated')::text, true);
      PERFORM block_conversation(v_bc, false);
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

  -- B19 open_case without a mentor -> CASE_NEEDS_MENTOR (stu.mentor_id is NULL here, after B10)
  BEGIN
    IF mentor IS NULL THEN
      log := log || 'B19 open_case without a mentor' || E'\t' || 'SKIP: needs a mentor profile' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM open_case(grp, stu);
        log := log || 'B19 open_case without a mentor' || E'\t' || 'FAIL: opened' || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || 'B19 open_case without a mentor' || E'\t' || CASE WHEN SQLERRM LIKE 'CASE_NEEDS_MENTOR%' THEN 'CASE_NEEDS_MENTOR' ELSE 'FAIL: ' || SQLERRM END || E'\n';
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B19 open_case without a mentor' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

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

  -- B18 mentor unlinked: the old mentor leaves the case, the case survives with 2 participants; the staff 1:1 is gone only if the mentor no longer mentors any other active member of the group
  BEGIN
    IF c_case IS NULL THEN
      log := log || 'B18 mentor change re-points the case' || E'\t' || 'SKIP: no case' || E'\n';
    ELSE
      SELECT count(*) INTO k2 FROM group_memberships gm JOIN student_profiles sp ON sp.id = gm.student_id
        WHERE gm.group_id = grp AND gm.left_at IS NULL AND sp.mentor_id = mentor AND gm.student_id <> stu;
      UPDATE student_profiles SET mentor_id = NULL WHERE id = stu;
      SELECT count(*) INTO n FROM conversation_participants WHERE conversation_id = c_case;
      SELECT count(*) INTO m FROM conversations WHERE id = c_staff;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM list_messages(c_case); v := 0;
      EXCEPTION WHEN OTHERS THEN v := CASE WHEN SQLERRM LIKE 'CONVERSATION_NOT_FOUND%' THEN 1 ELSE 0 END; END;
      SELECT count(*) INTO k3 FROM notifications WHERE user_id = mentor AND type = 'direct_message' AND (data->>'conversationId')::uuid = c_case;
      UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;
      SELECT count(*) INTO k FROM conversation_participants WHERE conversation_id = c_case;
      log := log || 'B18 mentor change re-points the case' || E'\t' ||
        CASE WHEN k2 = 0 AND n = 2 AND m = 0 AND v = 1 AND k = 3 AND k3 = 0 THEN 'old mentor out, staff 1:1 gone, old mentor refused, re-link adds them back, stale notifications gone'
             WHEN k2 > 0 AND n = 2 AND m = 1 AND v = 1 AND k = 3 AND k3 = 0 THEN 'old mentor out, staff 1:1 kept (mentor still mentors another member), old mentor refused, re-link adds them back, stale notifications gone'
             ELSE 'FAIL: ' || n || ' / ' || m || ' / ' || v || ' / ' || k || ' (k2=' || k2 || ')' || ' / notif ' || k3 END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B18 mentor change re-points the case' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B13 (re-joining the code of your own group is a no-op for conversations)
  BEGIN
    SELECT join_code INTO v_code FROM internship_groups WHERE id = grp;
    SELECT count(*) INTO n FROM conversations c WHERE c.group_id = grp AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = stu);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    PERFORM join_group_by_code(v_code);
    SELECT count(*) INTO m FROM conversations c WHERE c.group_id = grp AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = stu);
    log := log || 'B13 re-joining own group keeps conversations' || E'\t' || CASE WHEN n = m AND n > 0 THEN 'kept ' || n ELSE 'FAIL: ' || n || ' -> ' || m END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B13 re-joining own group keeps conversations' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B12 (mentor contacts list the linked student with the group) -- must run
  -- before B11 archives the group. B10 already cleared mentor_id, so it is
  -- restored here first, as owner (no impersonation needed for a direct
  -- table UPDATE); request.jwt.claims is set to the mentor only afterwards,
  -- for the RPC call that follows.
  BEGIN
    IF mentor IS NULL THEN
      log := log || 'B12 mentor contacts list the linked student with the group' || E'\t' || 'SKIP: needs a mentor profile' || E'\n';
    ELSE
      UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
      SELECT count(*) INTO n FROM list_mentor_message_contacts() x WHERE (x->>'id')::uuid = stu AND (x->>'groupId')::uuid = grp;
      log := log || 'B12 mentor contacts list the linked student with the group' || E'\t' || CASE WHEN n = 1 THEN '1 contact' ELSE 'FAIL: ' || n END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'B12 mentor contacts list the linked student with the group' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B11 (archive) -- counts ALL conversations of grp, cases and staff included
  BEGIN
    UPDATE internship_groups SET is_archived = true WHERE id = grp;
    SELECT count(*) INTO n FROM conversations WHERE group_id = grp;
    SELECT count(*) INTO m FROM notifications WHERE type = 'direct_message' AND (data->>'conversationId')::uuid IN (c_sa, c_sm, c_case, c_staff);
    log := log || 'B11 archive deletes every conversation' || E'\t' || CASE WHEN n = 0 AND m = 0 THEN '0 rows, 0 notifications' ELSE 'FAIL: ' || n || ' rows, ' || m || ' notifications' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B11 archive deletes every conversation' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;

-- ============================================================
-- PART C — the policies, actually evaluated. Submit BEGIN..ROLLBACK in one go.
--   C1 participant reads own conversation and message      1 / 1   (positive control)
--   C2 THE ADVISOR reads a conversation they are not in      0 rows  (the reason this feature exists)
--   C3 the advisor reads its message                         0 rows
--   C4 a student of another group reads it                  0 rows
--   C5 non-participant send_message                         CONVERSATION_NOT_FOUND
--   C6 after the membership is closed, the former participant  0 rows (list_conversations empty, case gone)
--   C7 another student reads the case's messages             0 rows
--   C8 the case subject's mentor reads the case               1 row (positive control)
--   C9 the advisor reads the case                             1 row (the advisor IS a participant here)
-- C2/C3/C5 need a second student or a mentor; C4 needs a third student; C7
-- needs a second student; C8/C9 need a mentor profile (open_case needs one).
-- They SKIP otherwise. The case carries one real message (as owner, in setup)
-- so C7's 0-rows and C8's 1-row are both real reads, not vacuous.
-- C7-C9 print before C6: closing the membership deletes the case, so the case
-- must be read while it still exists -- C6's own membership-close setup runs after.
-- With one student and a mentor, the conversation under test for C1-C6 is
-- student<->mentor: the advisor is still an outsider to it, so C2/C3/C5 are real.
-- ============================================================
BEGIN;

DO $$
DECLARE adv UUID; stu UUID; stu2 UUID; stuB UUID; mentor UUID; grp UUID; grpB UUID; c UUID; c_case UUID; msg UUID;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu2 FROM profiles WHERE role = 'student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT id INTO stuB FROM profiles WHERE role = 'student' AND id NOT IN (stu, coalesce(stu2, stu)) ORDER BY created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role = 'mentor' ORDER BY created_at LIMIT 1;
  IF adv IS NULL OR stu IS NULL THEN PERFORM set_config('probe.ready', 'no', true); RETURN; END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe messages A') RETURNING id INTO grp;
  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe messages B') RETURNING id INTO grpB;
  UPDATE group_memberships SET left_at = now() WHERE student_id IN (stu, stu2, stuB) AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  IF stu2 IS NOT NULL THEN INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu2); END IF;
  IF stuB IS NOT NULL THEN INSERT INTO group_memberships (group_id, student_id) VALUES (grpB, stuB); END IF;

  -- The conversation under test: stu <-> stu2 when possible; else stu <-> mentor
  -- (still an advisor-free pair, so the privacy checks stay meaningful); else
  -- stu <-> adv as a last resort, where the advisor IS a participant.
  IF stu2 IS NOT NULL THEN
    INSERT INTO conversations (group_id, kind, pair_key, created_by)
      VALUES (grp, 'member', LEAST(stu, stu2)::text || ':' || GREATEST(stu, stu2)::text, stu) RETURNING id INTO c;
    INSERT INTO conversation_participants (conversation_id, user_id) VALUES (c, stu), (c, stu2);
    PERFORM set_config('probe.mode', 'students', true);
  ELSIF mentor IS NOT NULL THEN
    UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;
    INSERT INTO conversations (group_id, kind, pair_key, created_by)
      VALUES (grp, 'mentor', LEAST(stu, mentor)::text || ':' || GREATEST(stu, mentor)::text, stu) RETURNING id INTO c;
    INSERT INTO conversation_participants (conversation_id, user_id) VALUES (c, stu), (c, mentor);
    PERFORM set_config('probe.mode', 'mentor', true);
  ELSE
    INSERT INTO conversations (group_id, kind, pair_key, created_by)
      VALUES (grp, 'member', LEAST(stu, adv)::text || ':' || GREATEST(stu, adv)::text, stu) RETURNING id INTO c;
    INSERT INTO conversation_participants (conversation_id, user_id) VALUES (c, stu), (c, adv);
    PERFORM set_config('probe.mode', 'advisor', true);
  END IF;
  INSERT INTO messages (conversation_id, sender_id, body) VALUES (c, stu, 'private') RETURNING id INTO msg;

  -- Case setup for C7-C9: needs a mentor (open_case's own requirement). Uses
  -- the RPC itself, impersonating the advisor, so participants and the
  -- notifications it fires match production behaviour exactly.
  IF mentor IS NOT NULL THEN
    UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    c_case := open_case(grp, stu);
    -- A real message, as owner: C7's "0 rows" and C8's "1 row" would otherwise
    -- both be vacuous on an empty case.
    INSERT INTO messages (conversation_id, sender_id, body) VALUES (c_case, adv, 'case private');
  END IF;

  PERFORM set_config('probe.ready', 'yes', true);
  PERFORM set_config('probe.adv', adv::text, true);
  PERFORM set_config('probe.stu', stu::text, true);
  PERFORM set_config('probe.stu2', coalesce(stu2::text, ''), true);
  PERFORM set_config('probe.stuB', coalesce(stuB::text, ''), true);
  PERFORM set_config('probe.mentor', coalesce(mentor::text, ''), true);
  PERFORM set_config('probe.grp', grp::text, true);
  PERFORM set_config('probe.c', c::text, true);
  PERFORM set_config('probe.case', coalesce(c_case::text, ''), true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE adv UUID; stu UUID; stu2 UUID; stuB UUID; mentor UUID; c UUID; c_case UUID; mode TEXT; n INT; m INT; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results', 'C1-C9' || E'\t' || 'SKIP: needs an advisor and a student' || E'\n', true); RETURN;
  END IF;
  adv := current_setting('probe.adv')::uuid; stu := current_setting('probe.stu')::uuid;
  stu2 := NULLIF(current_setting('probe.stu2'), '')::uuid; stuB := NULLIF(current_setting('probe.stuB'), '')::uuid;
  mentor := NULLIF(current_setting('probe.mentor'), '')::uuid;
  c := current_setting('probe.c')::uuid;
  c_case := NULLIF(current_setting('probe.case'), '')::uuid;
  mode := current_setting('probe.mode', true);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM conversations WHERE id = c;
    SELECT count(*) INTO m FROM messages WHERE conversation_id = c;
    log := log || 'C1 participant reads own conversation and message' || E'\t' || CASE WHEN n = 1 AND m = 1 THEN '1 / 1' ELSE 'FAIL: ' || n || ' / ' || m END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C1 participant reads own conversation and message' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;

  IF mode = 'advisor' THEN
    log := log || 'C2 THE ADVISOR reads a conversation they are not in' || E'\t' || 'SKIP: needs a second student or a mentor' || E'\n';
    log := log || 'C3 the advisor reads its message' || E'\t' || 'SKIP: needs a second student or a mentor' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO n FROM conversations WHERE id = c;
      log := log || 'C2 THE ADVISOR reads a conversation they are not in' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: the advisor can see it' END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C2 THE ADVISOR reads a conversation they are not in' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
    BEGIN
      SELECT count(*) INTO n FROM messages WHERE conversation_id = c;
      log := log || 'C3 the advisor reads its message' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: the advisor can read it' END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C3 the advisor reads its message' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
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
    log := log || 'C5 non-participant send_message' || E'\t' || CASE WHEN mode = 'advisor' THEN 'n/a: the advisor is a participant here' ELSE 'FAIL: sent' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C5 non-participant send_message' || E'\t' || CASE WHEN SQLERRM LIKE 'CONVERSATION_NOT_FOUND%' THEN 'CONVERSATION_NOT_FOUND' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;

  IF c_case IS NULL THEN
    log := log || 'C7 another student reads the case' || E'\t' || 'SKIP: no case' || E'\n';
  ELSIF stu2 IS NULL THEN
    log := log || 'C7 another student reads the case' || E'\t' || 'SKIP: needs a second student' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu2, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO n FROM messages WHERE conversation_id = c_case;
      log := log || 'C7 another student reads the case' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: leaked' END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C7 another student reads the case' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
  END IF;

  IF c_case IS NULL THEN
    log := log || 'C8 the case subject''s mentor reads the case' || E'\t' || 'SKIP: no case' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO n FROM list_messages(c_case);
      log := log || 'C8 the case subject''s mentor reads the case' || E'\t' || CASE WHEN n = 1 THEN '1 row' ELSE 'FAIL: ' || n END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C8 the case subject''s mentor reads the case' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
  END IF;

  IF c_case IS NULL THEN
    log := log || 'C9 the advisor reads the case' || E'\t' || 'SKIP: no case' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO n FROM conversations WHERE id = c_case;
      log := log || 'C9 the advisor reads the case' || E'\t' || CASE WHEN n = 1 THEN '1 row' ELSE 'FAIL: ' || n END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C9 the advisor reads the case' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
  END IF;

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
DECLARE stu UUID; c UUID; adv UUID; c_case UUID; n INT; m INT; k INT; log TEXT;
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  stu := current_setting('probe.stu')::uuid; c := current_setting('probe.c')::uuid;
  adv := current_setting('probe.adv')::uuid; c_case := NULLIF(current_setting('probe.case'), '')::uuid;
  log := current_setting('probe.results', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM messages WHERE conversation_id = c;
    SELECT count(*) INTO m FROM list_conversations(NULL);
    IF c_case IS NULL THEN
      k := 0;
    ELSE
      -- the case is deleted by the same membership-close trigger; check as the advisor
      PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
      SELECT count(*) INTO k FROM conversations WHERE id = c_case;
    END IF;
    log := log || 'C6 former participant after leaving' || E'\t' || CASE WHEN n = 0 AND m = 0 AND k = 0 THEN '0 rows, list empty, case gone' ELSE 'FAIL: ' || n || ' rows, ' || m || ' listed, ' || k || ' case rows' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C6 former participant after leaving' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
  PERFORM set_config('probe.results', log, true);
END $$;
RESET ROLE;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;
