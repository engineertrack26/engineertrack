-- ============================================================
-- Internship days verification. Run in the Supabase SQL editor, one part
-- per submission, after docs/internship-days-migration.sql. Anonymous
-- dollar-quoting only. Nothing here returns personal data.
--   PART A  structural (owner session): tables, no direct grants, functions,
--           private helper, bucket. One row: PASS.
--   PART B  RPC behaviour, owner-run with an impersonated auth.uid(),
--           BEGIN..ROLLBACK. Twelve rows, none FAIL / ABORTED.
--   PART C  privileges and policies evaluated as the authenticated role
--           (SET LOCAL ROLE). Six rows. This is the only real RLS test.
-- Needs an advisor, a student (with a student_profiles row) and a mentor.
-- ============================================================

-- ============================================================
-- PART A — structure. Expected: one row "PASS: structure held".
-- ============================================================
DO $$
DECLARE t TEXT; f TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['internship_placements','internship_days','internship_day_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      RAISE EXCEPTION 'FAIL: table % is missing', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'FAIL: RLS is not enabled on %', t;
    END IF;
    -- Every read and write goes through an RPC: the client role holds no table privilege at all.
    IF has_table_privilege('authenticated', ('public.'||t)::regclass, 'SELECT')
       OR has_table_privilege('authenticated', ('public.'||t)::regclass, 'INSERT')
       OR has_table_privilege('authenticated', ('public.'||t)::regclass, 'UPDATE')
       OR has_table_privilege('authenticated', ('public.'||t)::regclass, 'DELETE') THEN
      RAISE EXCEPTION 'FAIL: authenticated holds a direct privilege on %', t;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['internship_can_student','internship_can_day','internship_people','internship_week','internship_events',
      'internship_open_day','internship_save_log','internship_review','internship_note','internship_totals','internship_tasks',
      'internship_file_allowed','internship_group_attendance','internship_weekdays','internship_notify'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=f) THEN
      RAISE EXCEPTION 'FAIL: %() is missing', f;
    END IF;
  END LOOP;
  -- The two helpers that would be relationship oracles / free notification writers stay internal.
  IF has_function_privilege('authenticated', 'public.internship_can_student(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: internship_can_student is callable by authenticated';
  END IF;
  IF has_function_privilege('authenticated', 'public.internship_notify(uuid,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: internship_notify is callable by authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='internship-day-files' AND NOT public AND file_size_limit=10485760) THEN
    RAISE EXCEPTION 'FAIL: bucket internship-day-files must exist, be private and be limited to 10 MiB';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='internship_files_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='internship_files_insert') THEN
    RAISE EXCEPTION 'FAIL: storage policies for internship-day-files are missing';
  END IF;
  RAISE NOTICE 'PASS: structure held';
END $$;
SELECT 'PASS: structure held' AS result;

-- ============================================================
-- PART B — RPC behaviour. Submit BEGIN..ROLLBACK in one go.
--   B1  student opens today: check-in stamped, attendance pending, log draft
--   B2  opening the same day again returns the same row, check-in unchanged
--   B3  a past day needs a reason; with one, no check-in stamp
--   B4  a draft is redacted for the mentor and the advisor, visible to the student
--   B5  submit: mentor sees the text, exactly one notification to the mentor
--   B6  mentor reviews two days as present: ONE notification to the student
--   B7  advisor correction -> mentor notified; re-review without a note refused;
--       with a note the flag clears and the advisor is notified once
--   B8  stale version -> ID_CONFLICT
--   B9  group attendance report: 1 student, recorded 2, unrecorded = expected so far - 2
--   B10 mentor link removed -> the old mentor is refused
--   B11 archive -> the advisor still reads the week, cannot write a note
--   B12 archive -> a new day cannot be opened (can_message-style closure)
-- Expected: twelve rows, none beginning FAIL / ABORTED.
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; mentor UUID; grp UUID; d1 UUID; d1b UUID; d2 UUID; today DATE; log TEXT := '';
  n INT; m INT; v INT; txt TEXT; att JSONB; rows JSONB;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role='advisor' ORDER BY created_at LIMIT 1;
  SELECT sp.id INTO stu FROM student_profiles sp JOIN profiles p ON p.id=sp.id WHERE p.role='student' ORDER BY p.created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role='mentor' ORDER BY created_at LIMIT 1;
  IF adv IS NULL OR stu IS NULL OR mentor IS NULL THEN
    PERFORM set_config('probe.results', 'B1-B12' || E'\t' || 'SKIP: needs an advisor, a student profile and a mentor' || E'\n', true);
    RETURN;
  END IF;
  today := (now() AT TIME ZONE 'Europe/Istanbul')::date;

  -- Fixture: one active, unarchived group; the student linked to the mentor with a valid internship window.
  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe internship days') RETURNING id INTO grp;
  UPDATE group_memberships SET left_at = now() WHERE student_id = stu AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  UPDATE student_profiles SET mentor_id = mentor, company_name = 'Probe Ltd', internship_start_date = today - 30, internship_end_date = today + 30 WHERE id = stu;
  DELETE FROM internship_days WHERE student_id = stu AND day_date IN (today, today - 1);

  -- B1
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    d1 := internship_open_day(stu, today, 'Europe/Istanbul', '');
    SELECT count(*) INTO n FROM internship_days WHERE id = d1 AND check_in_at IS NOT NULL AND attendance = 'pending' AND log_status = 'draft';
    log := log || 'B1 student opens today' || E'\t' || CASE WHEN n = 1 THEN 'check-in stamped, pending, draft' ELSE 'FAIL: ' || n END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B1 student opens today' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B2
  BEGIN
    SELECT check_in_at::text INTO txt FROM internship_days WHERE id = d1;
    d1b := internship_open_day(stu, today, 'Europe/Istanbul', '');
    SELECT count(*) INTO n FROM internship_days WHERE id = d1 AND check_in_at::text = txt;
    log := log || 'B2 reopening today is idempotent' || E'\t' || CASE WHEN d1b = d1 AND n = 1 THEN 'same row, same check-in' ELSE 'FAIL' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B2 reopening today is idempotent' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B3
  BEGIN
    BEGIN
      PERFORM internship_open_day(stu, today - 1, 'Europe/Istanbul', '');
      log := log || 'B3 past day needs a reason' || E'\t' || 'FAIL: opened without a reason' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'ID_REASON%' THEN RAISE; END IF;
      d2 := internship_open_day(stu, today - 1, 'Europe/Istanbul', 'Forgot to open the app');
      SELECT count(*) INTO n FROM internship_days WHERE id = d2 AND check_in_at IS NULL;
      log := log || 'B3 past day needs a reason' || E'\t' || CASE WHEN n = 1 THEN 'ID_REASON, then opened without a check-in' ELSE 'FAIL: check-in stamped on a past day' END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN log := log || 'B3 past day needs a reason' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B4
  BEGIN
    PERFORM internship_save_log(d1, 1, 'Private draft text', 'Learning', '', 0, false, '', NULL, NULL);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    SELECT x->>'experience' INTO txt FROM jsonb_array_elements(internship_week(stu, today)) x WHERE (x->>'id')::uuid = d1;
    n := CASE WHEN txt = '' THEN 1 ELSE 0 END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    SELECT x->>'experience' INTO txt FROM jsonb_array_elements(internship_week(stu, today)) x WHERE (x->>'id')::uuid = d1;
    m := CASE WHEN txt = '' THEN 1 ELSE 0 END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    SELECT x->>'experience' INTO txt FROM jsonb_array_elements(internship_week(stu, today)) x WHERE (x->>'id')::uuid = d1;
    log := log || 'B4 draft is redacted for mentor and advisor' || E'\t' || CASE WHEN n = 1 AND m = 1 AND txt = 'Private draft text' THEN 'redacted for both, visible to the student' ELSE 'FAIL: mentor ' || n || ' advisor ' || m || ' student ' || coalesce(txt,'NULL') END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B4 draft is redacted for mentor and advisor' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B5
  BEGIN
    DELETE FROM notifications WHERE user_id IN (stu, mentor, adv) AND type LIKE 'internship_%';
    PERFORM internship_save_log(d1, 2, 'Submitted text', 'Learning', 'Tomorrow', 2, true, '', NULL, NULL);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    SELECT x->>'experience' INTO txt FROM jsonb_array_elements(internship_week(stu, today)) x WHERE (x->>'id')::uuid = d1;
    SELECT count(*) INTO n FROM notifications WHERE user_id = mentor AND type = 'internship_log_submitted';
    SELECT count(*) INTO m FROM notifications WHERE user_id <> mentor AND type = 'internship_log_submitted';
    log := log || 'B5 submit shows the text and notifies the mentor once' || E'\t' || CASE WHEN txt = 'Submitted text' AND n = 1 AND m = 0 THEN 'visible, 1 notification' ELSE 'FAIL: text ' || coalesce(txt,'NULL') || ', ' || n || ' to mentor, ' || m || ' to others' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B5 submit shows the text and notifies the mentor once' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B6
  BEGIN
    SELECT version INTO v FROM internship_days WHERE id = d1;
    PERFORM internship_review(jsonb_build_array(jsonb_build_object('id', d1, 'version', v), jsonb_build_object('id', d2, 'version', 1)), 'present', '');
    SELECT count(*) INTO n FROM internship_days WHERE id IN (d1, d2) AND attendance = 'present' AND attendance_by = mentor;
    SELECT count(*) INTO m FROM notifications WHERE user_id = stu AND type = 'internship_attendance';
    log := log || 'B6 mentor reviews two days, student notified once' || E'\t' || CASE WHEN n = 2 AND m = 1 THEN '2 present, 1 notification' ELSE 'FAIL: ' || n || ' present, ' || m || ' notifications' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B6 mentor reviews two days, student notified once' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B7
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    SELECT version INTO v FROM internship_days WHERE id = d1;
    PERFORM internship_note(d1, v, 'Please verify this date', true);
    SELECT count(*) INTO n FROM notifications WHERE user_id = mentor AND type = 'internship_correction';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    SELECT version INTO v FROM internship_days WHERE id = d1;
    BEGIN
      PERFORM internship_review(jsonb_build_array(jsonb_build_object('id', d1, 'version', v)), 'partial', '');
      m := -1;
    EXCEPTION WHEN OTHERS THEN m := CASE WHEN SQLERRM LIKE 'ID_REASON%' THEN 1 ELSE 0 END; END;
    PERFORM internship_review(jsonb_build_array(jsonb_build_object('id', d1, 'version', v)), 'partial', 'Checked with the team');
    SELECT count(*) INTO v FROM internship_days WHERE id = d1 AND attendance = 'partial' AND NOT correction_requested;
    SELECT count(*) INTO n FROM notifications WHERE user_id = adv AND type = 'internship_feedback';
    log := log || 'B7 correction round trip' || E'\t' || CASE WHEN m = 1 AND v = 1 AND n = 1 THEN 'mentor notified, note required, flag cleared, advisor notified once' ELSE 'FAIL: reason ' || m || ', cleared ' || v || ', advisor notifications ' || n END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B7 correction round trip' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B8
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM internship_save_log(d1, 1, 'Stale', 'Learning', '', 0, true, 'edit', NULL, NULL);
      log := log || 'B8 stale version is refused' || E'\t' || 'FAIL: accepted' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'B8 stale version is refused' || E'\t' || CASE WHEN SQLERRM LIKE 'ID_CONFLICT%' THEN 'ID_CONFLICT' ELSE 'FAIL: ' || SQLERRM END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN log := log || 'B8 stale version is refused' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B9
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    att := internship_group_attendance(grp);
    SELECT x INTO rows FROM jsonb_array_elements(att->'students') x WHERE (x->>'id')::uuid = stu;
    log := log || 'B9 group attendance report' || E'\t' || CASE
      WHEN jsonb_array_length(att->'students') = 1 AND (rows->>'recorded')::int = 2 AND (rows->>'present')::int = 1 AND (rows->>'partial')::int = 1
           AND (rows->>'expectedSoFar')::int > 0 AND (rows->>'unrecorded')::int = GREATEST(0, (rows->>'expectedSoFar')::int - 2)
           AND jsonb_array_length(att->'days') = 2 AND NOT (att::text LIKE '%Submitted text%')
      THEN '1 student, 2 recorded, unrecorded = expected so far - 2, no journal text'
      ELSE 'FAIL: ' || coalesce(rows::text, 'no row') END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B9 group attendance report' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B10
  BEGIN
    UPDATE student_profiles SET mentor_id = NULL WHERE id = stu;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM internship_week(stu, today);
      log := log || 'B10 unlinked mentor is refused' || E'\t' || 'FAIL: still reads' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'B10 unlinked mentor is refused' || E'\t' || CASE WHEN SQLERRM LIKE 'ID_FORBIDDEN%' THEN 'ID_FORBIDDEN' ELSE 'FAIL: ' || SQLERRM END || E'\n';
    END;
    UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;
  EXCEPTION WHEN OTHERS THEN log := log || 'B10 unlinked mentor is refused' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B11
  BEGIN
    UPDATE internship_groups SET is_archived = true WHERE id = grp;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    SELECT count(DISTINCT x->>'id') INTO n FROM (SELECT x FROM jsonb_array_elements(internship_week(stu, today - 6)) x UNION ALL SELECT x FROM jsonb_array_elements(internship_week(stu, today)) x) s;
    SELECT version INTO v FROM internship_days WHERE id = d1;
    BEGIN
      PERFORM internship_note(d1, v, 'late note', false);
      m := 0;
    EXCEPTION WHEN OTHERS THEN m := CASE WHEN SQLERRM LIKE 'ID_FORBIDDEN%' THEN 1 ELSE 0 END; END;
    log := log || 'B11 archived: advisor reads, cannot write' || E'\t' || CASE WHEN n = 2 AND m = 1 THEN '2 days readable, note refused' ELSE 'FAIL: ' || n || ' days, refused ' || m END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'B11 archived: advisor reads, cannot write' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  -- B12
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM internship_open_day(stu, today - 2, 'Europe/Istanbul', 'after archive');
      log := log || 'B12 archived: no new day' || E'\t' || 'FAIL: opened' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'B12 archived: no new day' || E'\t' || CASE WHEN SQLERRM LIKE 'ID_SETUP%' OR SQLERRM LIKE 'ID_FORBIDDEN%' THEN split_part(SQLERRM, ' ', 1) ELSE 'FAIL: ' || SQLERRM END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN log := log || 'B12 archived: no new day' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;

-- ============================================================
-- PART C — as the authenticated role. Submit BEGIN..ROLLBACK in one go.
--   C1 direct SELECT on internship_days                permission denied (no table privilege)
--   C2 internship_can_student() from the client        permission denied (stays internal)
--   C3 the student reads their week through the RPC    2 rows   (positive control)
--   C4 another student reads it                        ID_FORBIDDEN   (SKIP without a second student)
--   C5 storage: the attached file is readable by the student and the mentor,
--      invisible to another student                    1 / 1 / 0      (C5c SKIP without a second student)
--   C6 the advisor after the archive: week readable, note refused
-- ============================================================
BEGIN;

DO $$
DECLARE adv UUID; stu UUID; stu2 UUID; mentor UUID; grp UUID; d1 UUID; today DATE; path TEXT;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role='advisor' ORDER BY created_at LIMIT 1;
  SELECT sp.id INTO stu FROM student_profiles sp JOIN profiles p ON p.id=sp.id WHERE p.role='student' ORDER BY p.created_at LIMIT 1;
  SELECT id INTO stu2 FROM profiles WHERE role='student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role='mentor' ORDER BY created_at LIMIT 1;
  IF adv IS NULL OR stu IS NULL OR mentor IS NULL THEN PERFORM set_config('probe.ready', 'no', true); RETURN; END IF;
  today := (now() AT TIME ZONE 'Europe/Istanbul')::date;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe internship days C') RETURNING id INTO grp;
  UPDATE group_memberships SET left_at = now() WHERE student_id IN (stu, stu2) AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  UPDATE student_profiles SET mentor_id = mentor, company_name = 'Probe Ltd', internship_start_date = today - 30, internship_end_date = today + 30 WHERE id = stu;
  DELETE FROM internship_days WHERE student_id = stu AND day_date IN (today, today - 1);

  -- Two days, one submitted with an attachment whose object row exists under the student's path.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  d1 := internship_open_day(stu, today, 'Europe/Istanbul', '');
  PERFORM internship_open_day(stu, today - 1, 'Europe/Istanbul', 'probe');
  path := stu::text || '/' || d1::text || '/probe.pdf';
  -- The object row is seeded directly (no HTTP upload in SQL). If this
  -- database's storage schema refuses the insert, C5 says so instead of
  -- taking every other case down with it.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('internship-day-files', path, stu, stu::text);
    PERFORM internship_save_log(d1, 1, 'Submitted text', 'Learning', '', 1, true, '', NULL, jsonb_build_object('name', 'probe.pdf', 'path', path));
    PERFORM set_config('probe.file', 'yes', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('probe.file', 'no: ' || SQLSTATE || ' ' || SQLERRM, true);
    PERFORM internship_save_log(d1, 1, 'Submitted text', 'Learning', '', 1, true, '', NULL, NULL);
  END;
  PERFORM set_config('request.jwt.claims', '', true);

  PERFORM set_config('probe.ready', 'yes', true);
  PERFORM set_config('probe.adv', adv::text, true); PERFORM set_config('probe.stu', stu::text, true);
  PERFORM set_config('probe.stu2', coalesce(stu2::text, ''), true); PERFORM set_config('probe.mentor', mentor::text, true);
  PERFORM set_config('probe.grp', grp::text, true); PERFORM set_config('probe.d1', d1::text, true);
  PERFORM set_config('probe.today', today::text, true); PERFORM set_config('probe.path', path, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE adv UUID; stu UUID; stu2 UUID; mentor UUID; d1 UUID; today DATE; path TEXT; n INT; m INT; k INT; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results', 'C1-C6' || E'\t' || 'SKIP: needs an advisor, a student profile and a mentor' || E'\n', true); RETURN;
  END IF;
  adv := current_setting('probe.adv')::uuid; stu := current_setting('probe.stu')::uuid; mentor := current_setting('probe.mentor')::uuid;
  stu2 := NULLIF(current_setting('probe.stu2'), '')::uuid; d1 := current_setting('probe.d1')::uuid;
  today := current_setting('probe.today')::date; path := current_setting('probe.path');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  -- C1
  BEGIN
    SELECT count(*) INTO n FROM internship_days WHERE id = d1;
    log := log || 'C1 direct table read' || E'\t' || 'FAIL: authenticated can select internship_days (' || n || ' rows)' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN log := log || 'C1 direct table read' || E'\t' || 'permission denied' || E'\n';
  WHEN OTHERS THEN log := log || 'C1 direct table read' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;
  -- C2
  BEGIN
    PERFORM internship_can_student(stu, stu);
    log := log || 'C2 internal helper from the client' || E'\t' || 'FAIL: callable' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN log := log || 'C2 internal helper from the client' || E'\t' || 'permission denied' || E'\n';
  WHEN OTHERS THEN log := log || 'C2 internal helper from the client' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;
  -- C3
  BEGIN
    SELECT count(DISTINCT x->>'id') INTO n FROM (SELECT x FROM jsonb_array_elements(internship_week(stu, today - 6)) x UNION ALL SELECT x FROM jsonb_array_elements(internship_week(stu, today)) x) s;
    log := log || 'C3 the student reads their week' || E'\t' || CASE WHEN n = 2 THEN '2 rows' ELSE 'FAIL: ' || n END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C3 the student reads their week' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;
  -- C4
  IF stu2 IS NULL THEN
    log := log || 'C4 another student reads it' || E'\t' || 'SKIP: needs a second student' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu2, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM internship_week(stu, today);
      log := log || 'C4 another student reads it' || E'\t' || 'FAIL: readable' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'C4 another student reads it' || E'\t' || CASE WHEN SQLERRM LIKE 'ID_FORBIDDEN%' THEN 'ID_FORBIDDEN' ELSE 'FAIL: ' || SQLERRM END || E'\n';
    END;
  END IF;
  -- C5: storage policy, evaluated for real
  BEGIN
    IF coalesce(current_setting('probe.file', true), 'no') <> 'yes' THEN
      RAISE EXCEPTION USING MESSAGE = 'SEED ' || coalesce(current_setting('probe.file', true), 'no');
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'internship-day-files' AND name = path;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO m FROM storage.objects WHERE bucket_id = 'internship-day-files' AND name = path;
    IF stu2 IS NULL THEN k := -1; ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', stu2, 'role', 'authenticated')::text, true);
      SELECT count(*) INTO k FROM storage.objects WHERE bucket_id = 'internship-day-files' AND name = path;
    END IF;
    log := log || 'C5 attachment visibility (student / mentor / other student)' || E'\t' || CASE WHEN n = 1 AND m = 1 AND k IN (0, -1)
      THEN '1 / 1 / ' || CASE WHEN k = -1 THEN 'SKIP (needs a second student)' ELSE '0' END ELSE 'FAIL: ' || n || ' / ' || m || ' / ' || k END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C5 attachment visibility (student / mentor / other student)' || E'\t'
    || CASE WHEN SQLERRM LIKE 'SEED %' THEN 'SKIP: could not seed a storage object (' || substr(SQLERRM, 6) || ')' ELSE 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM END || E'\n'; END;

  PERFORM set_config('probe.results', log, true);
END $$;

RESET ROLE;
-- C6: archive as the owner, then read and write as the advisor.
DO $$ BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') = 'yes' THEN
    UPDATE internship_groups SET is_archived = true WHERE id = current_setting('probe.grp')::uuid;
  END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE adv UUID; stu UUID; d1 UUID; today DATE; n INT; m INT; log TEXT;
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  adv := current_setting('probe.adv')::uuid; stu := current_setting('probe.stu')::uuid; d1 := current_setting('probe.d1')::uuid;
  today := current_setting('probe.today')::date; log := current_setting('probe.results', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(DISTINCT x->>'id') INTO n FROM (SELECT x FROM jsonb_array_elements(internship_week(stu, today - 6)) x UNION ALL SELECT x FROM jsonb_array_elements(internship_week(stu, today)) x) s;
    BEGIN
      PERFORM internship_note(d1, 2, 'late note', false);
      m := 0;
    EXCEPTION WHEN OTHERS THEN m := CASE WHEN SQLERRM LIKE 'ID_FORBIDDEN%' THEN 1 ELSE 0 END; END;
    log := log || 'C6 advisor after the archive: reads, cannot write' || E'\t' || CASE WHEN n = 2 AND m = 1 THEN '2 rows, note refused' ELSE 'FAIL: ' || n || ' rows, refused ' || m END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C6 advisor after the archive: reads, cannot write' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;
  PERFORM set_config('probe.results', log, true);
END $$;
RESET ROLE;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;

-- ============================================================
-- Reference listings (owner session, no assertions) — for inspection.
-- ============================================================
SELECT p.oid::regprocedure AS function, p.prosecdef AS security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_must_be_false,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'internship_%' ORDER BY p.proname;
-- authenticated must be false for internship_can_student and internship_notify.

SELECT schemaname,tablename,policyname,cmd,roles,qual,with_check FROM pg_policies
WHERE (schemaname='public' AND tablename IN ('internship_placements','internship_days','internship_day_events'))
   OR (schemaname='storage' AND tablename='objects')
ORDER BY schemaname,tablename,policyname;
-- Inspect ALL storage policies: permissive policies are ORed, so a broad one
-- elsewhere would widen internship-day-files regardless of ours.
