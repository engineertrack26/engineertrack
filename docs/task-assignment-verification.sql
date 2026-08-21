-- docs/task-assignment-verification.sql
-- Run after docs/task-triplets-migration.sql, docs/task-assignment-migration.sql
-- and docs/task-assignment-rpcs.sql. Two separate submissions.
--
-- Part A asserts the schema. Part B exercises the rules that carry the design
-- — an approval writes exactly one observation, a withdrawal takes it back, a
-- level needs both its KPIs demonstrated twice, a log re-save must not sweep
-- away a task observation, and a competency outside the group's scope is
-- refused at review time — inside a transaction that rolls back.
--
-- The Supabase SQL editor gives each submission its own connection, so a temp
-- table written in one statement is invisible to the next (42P01). Results
-- therefore accumulate in a text variable handed over through a
-- transaction-local GUC, the pattern docs/competency-verification.sql uses.
-- Anonymous $$ only: a named dollar tag fails with 42601 in this editor.
--
-- Every RLS assertion in Part A is STRUCTURAL, not behavioural: the SQL
-- editor runs as the table owner, and an owner bypasses RLS entirely. These
-- checks prove a policy exists (or that no write policy exists); they never
-- prove a policy can be evaluated without recursing. On 2026-08-20 two green
-- verification runs hid a 42P17 recursion for exactly this reason. C2's
-- device checklist is what actually exercises the policies.

-- ============================================================
-- PART A — schema assertions
-- Expected: one row, "PASS: schema assertions held".
-- ============================================================

DO $$
DECLARE
  n INT;
BEGIN
  SELECT count(*) INTO n FROM kpi_triplets;
  IF n <> 480 THEN RAISE EXCEPTION 'FAIL: % triplets, expected 480', n; END IF;

  SELECT count(DISTINCT t.kpi_id) INTO n FROM kpi_triplets t;
  IF n <> 48 THEN RAISE EXCEPTION 'FAIL: % KPIs carry triplets, expected 48', n; END IF;

  -- Every KPI currently holds exactly 10 triplets, but the assertion checks
  -- an 8-12 band rather than the literal 10: the band is what catches a
  -- future regression in the extraction pipeline without being so tight that
  -- an intentional, small per-KPI variation would fail this script.
  SELECT count(*) INTO n FROM (
    SELECT t.kpi_id FROM kpi_triplets t
    GROUP BY t.kpi_id HAVING count(*) < 8 OR count(*) > 12
  ) AS bad;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % KPIs outside the 8-12 band', n; END IF;

  -- STRUCTURAL: proves no write policy exists. Does not prove the SELECT
  -- policy evaluates without recursing (RLS is bypassed here as owner).
  -- kpi_triplets is reference data and assignment_submissions is RPC-only.
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE tablename IN ('kpi_triplets','assignment_submissions')
               AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: a write policy exists on a read-only or RPC-only table';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE indexname = 'one_observation_per_submission') THEN
    RAISE EXCEPTION 'FAIL: one_observation_per_submission is missing; re-approval would double-count';
  END IF;

  -- STRUCTURAL: the same shape-of-policy check the recursion fix ends with.
  -- These two tables consult group ownership, membership and the mentor link
  -- at once, which is the shape that produced 42P17. This proves no policy
  -- body reads a group table directly (which would re-enter that table's own
  -- policies); it does not execute any policy, so it cannot itself detect a
  -- recursion — only the absence of the pattern that is known to cause one.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename IN ('group_assignments','assignment_submissions')
      AND (coalesce(qual, '')       ~ '\minternship_groups\M'
        OR coalesce(qual, '')       ~ '\mgroup_memberships\M'
        OR coalesce(with_check, '') ~ '\minternship_groups\M'
        OR coalesce(with_check, '') ~ '\mgroup_memberships\M')
  ) THEN
    RAISE EXCEPTION 'FAIL: a policy reads a group table directly';
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS result;


-- ============================================================
-- PART B — the rules. Submit BEGIN..ROLLBACK in one go.
--
--   1 approval        1 observation
--   2 re-approval     still 1 observation
--   3 withdrawal      0 observations
--   4 full level      current_level = 1
--   5 log re-save     task observation survived
--   6 out of scope    rejected NOT_IN_SCOPE
--
-- Needs an advisor and a student whose student_profiles.mentor_id is set.
-- With neither present the script reports SKIP rather than failing, because
-- "no fixtures" is not the same finding as "the rule is broken".
--
-- The fixture dates are in 1900 on purpose. daily_logs carries
-- UNIQUE(student_id, date); a collision with a real log the student already
-- wrote would surface as a unique_violation that reads like a bug in the
-- framework rather than a fixture clash. The dates are semantically
-- irrelevant here — the whole transaction rolls back.
--
-- The RPCs take the actor from auth.uid(), so identity is switched with
-- set_config('request.jwt.claims', ...): submitting as the student,
-- reviewing as the mentor.
-- ============================================================

BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; men UUID; grp UUID; comp UUID;
  kpi1 UUID; kpi2 UUID; lg UUID;
  asg UUID; sub UUID; n INT; lvl INT; log TEXT := '';
  t RECORD;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT sp.id, sp.mentor_id INTO stu, men
  FROM student_profiles sp
  WHERE sp.mentor_id IS NOT NULL
  LIMIT 1;

  IF adv IS NULL OR stu IS NULL OR men IS NULL THEN
    PERFORM set_config('probe.results',
      '1-6 assignment' || E'\t' || 'SKIP: needs an advisor and a student with a mentor' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name)
  VALUES (adv, 'Probe assignment') RETURNING id INTO grp;

  DELETE FROM group_memberships m WHERE m.student_id = stu;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);

  SELECT c.id INTO comp FROM competencies c ORDER BY c.display_order LIMIT 1;
  SELECT k.id INTO kpi1 FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 1 AND k.kpi_index = 1;
  SELECT k.id INTO kpi2 FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 1 AND k.kpi_index = 2;

  -- 1-3 run on a single assignment built from the first triplet of kpi1.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe 1', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi1 ORDER BY tr.triplet_index LIMIT 1
  RETURNING id INTO asg;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  SELECT submit_assignment(asg, 'probe', NULL) INTO sub;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', men)::text, true);
  PERFORM review_assignment(sub, true, 'ok');

  SELECT count(*) INTO n FROM kpi_observations o WHERE o.assignment_submission_id = sub;
  log := log || '1 approval' || E'\t'
      || CASE WHEN n = 1 THEN '1 observation' ELSE 'FAIL: ' || n END || E'\n';

  PERFORM review_assignment(sub, true, 'ok again');
  SELECT count(*) INTO n FROM kpi_observations o WHERE o.assignment_submission_id = sub;
  log := log || '2 re-approval' || E'\t'
      || CASE WHEN n = 1 THEN 'still 1 observation' ELSE 'FAIL: ' || n END || E'\n';

  PERFORM review_assignment(sub, false, 'redo');
  SELECT count(*) INTO n FROM kpi_observations o WHERE o.assignment_submission_id = sub;
  log := log || '3 withdrawal' || E'\t'
      || CASE WHEN n = 0 THEN '0 observations' ELSE 'FAIL: ' || n END || E'\n';

  -- 4. A level needs BOTH its KPIs demonstrated twice, so reaching level 1
  --    through tasks alone takes four approved assignments: two triplets from
  --    each of the level's two KPIs.
  DELETE FROM kpi_observations o WHERE o.student_id = stu;
  -- Exactly two triplets from EACH of the level's two KPIs. Iterating both
  -- KPIs together and stopping at four observations would let one KPI supply
  -- all four — kpi_id is a UUID, so their relative order is arbitrary — and
  -- the level would correctly stay at 0 while the case reported a failure
  -- that is the test's fault rather than the code's.
  FOR t IN
    (SELECT tr.id, tr.objective, tr.criterion
     FROM kpi_triplets tr
     WHERE tr.kpi_id = kpi1
       AND tr.id NOT IN (SELECT a.triplet_id FROM group_assignments a WHERE a.group_id = grp)
     ORDER BY tr.triplet_index LIMIT 2)
    UNION ALL
    (SELECT tr.id, tr.objective, tr.criterion
     FROM kpi_triplets tr
     WHERE tr.kpi_id = kpi2
       AND tr.id NOT IN (SELECT a.triplet_id FROM group_assignments a WHERE a.group_id = grp)
     ORDER BY tr.triplet_index LIMIT 2)
  LOOP
    INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
    VALUES (grp, t.id, 'Probe level', t.objective, t.criterion, adv) RETURNING id INTO asg;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
    SELECT submit_assignment(asg, 'probe', NULL) INTO sub;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', men)::text, true);
    PERFORM review_assignment(sub, true, 'ok');
  END LOOP;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  SELECT p.current_level INTO lvl
  FROM get_competency_progress(stu) AS p WHERE p.competency_id = comp;
  log := log || '4 full level' || E'\t'
      || CASE WHEN lvl = 1 THEN 'current_level = 1'
              ELSE 'FAIL: current_level = ' || coalesce(lvl, -1) END || E'\n';

  -- 5. Saving a daily log must not sweep away task observations. This is the
  --    only thing asserting the `assignment_submission_id IS NULL` clause in
  --    record_kpi_observations; without it that clause could be deleted and
  --    nothing would fail.
  INSERT INTO daily_logs (student_id, date, title, content)
  VALUES (stu, DATE '1900-01-01', 'Probe log', 'Probe log') RETURNING id INTO lg;
  PERFORM record_kpi_observations(stu, lg, ARRAY[kpi1]);
  SELECT count(*) INTO n FROM kpi_observations o
  WHERE o.student_id = stu AND o.assignment_submission_id IS NOT NULL;
  log := log || '5 log re-save' || E'\t'
      || CASE WHEN n >= 4 THEN 'task observation survived'
              ELSE 'FAIL: only ' || n || ' task observations left' END || E'\n';

  -- 6. A competency outside the group's scope must be refused at review time,
  --    or the student is approved and nothing moves.
  DELETE FROM group_competency_targets gt
  WHERE gt.group_id = grp AND gt.competency_id = comp;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe scope', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi1 ORDER BY tr.triplet_index DESC LIMIT 1
  RETURNING id INTO asg;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  SELECT submit_assignment(asg, 'probe', NULL) INTO sub;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', men)::text, true);
  BEGIN
    PERFORM review_assignment(sub, true, 'ok');
    log := log || '6 out of scope' || E'\t' || 'FAIL: approval accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '6 out of scope' || E'\t'
        || CASE WHEN SQLERRM = 'NOT_IN_SCOPE' THEN 'rejected NOT_IN_SCOPE'
                ELSE 'FAIL (wrong error): ' || SQLERRM END || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;
