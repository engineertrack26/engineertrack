-- docs/competency-verification.sql
-- Run after docs/competency-framework-migration.sql,
-- docs/competency-assessment-migration.sql and docs/competency-rpcs.sql.
-- Two separate submissions.
--
-- Part A asserts the schema. Part B exercises the two rules that carry the
-- whole design — a student cannot promote themselves, and the level ladder
-- cannot be climbed out of order — inside a transaction that rolls back.
--
-- The Supabase SQL editor gives each submission its own connection, so a temp
-- table written in one statement is invisible to the next (42P01). Results
-- therefore accumulate in a text variable handed over through a
-- transaction-local GUC, the pattern docs/internship-groups-verification.sql
-- uses. Anonymous $$ only: a named dollar tag fails with 42601 in this editor.

-- ============================================================
-- PART A — schema assertions
-- Expected: one row, "PASS: schema assertions held".
-- ============================================================

DO $$
DECLARE
  n INT;
BEGIN
  SELECT count(*) INTO n FROM competencies;
  IF n <> 6 THEN RAISE EXCEPTION 'FAIL: % competencies, expected 6', n; END IF;

  SELECT count(*) INTO n FROM competency_kpis;
  IF n <> 48 THEN RAISE EXCEPTION 'FAIL: % KPIs, expected 48', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT c.id FROM competencies c
    JOIN competency_kpis k ON k.competency_id = c.id
    GROUP BY c.id HAVING count(*) <> 8
  ) AS bad;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % competencies do not have 8 KPIs', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT k.level FROM competency_kpis k
    GROUP BY k.level HAVING count(*) <> 12
  ) AS bad;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % levels do not have 12 KPIs', n; END IF;

  -- No write path to the framework, and none to observations either: both are
  -- reference or RPC-only tables, and an INSERT policy on kpi_observations
  -- would let a client set observed_by to someone else and manufacture the two
  -- independent observations a level requires.
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE tablename IN ('competencies','competency_kpis','kpi_observations')
               AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: a write policy exists on a read-only or RPC-only table';
  END IF;

  -- The old model is gone from the schema, not merely unused by the app.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name IN ('self_assessments','mentor_feedbacks')
               AND column_name = 'competency_ratings') THEN
    RAISE EXCEPTION 'FAIL: competency_ratings still exists; run competency-cleanup-migration.sql';
  END IF;

  -- ...and what the log flow depends on survived that cleanup.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'self_assessments'
                   AND column_name = 'reflection_notes') THEN
    RAISE EXCEPTION 'FAIL: self_assessments.reflection_notes is missing';
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS result;


-- ============================================================
-- PART B — the two rules
-- Submit everything from BEGIN to ROLLBACK in one go.
--
-- Expected rows:
--   1 defaults      6 targets at level 2
--   2 mentor twice  current_level = 1
--   3 self twice    current_level = 0
--   4 L2 not L1     current_level = 0
--   5 double tick   rejected by the unique index
--   6 at target     absent from working KPIs
--
-- Needs one advisor and one student profile to exist. With no accounts the
-- script reports SKIP rather than failing, because "no fixtures" is not the
-- same finding as "the rule is broken".
--
-- A subtlety the script respects: in Postgres a unique index treats NULLs as
-- distinct, so UNIQUE (kpi_id, log_id, observed_by) does NOT block two rows
-- differing only by log_id IS NULL. Every case below therefore attaches
-- observations to real daily_logs rows. This is not a schema defect —
-- record_kpi_observations deletes the caller's prior ticks for that log before
-- inserting, and no direct INSERT path exists — but a script using NULL log ids
-- would prove nothing about case 5.
--
-- The fixture dates are in 1900 on purpose. daily_logs carries
-- UNIQUE(student_id, date); using CURRENT_DATE - 1 would collide with a real
-- log the student already wrote, and Part B would die with a unique_violation
-- that reads like a bug in the framework rather than a fixture clash. The dates
-- are semantically irrelevant here — the whole transaction rolls back.
-- ============================================================

BEGIN;

DO $$
DECLARE
  adv  UUID;
  stu  UUID;
  grp  UUID;
  comp UUID;
  k1a  UUID; k1b UUID; k2a UUID; k2b UUID;
  lgA  UUID; lgB UUID;
  lvl  INT;
  n    INT;
  log  TEXT := '';
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;

  IF adv IS NULL OR stu IS NULL THEN
    PERFORM set_config('probe.results',
      '1-6 competency' || E'\t' || 'SKIP: needs one advisor and one student profile' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe competency')
  RETURNING id INTO grp;

  -- 1. The AFTER INSERT trigger should have seeded the whole framework.
  SELECT count(*) INTO n FROM group_competency_targets t
  WHERE t.group_id = grp AND t.target_level = 2;
  log := log || '1 defaults' || E'\t'
      || CASE WHEN n = 6 THEN '6 targets at level 2'
              ELSE 'FAIL: ' || n || ' targets at level 2' END || E'\n';

  DELETE FROM group_memberships m WHERE m.student_id = stu;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);

  SELECT c.id INTO comp FROM competencies c ORDER BY c.display_order LIMIT 1;
  SELECT k.id INTO k1a FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 1 AND k.kpi_index = 1;
  SELECT k.id INTO k1b FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 1 AND k.kpi_index = 2;
  SELECT k.id INTO k2a FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 2 AND k.kpi_index = 1;
  SELECT k.id INTO k2b FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 2 AND k.kpi_index = 2;

  -- Two real logs. The threshold is two observations of a KPI, and with a real
  -- log id the unique index makes "two" mean two separate days rather than one
  -- row saved twice.
  INSERT INTO daily_logs (student_id, date, title, content)
  VALUES (stu, DATE '1900-01-01', 'Probe A', 'Probe A') RETURNING id INTO lgA;
  INSERT INTO daily_logs (student_id, date, title, content)
  VALUES (stu, DATE '1900-01-02', 'Probe B', 'Probe B') RETURNING id INTO lgB;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);

  -- 2. Both L1 KPIs seen by the advisor on two different days.
  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by) VALUES
    (stu, k1a, lgA, adv), (stu, k1b, lgA, adv),
    (stu, k1a, lgB, adv), (stu, k1b, lgB, adv);

  SELECT p.current_level INTO lvl
  FROM get_competency_progress(stu) AS p WHERE p.competency_id = comp;
  log := log || '2 mentor twice' || E'\t'
      || CASE WHEN lvl = 1 THEN 'current_level = 1'
              ELSE 'FAIL: current_level = ' || coalesce(lvl, -1) END || E'\n';

  -- 3. The same pattern, but the student ticking their own boxes. This is the
  --    check that stops a student promoting themselves.
  DELETE FROM kpi_observations o WHERE o.student_id = stu;
  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by) VALUES
    (stu, k1a, lgA, stu), (stu, k1b, lgA, stu),
    (stu, k1a, lgB, stu), (stu, k1b, lgB, stu);

  SELECT p.current_level INTO lvl
  FROM get_competency_progress(stu) AS p WHERE p.competency_id = comp;
  log := log || '3 self twice' || E'\t'
      || CASE WHEN lvl = 0 THEN 'current_level = 0'
              ELSE 'FAIL: self ticks promoted to ' || lvl END || E'\n';

  -- 4. L2 fully demonstrated, L1 untouched. The ladder must not be climbable
  --    out of order.
  DELETE FROM kpi_observations o WHERE o.student_id = stu;
  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by) VALUES
    (stu, k2a, lgA, adv), (stu, k2b, lgA, adv),
    (stu, k2a, lgB, adv), (stu, k2b, lgB, adv);

  SELECT p.current_level INTO lvl
  FROM get_competency_progress(stu) AS p WHERE p.competency_id = comp;
  log := log || '4 L2 not L1' || E'\t'
      || CASE WHEN lvl = 0 THEN 'current_level = 0'
              ELSE 'FAIL: skipped to level ' || lvl END || E'\n';

  -- 5. The same observer cannot tick the same KPI twice on one log.
  BEGIN
    INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by)
    VALUES (stu, k2a, lgA, adv);
    log := log || '5 double tick' || E'\t' || 'FAIL: duplicate accepted' || E'\n';
  EXCEPTION WHEN unique_violation THEN
    log := log || '5 double tick' || E'\t' || 'rejected by the unique index' || E'\n';
  WHEN OTHERS THEN
    log := log || '5 double tick' || E'\t' || 'FAIL (wrong error): ' || SQLERRM || E'\n';
  END;

  -- 6. A competency already at its target drops out of the working list.
  UPDATE group_competency_targets t SET target_level = 1
  WHERE t.group_id = grp AND t.competency_id = comp;
  DELETE FROM kpi_observations o WHERE o.student_id = stu;
  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by) VALUES
    (stu, k1a, lgA, adv), (stu, k1b, lgA, adv),
    (stu, k1a, lgB, adv), (stu, k1b, lgB, adv);

  SELECT count(*) INTO n FROM get_working_kpis(stu) AS w WHERE w.competency_id = comp;
  log := log || '6 at target' || E'\t'
      || CASE WHEN n = 0 THEN 'absent from working KPIs'
              ELSE 'FAIL: still returns ' || n || ' KPIs' END || E'\n';

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;
