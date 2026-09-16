-- ============================================================
-- Internship closure verification. Run in the Supabase SQL editor, one part
-- per submission. Anonymous dollar-quoting only.
-- Apply order: docs/internship-closure-migration.sql, then
-- docs/internship-closure-guards.sql, then this file.
-- PART A is STRUCTURAL (owner session bypasses RLS) -- it proves existence
-- and grants, not evaluability. Part B (owner-run, impersonated) is RPC
-- behaviour. Part C (SET LOCAL ROLE authenticated) is the only real RLS test.
-- ============================================================

-- ============================================================
-- PART A — schema assertions. Expected: one row "PASS: schema assertions held".
-- ============================================================
DO $$
DECLARE n INT;
BEGIN
  -- Table + columns.
  IF to_regclass('public.internship_closures') IS NULL THEN
    RAISE EXCEPTION 'FAIL: internship_closures table is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'internship_closures' AND column_name = 'student_id'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures.student_id is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'internship_closures' AND column_name = 'group_id'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures.group_id is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'internship_closures' AND column_name = 'report_md'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures.report_md is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'internship_closures' AND column_name = 'report_version'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures.report_version is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'internship_closures' AND column_name = 'reopen_reason'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures.reopen_reason is missing';
  END IF;

  -- UNIQUE (student_id, group_id) -- one closure row per pair, the target of
  -- close_internship's ON CONFLICT.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'internship_closures'::regclass AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures has no UNIQUE constraint (expected student_id, group_id)';
  END IF;

  -- RLS on, a SELECT policy exists, and nothing else does -- every write goes
  -- through the SECURITY DEFINER RPCs, never a direct client write.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'internship_closures' AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures does not have row level security enabled';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'internship_closures' AND cmd = 'SELECT';
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL: internship_closures has no SELECT policy';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'internship_closures' AND cmd IN ('INSERT','UPDATE','DELETE','ALL');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: internship_closures has a direct write policy (% found) -- writes must go through the RPCs', n;
  END IF;

  -- Internal functions: present, but not directly callable by a client.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'internship_closed') THEN
    RAISE EXCEPTION 'FAIL: internship_closed is missing';
  END IF;
  IF has_function_privilege('authenticated', 'internship_closed(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: internship_closed is executable by authenticated -- it must be internal only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'build_internship_report') THEN
    RAISE EXCEPTION 'FAIL: build_internship_report is missing';
  END IF;
  IF has_function_privilege('authenticated', 'build_internship_report(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: build_internship_report is executable by authenticated -- it must be internal only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'closure_reached_level') THEN
    RAISE EXCEPTION 'FAIL: closure_reached_level is missing';
  END IF;
  IF has_function_privilege('authenticated', 'closure_reached_level(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: closure_reached_level is executable by authenticated -- it must be internal only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'closure_level_word') THEN
    RAISE EXCEPTION 'FAIL: closure_level_word is missing';
  END IF;

  -- The four public RPCs, granted to authenticated.
  IF NOT has_function_privilege('authenticated', 'close_internship(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: close_internship is not granted to authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'reopen_internship(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: reopen_internship is not granted to authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'get_internship_report(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: get_internship_report is not granted to authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'internship_closure_status(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: internship_closure_status is not granted to authenticated';
  END IF;

  RAISE NOTICE 'PASS: schema assertions held';
END $$;
SELECT 'PASS: schema assertions held' AS result;

-- ============================================================
-- PART B — RPC behaviour, owner-run with impersonated auth.uid(). Submit
-- BEGIN..ROLLBACK in one go. Fixture as docs/self-assessment-verification.sql
-- Part B: group, targets via the trigger, two published tasks, student linked
-- to a mentor; plus, when internship_placements exists, one internship day
-- opened via internship_open_day before closing (so the module has a
-- placement in place; a NEW day after closing is what B4 tests). The
-- reflection on the first task is the literal string 'PRIVATE_REFLECTION_MARKER',
-- so B2 can assert its absence from the report (spec decision 6).
--   B1  close with a submitted row               -> PENDING_REVIEWS: 1; mentor then approves it (level 3)
--   B2  close                                     -> closed row, reportVersion=1, 2 notifications, report has the
--                                                     student's first name and the task title, not the reflection marker
--   B3  submit another task                       -> INTERNSHIP_CLOSED
--   B4  internship_open_day a new day             -> INTERNSHIP_CLOSED (SKIP when internship_placements is absent)
--   B5  send_message in the pre-opened conversation -> INTERNSHIP_CLOSED
--   B6  mentor review_assignment on the closed student -> INTERNSHIP_CLOSED
--   B7  a stream comment on the task's post        -> still accepted (owner session; RLS not evaluated here)
--   B8  close again                                -> ALREADY_CLOSED
--   B9  reopen without a reason                    -> REASON_REQUIRED
--   B10 reopen with a reason                       -> closed=false, 2 more notifications, submit works again
--   B11 close again                                -> reportVersion=2
--   B12 get_internship_report as the student and as the mentor -> both start with "# Internship report"
--   B13 get_internship_report as a second advisor  -> REPORT_FORBIDDEN (SKIP without a second advisor)
-- Expected: thirteen rows, none beginning FAIL / ABORTED (SKIP is fine for B4
-- without the internship-days module and B13 without a second advisor).
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; adv2 UUID; stu UUID; mentor UUID; grp UUID;
  triplet_a UUID; triplet_b UUID; asg_a UUID; asg_b UUID; sub_a UUID; sub_b UUID;
  conv UUID; post_a UUID; day_a UUID;
  v_stu_first TEXT; v_close JSONB; v_status JSONB; v_report TEXT; v_report2 TEXT;
  n INT; m INT; v_comments_before INT; v_comments_after INT;
  module_present BOOLEAN; today DATE;
  log TEXT := '';
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO adv2 FROM profiles WHERE role = 'advisor' AND id <> adv ORDER BY created_at LIMIT 1;
  SELECT p.id INTO stu FROM profiles p JOIN student_profiles sp ON sp.id = p.id
    WHERE p.role = 'student' ORDER BY p.created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role = 'mentor' ORDER BY created_at LIMIT 1;
  SELECT tr.id INTO triplet_a FROM kpi_triplets tr ORDER BY tr.kpi_id, tr.triplet_index LIMIT 1;
  SELECT tr.id INTO triplet_b FROM kpi_triplets tr WHERE tr.id <> triplet_a ORDER BY tr.kpi_id, tr.triplet_index LIMIT 1;
  module_present := to_regclass('public.internship_placements') IS NOT NULL;
  today := current_date;

  IF adv IS NULL OR stu IS NULL OR mentor IS NULL OR triplet_a IS NULL OR triplet_b IS NULL THEN
    PERFORM set_config('probe.results', 'B1-B13' || E'\t' || 'SKIP: needs an advisor, a student, a mentor and two triplets' || E'\n', true);
    RETURN;
  END IF;

  SELECT trim(coalesce(p.first_name, '')) INTO v_stu_first FROM profiles p WHERE p.id = stu;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe internship closure') RETURNING id INTO grp;
  UPDATE group_memberships SET left_at = now() WHERE student_id = stu AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  UPDATE student_profiles SET mentor_id = mentor, company_name = 'Probe Closure Ltd',
    internship_start_date = today - 60, internship_end_date = today + 60 WHERE id = stu;
  -- Clear any stale closure row from a previous run of this file.
  DELETE FROM internship_closures WHERE student_id = stu AND group_id = grp;

  -- tr_seed_group_competency_targets seeds every competency as a target the
  -- moment internship_groups gets this row, so NOT_IN_SCOPE never fires below.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe closure task A', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.id = triplet_a
  RETURNING id INTO asg_a;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe closure task B', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.id = triplet_b
  RETURNING id INTO asg_b;

  -- One task left 'submitted' on purpose -- B1 needs a pending review to refuse.
  -- The reflection is the fixture's private marker so B2 can assert its absence.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  sub_a := submit_assignment(asg_a, 'note', 'PRIVATE_REFLECTION_MARKER', '[]'::jsonb, '[]'::jsonb, 2::smallint);

  -- The member conversation must exist BEFORE closure -- send_message (B5) is
  -- what the guard blocks, not open_conversation, and open_conversation
  -- itself would also now be guarded once the student is closed.
  conv := open_conversation(grp, adv);

  IF module_present THEN
    -- A day opened while the record is still open, so the placement exists;
    -- B4 tries a NEW day after closure, which is what the guard must catch.
    day_a := internship_open_day(stu, today - 5, 'Europe/Istanbul', 'probe backfill');
  END IF;

  -- B1
  BEGIN
    BEGIN
      PERFORM close_internship(stu, grp);
      log := log || 'B1 close with a pending review' || E'\t' || 'FAIL: accepted with a submitted row outstanding' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      IF coalesce(SQLERRM, '') <> 'PENDING_REVIEWS: 1' THEN
        log := log || 'B1 close with a pending review' || E'\t' || 'FAIL: ' || coalesce(SQLERRM, 'NULL') || E'\n';
      ELSE
        PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
        PERFORM review_assignment(sub_a, true, 'approved', 3::smallint);
        log := log || 'B1 close with a pending review' || E'\t' || 'PENDING_REVIEWS: 1, mentor then approved (level 3)' || E'\n';
      END IF;
    END;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B1 close with a pending review' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B2
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    v_close := close_internship(stu, grp);
    v_status := internship_closure_status(stu, grp);
    SELECT count(*) INTO n FROM notifications WHERE type = 'internship_closed'
      AND data->>'studentId' = stu::text AND data->>'groupId' = grp::text;
    SELECT report_md INTO v_report FROM internship_closures WHERE student_id = stu AND group_id = grp;
    log := log || 'B2 close' || E'\t'
        || CASE WHEN coalesce(v_stu_first, '') = '' THEN 'FAIL: the probe student has no first_name to verify the report against'
                WHEN (v_status->>'closed')::boolean IS TRUE
                 AND (v_close->>'reportVersion')::int = 1
                 AND n = 2
                 AND v_report ILIKE '%' || v_stu_first || '%'
                 AND v_report ILIKE '%Probe closure task A%'
                 AND v_report NOT ILIKE '%PRIVATE_REFLECTION_MARKER%'
                THEN 'closed=true, reportVersion=1, 2 notifications, report has name+task, no reflection'
                ELSE 'FAIL: closed=' || coalesce(v_status->>'closed', 'NULL') || ' version=' || coalesce(v_close->>'reportVersion', 'NULL')
                     || ' notifications=' || coalesce(n::text, 'NULL') || ' report=' || coalesce(left(v_report, 40), 'NULL') END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B2 close' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B3
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM submit_assignment(asg_b, 'note', 'reflection', '[]'::jsonb, '[]'::jsonb, 2::smallint);
      log := log || 'B3 submit another task' || E'\t' || 'FAIL: accepted' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'B3 submit another task' || E'\t'
          || CASE WHEN SQLERRM LIKE 'INTERNSHIP_CLOSED%' THEN 'INTERNSHIP_CLOSED' ELSE 'FAIL: ' || coalesce(SQLERRM, 'NULL') END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B3 submit another task' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B4
  BEGIN
    IF NOT module_present THEN
      log := log || 'B4 internship_open_day a new day' || E'\t' || 'SKIP: internship_placements module is absent' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM internship_open_day(stu, today, 'Europe/Istanbul', '');
        log := log || 'B4 internship_open_day a new day' || E'\t' || 'FAIL: accepted' || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || 'B4 internship_open_day a new day' || E'\t'
            || CASE WHEN SQLERRM LIKE 'INTERNSHIP_CLOSED%' THEN 'INTERNSHIP_CLOSED' ELSE 'FAIL: ' || coalesce(SQLERRM, 'NULL') END || E'\n';
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B4 internship_open_day a new day' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B5
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM send_message(conv, 'hello after close');
      log := log || 'B5 send_message in the pre-opened conversation' || E'\t' || 'FAIL: accepted' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'B5 send_message in the pre-opened conversation' || E'\t'
          || CASE WHEN SQLERRM LIKE 'INTERNSHIP_CLOSED%' THEN 'INTERNSHIP_CLOSED' ELSE 'FAIL: ' || coalesce(SQLERRM, 'NULL') END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B5 send_message in the pre-opened conversation' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B6
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM review_assignment(sub_a, false, 'redo needed');
      log := log || 'B6 mentor review_assignment on the closed student' || E'\t' || 'FAIL: accepted' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'B6 mentor review_assignment on the closed student' || E'\t'
          || CASE WHEN SQLERRM LIKE 'INTERNSHIP_CLOSED%' THEN 'INTERNSHIP_CLOSED' ELSE 'FAIL: ' || coalesce(SQLERRM, 'NULL') END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B6 mentor review_assignment on the closed student' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B7: comments are direct INSERTs under RLS (docs/group-feed-migration.sql
  -- feed_comments_insert). This is the owner session, so RLS is not evaluated
  -- here -- the assertion is only that the closure guard (decision 3: stream
  -- likes/comments stay open) does not reject the write itself.
  BEGIN
    SELECT id INTO post_a FROM feed_posts WHERE submission_id = sub_a;
    IF post_a IS NULL THEN
      log := log || 'B7 a stream comment on the task''s post' || E'\t' || 'FAIL: no feed post for the approved task' || E'\n';
    ELSE
      SELECT count(*) INTO v_comments_before FROM feed_comments WHERE post_id = post_a;
      INSERT INTO feed_comments (post_id, author_id, body) VALUES (post_a, stu, 'still open after closure');
      SELECT count(*) INTO v_comments_after FROM feed_comments WHERE post_id = post_a;
      log := log || 'B7 a stream comment on the task''s post' || E'\t'
          || CASE WHEN v_comments_after = v_comments_before + 1
                  THEN 'insert accepted (owner session -- RLS not evaluated here; see Part C for a real policy test elsewhere in the suite)'
                  ELSE 'FAIL: comment count ' || coalesce(v_comments_before::text, 'NULL') || ' -> ' || coalesce(v_comments_after::text, 'NULL') END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B7 a stream comment on the task''s post' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B8
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM close_internship(stu, grp);
      log := log || 'B8 close again' || E'\t' || 'FAIL: accepted' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'B8 close again' || E'\t'
          || CASE WHEN SQLERRM LIKE 'ALREADY_CLOSED%' THEN 'ALREADY_CLOSED' ELSE 'FAIL: ' || coalesce(SQLERRM, 'NULL') END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B8 close again' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B9
  BEGIN
    BEGIN
      PERFORM reopen_internship(stu, grp, NULL);
      log := log || 'B9 reopen without a reason' || E'\t' || 'FAIL: accepted' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'B9 reopen without a reason' || E'\t'
          || CASE WHEN SQLERRM LIKE 'REASON_REQUIRED%' THEN 'REASON_REQUIRED' ELSE 'FAIL: ' || coalesce(SQLERRM, 'NULL') END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B9 reopen without a reason' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B10
  BEGIN
    PERFORM reopen_internship(stu, grp, 'Needs another round of tasks');
    v_status := internship_closure_status(stu, grp);
    SELECT count(*) INTO m FROM notifications WHERE type = 'internship_reopened'
      AND data->>'studentId' = stu::text AND data->>'groupId' = grp::text;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    sub_b := submit_assignment(asg_b, 'note', 'reflection', '[]'::jsonb, '[]'::jsonb, 2::smallint);
    -- Clear the pending review this submission just created, so B11 can close again.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    PERFORM review_assignment(sub_b, true, 'approved', 2::smallint);
    log := log || 'B10 reopen with a reason' || E'\t'
        || CASE WHEN (v_status->>'closed')::boolean IS FALSE AND m = 2 AND sub_b IS NOT NULL
                THEN 'closed=false, 2 notifications, submit works again'
                ELSE 'FAIL: closed=' || coalesce(v_status->>'closed', 'NULL') || ' notifications=' || coalesce(m::text, 'NULL')
                     || ' sub=' || coalesce(sub_b::text, 'NULL') END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B10 reopen with a reason' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B11
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    v_close := close_internship(stu, grp);
    log := log || 'B11 close again' || E'\t'
        || CASE WHEN (v_close->>'reportVersion')::int = 2 THEN 'reportVersion=2'
                ELSE 'FAIL: reportVersion=' || coalesce(v_close->>'reportVersion', 'NULL') END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B11 close again' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B12
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    v_report := get_internship_report(stu, grp);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    v_report2 := get_internship_report(stu, grp);
    log := log || 'B12 report readable by student and mentor' || E'\t'
        || CASE WHEN left(v_report, 20) = '# Internship report' AND left(v_report2, 20) = '# Internship report'
                THEN 'both start with "# Internship report"'
                ELSE 'FAIL: student=' || coalesce(left(v_report, 20), 'NULL') || ' mentor=' || coalesce(left(v_report2, 20), 'NULL') END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B12 report readable by student and mentor' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- B13
  BEGIN
    IF adv2 IS NULL THEN
      log := log || 'B13 a second advisor is refused' || E'\t' || 'SKIP: needs a second advisor' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', adv2, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM get_internship_report(stu, grp);
        log := log || 'B13 a second advisor is refused' || E'\t' || 'FAIL: readable' || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || 'B13 a second advisor is refused' || E'\t'
            || CASE WHEN SQLERRM LIKE 'REPORT_FORBIDDEN%' THEN 'REPORT_FORBIDDEN' ELSE 'FAIL: ' || coalesce(SQLERRM, 'NULL') END || E'\n';
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B13 a second advisor is refused' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;

-- ============================================================
-- PART C — the policies, actually evaluated (SET LOCAL ROLE authenticated).
-- Submit BEGIN..ROLLBACK in one go.
--   C1 the student's direct SELECT on internship_closures    1 row
--   C2 the mentor's direct SELECT                            1 row
--   C3 a second student's direct SELECT                      0 rows (SKIP without one)
--   C4 internship_closure_status as the student               closed = true
-- Needs an advisor, a student, a mentor (linked) and a KPI triplet; C3 needs
-- a second student and SKIPs otherwise.
-- Expected: four rows, none beginning FAIL / ABORTED (SKIP is fine for C3
-- without a second student).
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; stu2 UUID; mentor UUID; grp UUID; triplet UUID; asg UUID; sub UUID;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT p.id INTO stu FROM profiles p JOIN student_profiles sp ON sp.id = p.id
    WHERE p.role = 'student' ORDER BY p.created_at LIMIT 1;
  SELECT id INTO stu2 FROM profiles WHERE role = 'student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role = 'mentor' ORDER BY created_at LIMIT 1;
  SELECT tr.id INTO triplet FROM kpi_triplets tr ORDER BY tr.kpi_id, tr.triplet_index LIMIT 1;
  IF adv IS NULL OR stu IS NULL OR mentor IS NULL OR triplet IS NULL THEN
    PERFORM set_config('probe.ready', 'no', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe internship closure C') RETURNING id INTO grp;
  UPDATE group_memberships SET left_at = now() WHERE student_id IN (stu, stu2) AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;
  DELETE FROM internship_closures WHERE student_id = stu AND group_id = grp;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe closure C task', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.id = triplet
  RETURNING id INTO asg;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  sub := submit_assignment(asg, 'note', 'reflection', '[]'::jsonb, '[]'::jsonb, 2::smallint);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
  PERFORM review_assignment(sub, true, 'ok', 2::smallint);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
  PERFORM close_internship(stu, grp);

  PERFORM set_config('probe.ready', 'yes', true);
  PERFORM set_config('probe.adv', adv::text, true);
  PERFORM set_config('probe.stu', stu::text, true);
  PERFORM set_config('probe.stu2', coalesce(stu2::text, ''), true);
  PERFORM set_config('probe.mentor', mentor::text, true);
  PERFORM set_config('probe.grp', grp::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE stu UUID; stu2 UUID; mentor UUID; grp UUID; n INT; v_status JSONB; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results', 'C1-C4' || E'\t' || 'SKIP: needs an advisor, a student, a mentor and a KPI triplet' || E'\n', true);
    RETURN;
  END IF;
  stu := current_setting('probe.stu')::uuid;
  stu2 := NULLIF(current_setting('probe.stu2'), '')::uuid;
  mentor := current_setting('probe.mentor')::uuid;
  grp := current_setting('probe.grp')::uuid;

  -- C1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM internship_closures WHERE student_id = stu AND group_id = grp;
    log := log || 'C1 the student''s direct SELECT' || E'\t' || CASE WHEN n = 1 THEN '1 row' ELSE 'FAIL: ' || coalesce(n::text, 'NULL') || ' rows' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C1 the student''s direct SELECT' || E'\t' || 'ABORTED: ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- C2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM internship_closures WHERE student_id = stu AND group_id = grp;
    log := log || 'C2 the mentor''s direct SELECT' || E'\t' || CASE WHEN n = 1 THEN '1 row' ELSE 'FAIL: ' || coalesce(n::text, 'NULL') || ' rows' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C2 the mentor''s direct SELECT' || E'\t' || 'ABORTED: ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  -- C3
  IF stu2 IS NULL THEN
    log := log || 'C3 a second student''s direct SELECT' || E'\t' || 'SKIP: needs a second student' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu2, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO n FROM internship_closures WHERE student_id = stu AND group_id = grp;
      log := log || 'C3 a second student''s direct SELECT' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: ' || coalesce(n::text, 'NULL') || ' rows leaked' END || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'C3 a second student''s direct SELECT' || E'\t' || 'ABORTED: ' || coalesce(SQLERRM, 'NULL') || E'\n';
    END;
  END IF;

  -- C4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN
    v_status := internship_closure_status(stu, grp);
    log := log || 'C4 internship_closure_status as the student' || E'\t'
        || CASE WHEN (v_status->>'closed')::boolean IS TRUE THEN 'closed=true'
                ELSE 'FAIL: closed=' || coalesce(v_status->>'closed', 'NULL') END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C4 internship_closure_status as the student' || E'\t' || 'ABORTED: ' || coalesce(SQLERRM, 'NULL') || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

RESET ROLE;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;
