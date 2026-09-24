-- docs/message-broadcast-verification.sql — Part B runs inside BEGIN .. ROLLBACK,
-- so nothing it writes survives. Run after docs/message-broadcast.sql.
-- Each part returns a RESULT SET (the SQL editor does not show NOTICE).

-- ============================================================
-- PART A — structural
-- ============================================================
SELECT * FROM (
  VALUES
    ('A1 function exists',
     to_regprocedure('public.broadcast_message(uuid[],text)') IS NOT NULL),
    ('A2 SECURITY DEFINER with a fixed search_path',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'broadcast_message' AND p.prosecdef
               AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
                           WHERE c LIKE 'search_path=%'))),
    ('A3 authenticated may call it',
     has_function_privilege('authenticated', 'broadcast_message(uuid[],text)', 'EXECUTE')),
    ('A4 anon may not',
     NOT has_function_privilege('anon', 'broadcast_message(uuid[],text)', 'EXECUTE'))
) AS t(check_name, ok)
ORDER BY check_name;

-- ============================================================
-- PART B — behaviour, as the simulation's advisor. Rolled back at the end.
-- ============================================================
BEGIN;
DO $$
DECLARE
  v_group    UUID;
  v_advisor  UUID;
  v_students UUID[];
  v_stranger UUID := gen_random_uuid();
  v_result   JSONB;
  v_before   INTEGER;
  v_after    INTEGER;
  v_convs    INTEGER;
  v_convs1   INTEGER;
  v_sent1    INTEGER;
  v_log      TEXT := '';
BEGIN
  SELECT g.id, g.advisor_id INTO v_group, v_advisor
  FROM internship_groups g WHERE g.join_code = '58MMWL';
  IF v_group IS NULL THEN
    PERFORM set_config('probe.results', 'SKIP: simulation group 58MMWL not found', true);
    RETURN;
  END IF;

  SELECT array_agg(m.student_id) INTO v_students
  FROM (SELECT student_id FROM group_memberships
        WHERE group_id = v_group AND left_at IS NULL ORDER BY joined_at LIMIT 3) m;
  IF v_students IS NULL OR array_length(v_students, 1) < 3 THEN
    PERFORM set_config('probe.results', 'SKIP: fewer than three students in the group', true);
    RETURN;
  END IF;

  -- act as the advisor
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_advisor)::text, true);

  -- B1: every recipient is accounted for, and exactly the delivered ones get a
  -- message. A student whose internship is closed is refused by send_message --
  -- that is the point of the per-recipient isolation, so the check counts
  -- rather than assumes.
  SELECT count(*) INTO v_before FROM messages WHERE sender_id = v_advisor;
  v_result := broadcast_message(v_students, 'Yarınki saha ziyareti için toplanma saati 09:00.');
  SELECT count(*) INTO v_after FROM messages WHERE sender_id = v_advisor;
  v_sent1 := (v_result->>'sent')::int;
  v_log := v_log || CASE
    WHEN v_sent1 + jsonb_array_length(v_result->'failed') = 3
      AND v_after - v_before = v_sent1
      AND v_sent1 > 0
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'failed') f
                      WHERE f->>'code' NOT IN ('INTERNSHIP_CLOSED', 'CANNOT_MESSAGE', 'BLOCKED', 'NOT_IN_GROUP'))
    THEN 'PASS B1: ' || v_sent1 || ' delivered, ' || jsonb_array_length(v_result->'failed')
         || ' refused with a known code, one message each'
    ELSE 'FAIL B1: result ' || v_result::text || ', messages added ' || (v_after - v_before)
  END || chr(10);

  -- B1b: each message sits in its own two-person conversation.
  SELECT count(DISTINCT c.id) INTO v_convs
  FROM conversations c
  JOIN conversation_participants p ON p.conversation_id = c.id AND p.user_id = ANY(v_students)
  WHERE c.group_id = v_group
    AND EXISTS (SELECT 1 FROM conversation_participants me
                WHERE me.conversation_id = c.id AND me.user_id = v_advisor);
  v_log := v_log || CASE
    WHEN v_convs = 3 THEN 'PASS B1b: one separate conversation per recipient'
    ELSE 'FAIL B1b: ' || v_convs || ' conversations for three recipients'
  END || chr(10);

  -- B2: sending again reuses those conversations instead of opening new ones.
  v_convs1 := v_convs;
  v_result := broadcast_message(v_students, 'Not: yelek ve baret zorunlu.');
  SELECT count(DISTINCT c.id) INTO v_convs
  FROM conversations c
  JOIN conversation_participants p ON p.conversation_id = c.id AND p.user_id = ANY(v_students)
  WHERE c.group_id = v_group
    AND EXISTS (SELECT 1 FROM conversation_participants me
                WHERE me.conversation_id = c.id AND me.user_id = v_advisor);
  v_log := v_log || CASE
    WHEN (v_result->>'sent')::int = v_sent1 AND v_convs = v_convs1
    THEN 'PASS B2: a second broadcast reuses the same conversations'
    ELSE 'FAIL B2: sent ' || (v_result->>'sent') || ' (first ' || v_sent1 || '), conversations '
         || v_convs || ' (was ' || v_convs1 || ')'
  END || chr(10);

  -- B3: one bad recipient does not cost the others their message.
  v_result := broadcast_message(v_students[1:2] || v_stranger, 'Cuma raporunu unutmayın.');
  v_log := v_log || CASE
    WHEN (v_result->>'sent')::int + jsonb_array_length(v_result->'failed') = 3
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'failed') f
                  WHERE f->>'id' = v_stranger::text AND f->>'code' = 'NOT_IN_GROUP')
    THEN 'PASS B3: a stranger fails alone, the rest are delivered'
    ELSE 'FAIL B3: ' || v_result::text
  END || chr(10);

  -- B4: the sender is dropped from their own recipient list -- one recipient
  -- is considered, never two.
  v_result := broadcast_message(ARRAY[v_advisor, v_students[1]], 'Tek kişilik test.');
  v_log := v_log || CASE
    WHEN (v_result->>'sent')::int + jsonb_array_length(v_result->'failed') = 1
    THEN 'PASS B4: the sender is not a recipient of their own broadcast'
    ELSE 'FAIL B4: ' || v_result::text
  END || chr(10);

  -- B5: the input guards.
  BEGIN
    PERFORM broadcast_message(v_students, '   ');
    v_log := v_log || 'FAIL B5: an empty body was accepted' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || CASE WHEN SQLERRM LIKE 'MESSAGE_EMPTY%'
      THEN 'PASS B5: an empty body is refused (MESSAGE_EMPTY)'
      ELSE 'FAIL B5: refused with ' || SQLERRM END || chr(10);
  END;
  BEGIN
    PERFORM broadcast_message(ARRAY[]::UUID[], 'Kimseye.');
    v_log := v_log || 'FAIL B6: an empty recipient list was accepted' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || CASE WHEN SQLERRM LIKE 'RECIPIENTS_EMPTY%'
      THEN 'PASS B6: an empty recipient list is refused (RECIPIENTS_EMPTY)'
      ELSE 'FAIL B6: refused with ' || SQLERRM END || chr(10);
  END;
  BEGIN
    PERFORM broadcast_message(
      (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 31)), 'Çok kişi.');
    v_log := v_log || 'FAIL B7: 31 recipients were accepted' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || CASE WHEN SQLERRM LIKE 'TOO_MANY_RECIPIENTS%'
      THEN 'PASS B7: more than thirty recipients is refused (TOO_MANY_RECIPIENTS)'
      ELSE 'FAIL B7: refused with ' || SQLERRM END || chr(10);
  END;

  -- B8: a student may not broadcast, even straight at the API.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_students[1])::text, true);
  BEGIN
    PERFORM broadcast_message(ARRAY[v_students[2]], 'Sınıfa duyuru.');
    v_log := v_log || 'FAIL B8: a student could broadcast' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || CASE WHEN SQLERRM LIKE 'ROLE_NOT_ALLOWED%'
      THEN 'PASS B8: a student is refused (ROLE_NOT_ALLOWED)'
      ELSE 'FAIL B8: refused with ' || SQLERRM END || chr(10);
  END;

  PERFORM set_config('probe.results', v_log, true);
END $$;

SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';
ROLLBACK;

-- ============================================================
-- PART C — the function under the client's own role, with no session
-- ============================================================
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_log TEXT := '';
BEGIN
  -- authenticated may reach the function (the app calls it), but with no JWT
  -- it must refuse rather than act.
  BEGIN
    PERFORM broadcast_message(ARRAY[gen_random_uuid()], 'Oturumsuz.');
    v_log := v_log || 'FAIL C1: a call with no session went through' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || CASE WHEN SQLERRM LIKE 'NOT_AUTHENTICATED%'
      THEN 'PASS C1: no session is refused (NOT_AUTHENTICATED)'
      ELSE 'FAIL C1: refused with ' || SQLERRM END || chr(10);
  END;
  PERFORM set_config('probe.results', v_log, true);
END $$;

SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';
ROLLBACK;
