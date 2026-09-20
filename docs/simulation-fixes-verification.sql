-- docs/simulation-fixes-verification.sql
-- Verifies the 2026-09-20 fixes for the usage-simulation findings (sim/bugs.md
-- #1 #2 #3 #4 #5 #7 #8 #9 #10 #11 #12 #16). Apply order, one file per message:
--   1. docs/internship-groups-rpcs.sql        (#1 MENTOR_ALREADY_LINKED, mentor_linked_at, #7 trim trigger, #8 dates CHECK)
--   2. docs/internship-closure-guards.sql     (#2 two-way block, #3 ALREADY_APPROVED on re-approval,
--                                              #5 min/max range, #9 EVIDENCE_REQUIRED, #10 REFLECTION_TOO_SHORT,
--                                              #11 in-transaction decision notification, #16 mentor_note cleared)
--   3. docs/internship-closure-migration.sql  (#4 report literals via chr())
--   4. docs/internship-days-migration.sql     (#12 recorded weekend days count as working days)
--   5. this file: Part A, then Part B, then Part C, each as its own submission.
-- Part B impersonates the simulation accounts (group 58MMWL) and ROLLS BACK.

-- ============================================================================
-- Part A — structural (owner-run)
-- ============================================================================
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('link_student_by_code(text,text)'::regprocedure);
  IF def NOT LIKE '%MENTOR_ALREADY_LINKED%' THEN RAISE EXCEPTION 'FAIL A1: link_student_by_code has no MENTOR_ALREADY_LINKED guard'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'student_profiles' AND column_name = 'mentor_linked_at') THEN
    RAISE EXCEPTION 'FAIL A2: student_profiles.mentor_linked_at missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_profiles_internship_dates_check' AND convalidated) THEN
    RAISE EXCEPTION 'FAIL A3: internship dates CHECK missing or not validated'; END IF;

  def := pg_get_functiondef('submit_assignment(uuid,text,text,jsonb,jsonb,smallint)'::regprocedure);
  IF def NOT LIKE '%REFLECTION_TOO_SHORT%' OR def NOT LIKE '%EVIDENCE_REQUIRED%' OR def NOT LIKE '%mentor_note = NULL%' THEN
    RAISE EXCEPTION 'FAIL A4: submit_assignment lacks REFLECTION_TOO_SHORT / EVIDENCE_REQUIRED / mentor_note reset'; END IF;

  def := pg_get_functiondef('review_assignment(uuid,boolean,text,smallint)'::regprocedure);
  IF def NOT LIKE '%ALREADY_APPROVED%' OR def NOT LIKE '%task_approved%' THEN
    RAISE EXCEPTION 'FAIL A5: review_assignment lacks the re-approval guard or the notification insert'; END IF;

  def := pg_get_functiondef('send_message(uuid,text)'::regprocedure);
  IF def NOT LIKE '%blocker_id IN (v_other, auth.uid())%' THEN RAISE EXCEPTION 'FAIL A6: send_message block check is one-way'; END IF;

  def := pg_get_functiondef('internship_review(jsonb,text,text)'::regprocedure);
  IF def NOT LIKE '%GREATEST(coalesce(v_last%' THEN RAISE EXCEPTION 'FAIL A7: internship_review range is loop-ordered'; END IF;

  def := pg_get_functiondef('build_internship_report(uuid,uuid)'::regprocedure);
  IF def LIKE '%ÔÇ%' OR def LIKE '%┬%' THEN RAISE EXCEPTION 'FAIL A8: build_internship_report still carries mojibake'; END IF;
  IF def NOT LIKE '%chr(8212)%' THEN RAISE EXCEPTION 'FAIL A8: build_internship_report does not build its dashes with chr()'; END IF;

  def := pg_get_functiondef('internship_group_attendance(uuid)'::regprocedure);
  IF def NOT LIKE '%isodow FROM d.day_date) >= 6%' THEN RAISE EXCEPTION 'FAIL A9: internship_group_attendance ignores recorded weekend days'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_student_profiles_trim') THEN RAISE EXCEPTION 'FAIL A10: trg_student_profiles_trim missing'; END IF;
  IF EXISTS (SELECT 1 FROM student_profiles WHERE student_id IS DISTINCT FROM btrim(student_id)) THEN RAISE EXCEPTION 'FAIL A10: untrimmed student_id rows remain'; END IF;

  RAISE NOTICE 'PASS: Part A — 10 structural assertions held';
END $$;

-- ============================================================================
-- Part B — behaviour, impersonating the simulation accounts. BEGIN..ROLLBACK in one go.
-- ============================================================================
BEGIN;
DO $$
DECLARE
  grp    uuid := '861d35d8-5083-4146-a8eb-38b10b5a0640';
  adv    uuid := 'f6f7070c-b697-4bbe-8b3b-0a65d579a132';
  elif   uuid := '5d9c97c7-b804-4a65-890d-7eb65270f2ca';
  zeynep uuid := '0588262e-6301-4a16-abb8-82b9a963b2da';
  deniz  uuid := 'bd3a9ee1-832a-43d9-8888-bfb26b79f299';
  ayse   uuid := 'ca663073-8043-41c8-80ee-97e3e4f19c78';
  hakan  uuid := '69b34767-16ec-4483-a869-badcd064dc2d';
  ayca   uuid := '3a1e5820-0939-4b03-8060-cde6abcdc056';
  murat  uuid := '6fcbba4f-c65a-43ec-a938-60a70808223b';
  conv   uuid := '6798b8e0-1978-4e84-a976-bb0661006141'; -- Deniz ↔ Elif
  approved_sub uuid := '1caded2d-76c7-428e-bd1d-7bb39019af56'; -- Hakan's approval of Elif's task
  log text := '';
  asg uuid; sub uuid; n int; v_body text; rep text; att jsonb; srow jsonb; x text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM internship_groups WHERE id = grp) THEN
    PERFORM set_config('probe.results', 'B1-B10' || E'\t' || 'SKIP: the simulation group is not in this database' || E'\n', true);
    RETURN;
  END IF;

  -- B1 (#1): Ayça (Burak's mentor) uses Elif's active code, created before Hakan's link → MENTOR_ALREADY_LINKED
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ayca, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM link_student_by_code((SELECT code FROM student_codes WHERE student_id = elif AND is_active ORDER BY created_at DESC LIMIT 1), 'mentor');
    log := log || 'B1' || E'\t' || 'FAIL: a second mentor linked with an old code' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B1' || E'\t' || CASE WHEN SQLERRM LIKE 'MENTOR_ALREADY_LINKED%' THEN 'PASS' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;
  -- B2 (#1): the same mentor may re-link (Hakan, Elif's code)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hakan, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM link_student_by_code((SELECT code FROM student_codes WHERE student_id = elif AND is_active ORDER BY created_at DESC LIMIT 1), 'mentor');
    log := log || 'B2' || E'\t' || 'PASS' || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B2' || E'\t' || 'FAIL: ' || SQLERRM || E'\n'; END;
  -- B3 (#1): a fresh code generated after the link lets a new mentor take over
  PERFORM set_config('request.jwt.claims', json_build_object('sub', elif, 'role', 'authenticated')::text, true);
  UPDATE student_codes SET is_active = false WHERE student_id = elif;
  -- now() is the transaction time inside this probe, so the fresh code is dated a minute later explicitly
  INSERT INTO student_codes (student_id, created_at) VALUES (elif, now() + interval '1 minute');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ayca, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM link_student_by_code((SELECT code FROM student_codes WHERE student_id = elif AND is_active ORDER BY created_at DESC LIMIT 1), 'mentor');
    SELECT mentor_id::text INTO x FROM student_profiles WHERE id = elif;
    log := log || 'B3' || E'\t' || CASE WHEN x = ayca::text THEN 'PASS' ELSE 'FAIL: mentor is ' || coalesce(x, 'null') END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B3' || E'\t' || 'FAIL: ' || SQLERRM || E'\n'; END;

  -- B4 (#2): Deniz blocks her conversation with Elif, then her own send is refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', deniz, 'role', 'authenticated')::text, true);
  PERFORM block_conversation(conv, true);
  BEGIN
    PERFORM send_message(conv, 'engel açıkken deneme');
    log := log || 'B4' || E'\t' || 'FAIL: the blocker could still send' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B4' || E'\t' || CASE WHEN SQLERRM LIKE 'BLOCKED%' THEN 'PASS' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;
  PERFORM block_conversation(conv, false);

  -- B5 (#3): Hakan re-approves an approved submission → ALREADY_APPROVED; withdrawal still allowed
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hakan, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM review_assignment(approved_sub, true, 'tekrar', 3::smallint);
    log := log || 'B5' || E'\t' || 'FAIL: re-approval succeeded' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B5' || E'\t' || CASE WHEN SQLERRM LIKE 'ALREADY_APPROVED%' THEN 'PASS' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;

  -- B6 (#9, #10): Zeynep submits an untouched task with no evidence / a short reflection
  PERFORM set_config('request.jwt.claims', json_build_object('sub', zeynep, 'role', 'authenticated')::text, true);
  SELECT a.id INTO asg FROM group_assignments a
  WHERE a.group_id = grp AND a.published_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM assignment_submissions s WHERE s.assignment_id = a.id AND s.student_id = zeynep)
  ORDER BY a.created_at LIMIT 1;
  BEGIN
    PERFORM submit_assignment(asg, 'not', 'yeterince uzun bir yansıma metni burada', '[]'::jsonb, '[]'::jsonb, 2::smallint);
    log := log || 'B6a' || E'\t' || 'FAIL: no-evidence submission accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B6a' || E'\t' || CASE WHEN SQLERRM LIKE 'EVIDENCE_REQUIRED%' THEN 'PASS' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;
  BEGIN
    PERFORM submit_assignment(asg, 'not', 'Yaptım.', '[{"uri":"probe.png","caption":null}]'::jsonb, '[]'::jsonb, 2::smallint);
    log := log || 'B6b' || E'\t' || 'FAIL: one-word reflection accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B6b' || E'\t' || CASE WHEN SQLERRM LIKE 'REFLECTION_TOO_SHORT%' THEN 'PASS' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;
  -- B7 (#11, #16): a proper submission, Murat sends it back, the row carries the note; Zeynep resubmits → note cleared; notifications exist for both decisions
  sub := submit_assignment(asg, 'not', 'yeterince uzun bir yansıma metni burada', '[{"uri":"probe.png","caption":null}]'::jsonb, '[]'::jsonb, 2::smallint);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', murat, 'role', 'authenticated')::text, true);
  PERFORM review_assignment(sub, false, 'Tabloyu ekle.', NULL);
  SELECT count(*) INTO n FROM notifications WHERE user_id = zeynep AND type = 'task_revision_requested' AND (data->>'assignmentId')::uuid = asg;
  log := log || 'B7a' || E'\t' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL: ' || n || ' task_revision_requested notifications' END || E'\n';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', zeynep, 'role', 'authenticated')::text, true);
  PERFORM submit_assignment(asg, 'not', 'tabloyu ekledim, yansıma metni yeterince uzun', '[{"uri":"probe.png","caption":null}]'::jsonb, '[]'::jsonb, 2::smallint);
  SELECT mentor_note INTO x FROM assignment_submissions WHERE id = sub;
  log := log || 'B7b' || E'\t' || CASE WHEN x IS NULL THEN 'PASS' ELSE 'FAIL: mentor_note still "' || x || '"' END || E'\n';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', murat, 'role', 'authenticated')::text, true);
  PERFORM review_assignment(sub, true, '', 2::smallint);
  SELECT n2.body INTO v_body FROM notifications n2 WHERE n2.user_id = zeynep AND type = 'task_approved' AND (data->>'assignmentId')::uuid = asg ORDER BY created_at DESC LIMIT 1;
  log := log || 'B7c' || E'\t' || CASE WHEN v_body LIKE 'Murat Koç approved your task "%".' THEN 'PASS' ELSE 'FAIL: ' || coalesce(v_body, 'no task_approved notification') END || E'\n';

  -- B8 (#5): Hakan re-decides two of Elif's days (with a note); the notification range is min..max
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hakan, 'role', 'authenticated')::text, true);
  PERFORM internship_review(
    (SELECT jsonb_agg(jsonb_build_object('id', d.id, 'version', d.version) ORDER BY d.day_date DESC)
       FROM (SELECT id, version, day_date FROM internship_days WHERE student_id = elif ORDER BY day_date LIMIT 3) d),
    'present', 'aralık kontrolü');
  SELECT n.body INTO v_body FROM notifications n WHERE n.user_id = elif AND n.type = 'internship_attendance' ORDER BY n.created_at DESC LIMIT 1;
  x := substring(v_body from '\((\d{4}-\d{2}-\d{2}) to');
  rep := substring(v_body from 'to (\d{4}-\d{2}-\d{2})\)');
  log := log || 'B8' || E'\t' || CASE WHEN x IS NOT NULL AND rep IS NOT NULL AND x::date <= rep::date THEN 'PASS' ELSE 'FAIL: ' || coalesce(v_body, 'no notification') END || E'\n';

  -- B9 (#4): Ayşe's report reads with real dashes and no mojibake
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
  rep := build_internship_report(ayse, grp);
  log := log || 'B9' || E'\t' || CASE WHEN rep LIKE '# Internship report ' || chr(8212) || ' %' AND rep NOT LIKE '%ÔÇ%' AND rep NOT LIKE '%┬%' THEN 'PASS' ELSE 'FAIL: ' || left(rep, 60) END || E'\n';

  -- B10 (#12): every student's expectedSoFar ≥ recorded, and Burak's unrecorded = 3 weekdays
  att := internship_group_attendance(grp);
  n := 0;
  FOR srow IN SELECT value FROM jsonb_array_elements(att->'students') LOOP
    IF (srow->>'expectedSoFar')::int < (srow->>'recorded')::int THEN n := n + 1; END IF;
  END LOOP;
  SELECT value->>'unrecorded' INTO x FROM jsonb_array_elements(att->'students') WHERE value->>'name' = 'Burak Şahin';
  log := log || 'B10' || E'\t' || CASE WHEN n = 0 AND x = '3' THEN 'PASS' ELSE 'FAIL: ' || n || ' students over-recorded, Burak unrecorded=' || coalesce(x, 'null') END || E'\n';

  PERFORM set_config('probe.results', log, true);
END $$;
SELECT split_part(line, E'\t', 1) AS probe, split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';
ROLLBACK;

-- ============================================================================
-- Part C — policies as the authenticated role. BEGIN..ROLLBACK in one go.
-- ============================================================================
BEGIN;
DO $$
DECLARE deniz uuid := 'bd3a9ee1-832a-43d9-8888-bfb26b79f299'; log text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = deniz) THEN
    PERFORM set_config('probe.results', 'C1-C2' || E'\t' || 'SKIP: simulation accounts absent' || E'\n', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', deniz, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- C1 (#8): a student cannot write an inverted internship period
  BEGIN
    UPDATE student_profiles SET internship_start_date = '2026-09-19', internship_end_date = '2026-09-13' WHERE id = deniz;
    log := log || 'C1' || E'\t' || 'FAIL: inverted dates accepted' || E'\n';
  EXCEPTION WHEN check_violation THEN log := log || 'C1' || E'\t' || 'PASS' || E'\n';
  WHEN OTHERS THEN log := log || 'C1' || E'\t' || 'FAIL: ' || SQLERRM || E'\n'; END;
  -- C2 (#1): a student cannot set mentor_linked_at herself (the column is written by the RPC only)
  BEGIN
    UPDATE student_profiles SET mentor_linked_at = now() - interval '10 years' WHERE id = deniz;
    IF (SELECT mentor_linked_at FROM student_profiles WHERE id = deniz) < now() - interval '9 years' THEN
      log := log || 'C2' || E'\t' || 'FAIL: student rewrote mentor_linked_at' || E'\n';
    ELSE log := log || 'C2' || E'\t' || 'PASS' || E'\n'; END IF;
  EXCEPTION WHEN OTHERS THEN log := log || 'C2' || E'\t' || 'PASS (refused: ' || SQLERRM || ')' || E'\n'; END;
  RESET ROLE;
  PERFORM set_config('probe.results', log, true);
END $$;
SELECT split_part(line, E'\t', 1) AS probe, split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';
ROLLBACK;
