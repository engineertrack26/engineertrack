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
  IF has_function_privilege('authenticated', 'can_message(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: can_message is callable by authenticated -- it must stay internal';
  END IF;
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

-- ============================================================
-- PART B — RPC behaviour, owner-run with impersonated auth.uid().
-- Submit BEGIN..ROLLBACK in one go. Needs an advisor, two students and a
-- mentor profile; cases needing a second student or a mentor SKIP otherwise.
--   B1  student<->student opens as kind member
--   B2  student<->advisor opens as kind member
--   B3  student<->mentor opens as kind mentor
--   B4  mentor<->advisor refused CANNOT_MESSAGE
--   B5  send -> 1 message, 1 notification to the other side, last_message_at set
--   B6  block (student-student, or mentor-student when there is one student): blocked sender gets BLOCKED, blocker still sends
--   B7  advisor conversation: block refused CANNOT_BLOCK
--   B8  unread: 1 for the recipient, 0 after mark_conversation_read
--   B9  membership closed -> that student's conversations gone, the others remain
--   B10 mentor changed -> mentor conversation gone, member conversations remain
--   B12 mentor contacts list the linked student with the group
--   B11 archive -> zero conversations for the group
-- Expected: twelve rows, none beginning FAIL / ABORTED.
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; stu2 UUID; mentor UUID; grp UUID;
  c_ss UUID; c_sa UUID; c_sm UUID; msg UUID; n INT; m INT; log TEXT := '';
  v_bc UUID; v_blocker UUID;
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

-- ============================================================
-- PART C — the policies, actually evaluated. Submit BEGIN..ROLLBACK in one go.
--   C1 participant reads own conversation and message      1 / 1   (positive control)
--   C2 THE ADVISOR reads a conversation they are not in      0 rows  (the reason this feature exists)
--   C3 the advisor reads its message                         0 rows
--   C4 a student of another group reads it                  0 rows
--   C5 non-participant send_message                         CONVERSATION_NOT_FOUND
--   C6 after the membership is closed, the former participant  0 rows (and list_conversations empty)
-- C2/C3/C5 need a second student or a mentor; C4 needs a third student. They
-- SKIP otherwise.
-- With one student and a mentor, the conversation under test is
-- student<->mentor: the advisor is still an outsider to it, so C2/C3/C5 are real.
-- ============================================================
BEGIN;

DO $$
DECLARE adv UUID; stu UUID; stu2 UUID; stuB UUID; mentor UUID; grp UUID; grpB UUID; c UUID; msg UUID;
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
    INSERT INTO conversations (group_id, kind, a_id, b_id) VALUES (grp, 'member', LEAST(stu, stu2), GREATEST(stu, stu2)) RETURNING id INTO c;
    PERFORM set_config('probe.mode', 'students', true);
  ELSIF mentor IS NOT NULL THEN
    UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;
    INSERT INTO conversations (group_id, kind, a_id, b_id) VALUES (grp, 'mentor', LEAST(stu, mentor), GREATEST(stu, mentor)) RETURNING id INTO c;
    PERFORM set_config('probe.mode', 'mentor', true);
  ELSE
    INSERT INTO conversations (group_id, kind, a_id, b_id) VALUES (grp, 'member', LEAST(stu, adv), GREATEST(stu, adv)) RETURNING id INTO c;
    PERFORM set_config('probe.mode', 'advisor', true);
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
DECLARE adv UUID; stu UUID; stu2 UUID; stuB UUID; c UUID; mode TEXT; n INT; m INT; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results', 'C1-C6' || E'\t' || 'SKIP: needs an advisor and a student' || E'\n', true); RETURN;
  END IF;
  adv := current_setting('probe.adv')::uuid; stu := current_setting('probe.stu')::uuid;
  stu2 := NULLIF(current_setting('probe.stu2'), '')::uuid; stuB := NULLIF(current_setting('probe.stuB'), '')::uuid;
  c := current_setting('probe.c')::uuid;
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
