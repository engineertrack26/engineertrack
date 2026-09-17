-- ============================================================
-- Spec amendment: the direct evidence policies on log_photos and
-- log_documents (the student's own INSERT/DELETE on a non-approved
-- submission's photos/documents, from docs/daily-log-retirement-migration.sql
-- ~lines 115-179) do not go through any of the ten guarded write RPCs, so
-- close_internship alone does not stop a student from adding or removing
-- evidence on a submission after the record is closed. This file re-creates
-- the four write policies (log_photos_insert, log_photos_delete,
-- log_documents_insert, log_documents_delete) with their bodies otherwise
-- unchanged, adding a closure check inside the assignment-submission branch
-- of each. The two SELECT policies are untouched -- reading old evidence
-- stays available while closed, same as everything else in the spec.
--
-- internship_closed(...) is NOT called here -- it is REVOKEd from
-- authenticated (internship-closure-migration.sql), and a policy runs as
-- authenticated. Instead the check reads internship_closures directly; the
-- student can already see their own closure row under
-- internship_closures_select (student_id = auth.uid()), so the added
-- NOT EXISTS evaluates cleanly under RLS.
--
-- Apply after docs/internship-closure-migration.sql (and after
-- docs/daily-log-retirement-migration.sql, which must already have run for
-- these policies to exist). Idempotent -- DROP POLICY IF EXISTS before each
-- CREATE POLICY, safe to re-apply.
-- Anonymous dollar-quoting only.
-- ============================================================

DROP POLICY IF EXISTS "log_photos_insert" ON log_photos;
CREATE POLICY "log_photos_insert" ON log_photos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid())
    OR EXISTS (SELECT 1 FROM assignment_submissions s
      WHERE s.id = submission_id
        AND s.student_id = auth.uid()
        AND s.status <> 'approved'
        AND NOT EXISTS (SELECT 1 FROM internship_closures c JOIN group_assignments a ON a.id = s.assignment_id
          WHERE c.student_id = s.student_id AND c.group_id = a.group_id AND c.reopened_at IS NULL))
  );

DROP POLICY IF EXISTS "log_photos_delete" ON log_photos;
CREATE POLICY "log_photos_delete" ON log_photos
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid()
      AND daily_logs.status IN ('draft', 'needs_revision'))
    OR EXISTS (SELECT 1 FROM assignment_submissions s
      WHERE s.id = submission_id
        AND s.student_id = auth.uid()
        AND s.status <> 'approved'
        AND NOT EXISTS (SELECT 1 FROM internship_closures c JOIN group_assignments a ON a.id = s.assignment_id
          WHERE c.student_id = s.student_id AND c.group_id = a.group_id AND c.reopened_at IS NULL))
  );

DROP POLICY IF EXISTS "log_documents_insert" ON log_documents;
CREATE POLICY "log_documents_insert" ON log_documents
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid())
    OR EXISTS (SELECT 1 FROM assignment_submissions s
      WHERE s.id = submission_id
        AND s.student_id = auth.uid()
        AND s.status <> 'approved'
        AND NOT EXISTS (SELECT 1 FROM internship_closures c JOIN group_assignments a ON a.id = s.assignment_id
          WHERE c.student_id = s.student_id AND c.group_id = a.group_id AND c.reopened_at IS NULL))
  );

DROP POLICY IF EXISTS "log_documents_delete" ON log_documents;
CREATE POLICY "log_documents_delete" ON log_documents
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid()
      AND daily_logs.status IN ('draft', 'needs_revision'))
    OR EXISTS (SELECT 1 FROM assignment_submissions s
      WHERE s.id = submission_id
        AND s.student_id = auth.uid()
        AND s.status <> 'approved'
        AND NOT EXISTS (SELECT 1 FROM internship_closures c JOIN group_assignments a ON a.id = s.assignment_id
          WHERE c.student_id = s.student_id AND c.group_id = a.group_id AND c.reopened_at IS NULL))
  );

-- ============================================================
-- VERIFICATION — owner-run fixture, then SET LOCAL ROLE authenticated is the
-- only real RLS test (see docs/internship-closure-verification.sql Part C).
-- Submit as one BEGIN..ROLLBACK block.
--   fixture: an advisor, a student, a mentor-linked group, a published
--   assignment, a needs_revision submission on it, and a closure row
--   inserted directly (not via close_internship -- the fixture only needs
--   the row the policy reads, not a full report build).
--   test: as the student, INSERT INTO log_photos for that submission ->
--   expect a row-level-security policy violation (42501).
-- Expected: one row "PASS: evidence write refused after closure".
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; mentor UUID; grp UUID; triplet UUID; asg UUID; sub UUID;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT p.id INTO stu FROM profiles p JOIN student_profiles sp ON sp.id = p.id
    WHERE p.role = 'student' ORDER BY p.created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role = 'mentor' ORDER BY created_at LIMIT 1;
  SELECT tr.id INTO triplet FROM kpi_triplets tr ORDER BY tr.kpi_id, tr.triplet_index LIMIT 1;
  IF adv IS NULL OR stu IS NULL OR mentor IS NULL OR triplet IS NULL THEN
    PERFORM set_config('probe.ready', 'no', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe evidence closure') RETURNING id INTO grp;
  UPDATE group_memberships SET left_at = now() WHERE student_id = stu AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  UPDATE student_profiles SET mentor_id = mentor WHERE id = stu;
  DELETE FROM internship_closures WHERE student_id = stu AND group_id = grp;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe evidence closure task', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.id = triplet
  RETURNING id INTO asg;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  sub := submit_assignment(asg, 'note', 'reflection', '[]'::jsonb, '[]'::jsonb, 2::smallint);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
  PERFORM review_assignment(sub, false, 'please redo', NULL);

  -- Inserted directly, not via close_internship -- the fixture only needs
  -- the row the policy's NOT EXISTS reads.
  INSERT INTO internship_closures (student_id, group_id, closed_by, report_md)
  VALUES (stu, grp, adv, 'probe report');

  PERFORM set_config('probe.ready', 'yes', true);
  PERFORM set_config('probe.stu', stu::text, true);
  PERFORM set_config('probe.sub', sub::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE stu UUID; sub UUID; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results', 'evidence write' || E'\t' || 'SKIP: needs an advisor, a student, a mentor and a KPI triplet' || E'\n', true);
    RETURN;
  END IF;
  stu := current_setting('probe.stu')::uuid;
  sub := current_setting('probe.sub')::uuid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO log_photos (submission_id, uri) VALUES (sub, 'evidence/probe-after-closure.jpg');
    log := log || 'evidence write' || E'\t' || 'FAIL: insert accepted after closure' || E'\n';
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    log := log || 'evidence write' || E'\t'
        || CASE WHEN SQLSTATE = '42501' OR SQLERRM ILIKE '%row-level security%'
                THEN 'PASS: evidence write refused after closure'
                ELSE 'FAIL: ' || SQLSTATE || ' ' || coalesce(SQLERRM, 'NULL') END || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

RESET ROLE;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;
