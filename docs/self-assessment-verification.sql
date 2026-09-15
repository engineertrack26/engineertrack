-- ============================================================
-- Self-assessment verification. Run in the Supabase SQL editor, one part
-- per submission. Anonymous dollar-quoting only.
-- Apply order: docs/self-assessment-migration.sql, then this file.
-- PART A is STRUCTURAL (owner session bypasses RLS). Part C evaluates the
-- policies under SET LOCAL ROLE authenticated -- the only real RLS test;
-- Part A and Part B prove existence and RPC behaviour, not evaluability.
-- ============================================================

-- ============================================================
-- PART A — schema assertions. Expected: one row "PASS: schema assertions held".
-- ============================================================
DO $$
DECLARE n INT; args TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assignment_submissions' AND column_name = 'self_level'
  ) THEN
    RAISE EXCEPTION 'FAIL: assignment_submissions.self_level is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assignment_submissions' AND column_name = 'mentor_level'
  ) THEN
    RAISE EXCEPTION 'FAIL: assignment_submissions.mentor_level is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_submissions_self_level_range') THEN
    RAISE EXCEPTION 'FAIL: assignment_submissions_self_level_range CHECK is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_submissions_mentor_level_range') THEN
    RAISE EXCEPTION 'FAIL: assignment_submissions_mentor_level_range CHECK is missing';
  END IF;

  -- submit_assignment: the 5-arg overload must be GONE, not merely shadowed --
  -- PostgREST resolves overloads by argument name, so a stray 5-arg copy would
  -- keep answering a client that has not yet sent the sixth argument.
  SELECT count(*) INTO n FROM pg_proc WHERE proname = 'submit_assignment';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: submit_assignment has % overload(s) in the catalog, expected exactly 1', n;
  END IF;
  SELECT pg_get_function_identity_arguments(oid) INTO args FROM pg_proc WHERE proname = 'submit_assignment';
  IF args NOT LIKE '%smallint' THEN
    RAISE EXCEPTION 'FAIL: submit_assignment(%) does not end in the new smallint parameter', args;
  END IF;

  -- review_assignment: same overload-count argument, plus an explicit arity
  -- check since "ends in smallint" alone would also match a stray 3-arg
  -- version that happened to add an unrelated smallint.
  SELECT count(*) INTO n FROM pg_proc WHERE proname = 'review_assignment';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: review_assignment has % overload(s) in the catalog, expected exactly 1', n;
  END IF;
  SELECT pg_get_function_identity_arguments(oid) INTO args FROM pg_proc WHERE proname = 'review_assignment';
  IF args NOT LIKE '%smallint' OR array_length(string_to_array(args, ','), 1) <> 4 THEN
    RAISE EXCEPTION 'FAIL: review_assignment(%) is not the 4-argument signature ending in smallint', args;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'competency_self_vs_mentor') THEN
    RAISE EXCEPTION 'FAIL: competency_self_vs_mentor is missing';
  END IF;
  IF NOT has_function_privilege('authenticated', 'competency_self_vs_mentor(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: competency_self_vs_mentor is not granted to authenticated';
  END IF;

  -- Privacy boundary (spec decision 5): the stream projection must never carry
  -- either rating. list_feed_posts has exactly one definition in the catalog
  -- (docs/group-feed-read.sql is the only file that creates it), so resolving
  -- it by name alone is safe -- a second overload would make this subquery
  -- raise "more than one row", which is itself a FAIL worth seeing.
  IF pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname = 'list_feed_posts')) ILIKE '%self_level%'
     OR pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname = 'list_feed_posts')) ILIKE '%mentor_level%' THEN
    RAISE EXCEPTION 'FAIL: list_feed_posts mentions a rating column -- evaluation data leaking into the stream';
  END IF;

  RAISE NOTICE 'PASS: schema assertions held';
END $$;
SELECT 'PASS: schema assertions held' AS result;

-- ============================================================
-- PART B — RPC behaviour, owner-run with impersonated auth.uid().
-- Submit BEGIN..ROLLBACK in one go. Needs an advisor, a student, a mentor
-- (linked to the student) and a KPI with at least two triplets.
--   B1  submit without a self level                    -> SELF_LEVEL_REQUIRED
--   B2  submit with self level 1                        -> self_level=1, mentor_level NULL
--   B3  mentor approves without a level                 -> LEVEL_REQUIRED, status still 'submitted'
--   B4  mentor approves with level 3                    -> mentor_level=3, status='approved', 1 kpi_observations row
--   B5  mentor requests revision                        -> mentor_level NULL, observation gone
--   B6  resubmit with self level 2, approve with level 2 -> competency_self_vs_mentor(stu): tasks=1, avgSelf=2.0, avgMentor=2.0, gap=0.0
--   B7  a second task, self 3 / mentor 1                -> that competency row: tasks=2, gap=-1.0, overRated=1, underRated=0
--   B8  a second mentor is forbidden; the student themself is not
--   B9  the advisor reads it                            -> rows returned
--   B10 list_feed_posts(grp) carries no rating
-- Expected: ten rows, none beginning FAIL / ABORTED (SKIP is fine when the
-- database has no second mentor for B8, or fewer than two triplets on the KPI
-- for B7 -- both print SKIP rather than silently passing).
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; mentor UUID; mentor2 UUID; grp UUID; kpi UUID;
  asg UUID; asg2 UUID; sub UUID; sub2 UUID;
  v_self SMALLINT; v_mentor SMALLINT; v_status TEXT;
  v_rows INT; v_tasks INT; v_avgself NUMERIC; v_avgmentor NUMERIC; v_gap NUMERIC;
  v_over INT; v_under INT; v_text TEXT;
  n INT; m INT; log TEXT := '';
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role = 'mentor' ORDER BY created_at LIMIT 1;
  SELECT id INTO mentor2 FROM profiles WHERE role = 'mentor' AND id <> mentor ORDER BY created_at LIMIT 1;
  SELECT k.id INTO kpi FROM competency_kpis k WHERE k.level = 1 ORDER BY k.kpi_index LIMIT 1;

  IF adv IS NULL OR stu IS NULL OR mentor IS NULL OR kpi IS NULL THEN
    PERFORM set_config('probe.results', 'B1-B10' || E'\t' || 'SKIP: needs an advisor, a student, a mentor and a KPI' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe self-assessment') RETURNING id INTO grp;
  UPDATE group_memberships SET left_at = now() WHERE student_id = stu AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;

  -- tr_seed_group_competency_targets seeds every competency as a target the
  -- moment internship_groups gets this row, so both triplets below are
  -- already in scope and review_assignment's NOT_IN_SCOPE guard never fires.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe self-assessment task', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index LIMIT 1
  RETURNING id INTO asg;

  -- A second task under the same KPI, so B7 lands in the SAME competency row
  -- as B6 rather than needing a second KPI.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe self-assessment task 2', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 1 LIMIT 1
  RETURNING id INTO asg2;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);

  -- B1
  BEGIN
    PERFORM submit_assignment(asg, 'note', 'reflection', '[]'::jsonb, '[]'::jsonb);
    log := log || 'B1 submit without a self level' || E'\t' || 'FAIL: accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B1 submit without a self level' || E'\t'
        || CASE WHEN SQLERRM LIKE 'SELF_LEVEL_REQUIRED%' THEN 'SELF_LEVEL_REQUIRED' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;

  -- B2
  BEGIN
    sub := submit_assignment(asg, 'note', 'reflection', '[]'::jsonb, '[]'::jsonb, 1);
    SELECT s.self_level, s.mentor_level INTO v_self, v_mentor FROM assignment_submissions s WHERE s.id = sub;
    log := log || 'B2 submit with self level 1' || E'\t'
        || CASE WHEN v_self = 1 AND v_mentor IS NULL THEN 'self_level=1, mentor_level NULL'
                ELSE 'FAIL: self_level=' || coalesce(v_self::text, 'NULL') || ' mentor_level=' || coalesce(v_mentor::text, 'NULL') END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B2 submit with self level 1' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
  BEGIN
    BEGIN
      PERFORM review_assignment(sub, true, 'looks good');
      log := log || 'B3 mentor approves without a level' || E'\t' || 'FAIL: accepted' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      SELECT status INTO v_status FROM assignment_submissions WHERE id = sub;
      log := log || 'B3 mentor approves without a level' || E'\t'
          || CASE WHEN SQLERRM LIKE 'LEVEL_REQUIRED%' AND v_status = 'submitted' THEN 'LEVEL_REQUIRED, status still submitted'
                  ELSE 'FAIL: ' || SQLERRM || ', status=' || v_status END || E'\n';
    END;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B3 mentor approves without a level' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B4
  BEGIN
    PERFORM review_assignment(sub, true, 'looks good', 3);
    SELECT s.mentor_level, s.status INTO v_mentor, v_status FROM assignment_submissions s WHERE s.id = sub;
    SELECT count(*) INTO n FROM kpi_observations o WHERE o.assignment_submission_id = sub;
    log := log || 'B4 mentor approves with level 3' || E'\t'
        || CASE WHEN v_mentor = 3 AND v_status = 'approved' AND n = 1
                THEN 'mentor_level=3, approved, 1 observation'
                ELSE 'FAIL: mentor_level=' || coalesce(v_mentor::text, 'NULL') || ' status=' || v_status || ' observations=' || n END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B4 mentor approves with level 3' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B5
  BEGIN
    PERFORM review_assignment(sub, false, 'redo');
    SELECT s.mentor_level INTO v_mentor FROM assignment_submissions s WHERE s.id = sub;
    SELECT count(*) INTO n FROM kpi_observations o WHERE o.assignment_submission_id = sub;
    log := log || 'B5 revision request clears the mentor rating' || E'\t'
        || CASE WHEN v_mentor IS NULL AND n = 0 THEN 'mentor_level NULL, observation gone'
                ELSE 'FAIL: mentor_level=' || coalesce(v_mentor::text, 'NULL') || ' observations=' || n END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B5 revision request clears the mentor rating' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B6: resubmit re-rates the same task (self 1 -> 2), approval re-rates it
  -- too (mentor 3 -> 2). One approved task with both ratings equal, so the
  -- competency row's gap is exactly 0.0.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    PERFORM submit_assignment(asg, 'note', 'reflection', '[]'::jsonb, '[]'::jsonb, 2);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    PERFORM review_assignment(sub, true, 'ok now', 2);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    SELECT count(*), max((x->>'tasks')::int), max((x->>'avgSelf')::numeric), max((x->>'avgMentor')::numeric), max((x->>'gap')::numeric)
      INTO v_rows, v_tasks, v_avgself, v_avgmentor, v_gap
      FROM competency_self_vs_mentor(stu) x;
    log := log || 'B6 resubmit 2 / approve 2 -> comparison row' || E'\t'
        || CASE WHEN v_rows = 1 AND v_tasks = 1 AND v_avgself = 2.0 AND v_avgmentor = 2.0 AND v_gap = 0.0
                THEN 'tasks=1, avgSelf=2.0, avgMentor=2.0, gap=0.0'
                ELSE 'FAIL: rows=' || v_rows || ' tasks=' || v_tasks || ' avgSelf=' || v_avgself || ' avgMentor=' || v_avgmentor || ' gap=' || v_gap END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B6 resubmit 2 / approve 2 -> comparison row' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B7: second task, self 3 / mentor 1. Together with B6's (self 2, mentor 2)
  -- row: avgSelf = (2+3)/2 = 2.5, avgMentor = (2+1)/2 = 1.5,
  -- gap = avgMentor - avgSelf = 1.5 - 2.5 = -1.0. self > mentor on this task
  -- only, so overRated=1, underRated=0.
  BEGIN
    IF asg2 IS NULL THEN
      log := log || 'B7 a second task, self 3 / mentor 1' || E'\t' || 'SKIP: the KPI has fewer than two triplets' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
      sub2 := submit_assignment(asg2, 'note', 'reflection', '[]'::jsonb, '[]'::jsonb, 3);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
      PERFORM review_assignment(sub2, true, 'ok', 1);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
      SELECT count(*), max((x->>'tasks')::int), max((x->>'gap')::numeric),
             max((x->>'overRated')::int), max((x->>'underRated')::int)
        INTO v_rows, v_tasks, v_gap, v_over, v_under
        FROM competency_self_vs_mentor(stu) x;
      log := log || 'B7 a second task, self 3 / mentor 1' || E'\t'
          || CASE WHEN v_rows = 1 AND v_tasks = 2 AND v_gap = -1.0 AND v_over = 1 AND v_under = 0
                  THEN 'tasks=2, gap=-1.0, overRated=1, underRated=0'
                  ELSE 'FAIL: rows=' || v_rows || ' tasks=' || v_tasks || ' gap=' || v_gap || ' overRated=' || v_over || ' underRated=' || v_under END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B7 a second task, self 3 / mentor 1' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B8
  BEGIN
    IF mentor2 IS NULL THEN
      log := log || 'B8 a second mentor is forbidden; the student themself is not' || E'\t' || 'SKIP: needs a second mentor profile' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor2, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM competency_self_vs_mentor(stu);
        m := 0;
      EXCEPTION WHEN OTHERS THEN
        m := CASE WHEN SQLERRM LIKE 'SELF_ASSESSMENT_FORBIDDEN%' THEN 1 ELSE 0 END;
      END;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
      SELECT count(*) INTO n FROM competency_self_vs_mentor(stu);
      log := log || 'B8 a second mentor is forbidden; the student themself is not' || E'\t'
          || CASE WHEN m = 1 AND n >= 1 THEN 'SELF_ASSESSMENT_FORBIDDEN, ' || n || ' row(s) for the student'
                  ELSE 'FAIL: forbidden-check=' || m || ' student-rows=' || n END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B8 a second mentor is forbidden; the student themself is not' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B9
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO n FROM competency_self_vs_mentor(stu);
    log := log || 'B9 the advisor reads it' || E'\t' || CASE WHEN n >= 1 THEN n || ' row(s)' ELSE 'FAIL: 0 rows' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B9 the advisor reads it' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B10: both tasks are approved by now (B6, B7), each with share_to_feed
  -- left at its column default (true), so the stream has at least one task
  -- card to check.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    SELECT string_agg(x::text, ' ') INTO v_text FROM list_feed_posts(grp) x;
    log := log || 'B10 list_feed_posts carries no rating' || E'\t'
        || CASE WHEN coalesce(v_text, '') NOT ILIKE '%selflevel%' AND coalesce(v_text, '') NOT ILIKE '%mentorlevel%'
                     AND coalesce(v_text, '') NOT ILIKE '%self_level%' AND coalesce(v_text, '') NOT ILIKE '%mentor_level%'
                THEN 'clean' ELSE 'FAIL: a rating leaked into the stream' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B10 list_feed_posts carries no rating' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;

-- ============================================================
-- PART C — the policies, actually evaluated. Submit BEGIN..ROLLBACK in one go.
--   C1 the student reads their own comparison       >=1 row (positive control)
--   C2 the advisor of the group reads it             >=1 row
--   C3 a second student (SKIP without one)           SELF_ASSESSMENT_FORBIDDEN
--   C4 the advisor's direct SELECT of self_level     see the row text -- this
--      does not gate on a fixed expectation because assignment_submissions'
--      SELECT policy is owned by docs/task-assignment-migration.sql, not this
--      feature; the row prints the count either way and names what it means.
-- Needs an advisor, a student, a mentor (linked) and a KPI; C3 needs a second
-- student and SKIPs otherwise.
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; stu2 UUID; mentor UUID; grp UUID; kpi UUID; asg UUID; sub UUID;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu2 FROM profiles WHERE role = 'student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role = 'mentor' ORDER BY created_at LIMIT 1;
  SELECT k.id INTO kpi FROM competency_kpis k WHERE k.level = 1 ORDER BY k.kpi_index LIMIT 1;
  IF adv IS NULL OR stu IS NULL OR mentor IS NULL OR kpi IS NULL THEN
    PERFORM set_config('probe.ready', 'no', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe self-assessment C') RETURNING id INTO grp;
  UPDATE group_memberships SET left_at = now() WHERE student_id IN (stu, stu2) AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe self-assessment C task', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index LIMIT 1
  RETURNING id INTO asg;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  sub := submit_assignment(asg, 'note', 'reflection', '[]'::jsonb, '[]'::jsonb, 2);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
  PERFORM review_assignment(sub, true, 'ok', 2);

  PERFORM set_config('probe.ready', 'yes', true);
  PERFORM set_config('probe.adv', adv::text, true);
  PERFORM set_config('probe.stu', stu::text, true);
  PERFORM set_config('probe.stu2', coalesce(stu2::text, ''), true);
  PERFORM set_config('probe.sub', sub::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE adv UUID; stu UUID; stu2 UUID; sub UUID; n INT; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results', 'C1-C4' || E'\t' || 'SKIP: needs an advisor, a student, a mentor and a KPI' || E'\n', true);
    RETURN;
  END IF;
  adv := current_setting('probe.adv')::uuid;
  stu := current_setting('probe.stu')::uuid;
  stu2 := NULLIF(current_setting('probe.stu2'), '')::uuid;
  sub := current_setting('probe.sub')::uuid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM competency_self_vs_mentor(stu);
    log := log || 'C1 the student reads their own comparison' || E'\t' || CASE WHEN n >= 1 THEN n || ' row(s)' ELSE 'FAIL: 0 rows' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C1 the student reads their own comparison' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n';
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM competency_self_vs_mentor(stu);
    log := log || 'C2 the advisor of the group reads it' || E'\t' || CASE WHEN n >= 1 THEN n || ' row(s)' ELSE 'FAIL: 0 rows' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C2 the advisor of the group reads it' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n';
  END;

  IF stu2 IS NULL THEN
    log := log || 'C3 a second student' || E'\t' || 'SKIP: needs a second student' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu2, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM competency_self_vs_mentor(stu);
      log := log || 'C3 a second student' || E'\t' || 'FAIL: rows returned' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || 'C3 a second student' || E'\t' || CASE WHEN SQLERRM LIKE 'SELF_ASSESSMENT_FORBIDDEN%' THEN 'SELF_ASSESSMENT_FORBIDDEN' ELSE 'FAIL: ' || SQLERRM END || E'\n';
    END;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM (SELECT self_level FROM assignment_submissions WHERE id = sub) x;
    log := log || 'C4 the advisor''s direct SELECT of self_level' || E'\t'
        || CASE WHEN n = 0 THEN '0 rows'
                ELSE n || ' row(s) -- the advisor''s existing policies DO read submissions directly; the controller should judge whether that is acceptable' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C4 the advisor''s direct SELECT of self_level' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

RESET ROLE;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;
