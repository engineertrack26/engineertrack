-- docs/review-by-advisor-verification.sql
-- Run in the Supabase SQL editor, one part per submission. Anonymous
-- dollar-quoting only.
-- Apply order: docs/internship-closure-guards.sql (already live), then
-- docs/review-by-advisor.sql, then this file.
-- PART A is STRUCTURAL (owner session bypasses RLS) -- it proves existence
-- and grants, not evaluability. Part B (owner-run, impersonated via
-- request.jwt.claims) is RPC behaviour. Part C (SET LOCAL ROLE authenticated)
-- is the only real RLS test -- see docs/superpowers/specs/
-- 2026-09-24-advisor-review-design.md.
-- ============================================================

-- ============================================================
-- PART A -- schema/definition assertions. One query; the editor shows only
-- the last statement's result, so every row must read true.
-- ============================================================
SELECT * FROM (
  VALUES
    ('A1 both functions exist',
     to_regprocedure('public.review_assignment(uuid,boolean,text,smallint)') IS NOT NULL
       AND to_regprocedure('public.submit_assignment(uuid,text,text,jsonb,jsonb,smallint)') IS NOT NULL),
    ('A2 review_assignment gates on the advisor, not the mentor',
     pg_get_functiondef(to_regprocedure('public.review_assignment(uuid,boolean,text,smallint)')) LIKE '%is_group_advisor_of(the_student)%'
       AND pg_get_functiondef(to_regprocedure('public.review_assignment(uuid,boolean,text,smallint)')) NOT LIKE '%NOT is_mentor_of(the_student)%'),
    ('A3 submit_assignment notifies the advisor',
     pg_get_functiondef(to_regprocedure('public.submit_assignment(uuid,text,text,jsonb,jsonb,smallint)')) LIKE '%g.advisor_id INTO the_reviewer%'),
    ('A4 both are SECURITY DEFINER with a fixed search_path',
     (SELECT bool_and(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%'))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('submit_assignment', 'review_assignment'))),
    ('A5 callable by authenticated, not by anon',
     has_function_privilege('authenticated', 'review_assignment(uuid,boolean,text,smallint)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'review_assignment(uuid,boolean,text,smallint)', 'EXECUTE'))
) AS t(check_name, ok)
ORDER BY check_name;


-- ============================================================
-- PART B -- RPC behaviour, live against the simulation group (join code
-- 58MMWL). Owner-run and impersonated via request.jwt.claims; rolls back
-- unconditionally, so nothing here touches the live data.
--
-- All actors and rows are found (or, where the live data cannot be trusted to
-- hold what the check needs, created) dynamically inside the transaction --
-- no uuid is hard-coded anywhere in this part.
--
-- B1/B2/B3/B5 need a 'submitted' assignment_submissions row before
-- review_assignment can be called on it. Rather than hoping the live
-- simulation data happens to have one sitting in the right state (and in
-- scope for the group's competency targets), this probe inserts its own rows
-- directly as the table owner: assignment_submissions has no write policy at
-- all, so RLS never sees these inserts, exactly as it never sees
-- submit_assignment's. A dedicated PROBE assignment also sidesteps two
-- otherwise-open questions about any assignment already live in 58MMWL --
-- whether either student already has a submission on it, and whether its
-- competency is inside the group's target scope.
--
-- B4 is different on purpose: it calls submit_assignment itself, because B4
-- is testing THAT function's own notification-recipient change, and a raw
-- insert would prove nothing about it.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_group           UUID;
  v_advisor         UUID;
  v_student1        UUID;
  v_mentor1         UUID;
  v_student2        UUID;
  v_mentor2         UUID;
  v_triplet         UUID;
  v_comp            UUID;
  v_assignment      UUID;
  v_open_assignment UUID;
  v_sub1            UUID;
  v_sub2            UUID;
  v_sub3            UUID;
  v_status          TEXT;
  v_level           INT;
  v_observed_by     UUID;
  v_notif_advisor   INT;
  v_notif_mentor    INT;
  v_log             TEXT := '';
BEGIN
  -- The simulation group and its advisor.
  SELECT id, advisor_id INTO v_group, v_advisor
  FROM internship_groups WHERE join_code = '58MMWL';

  IF v_group IS NULL THEN
    v_log := v_log || 'FAIL setup: group 58MMWL not found' || chr(10);
  ELSE
    -- Two distinct active members of the group, each with a linked mentor --
    -- student2/mentor2 is who runs B2's ROLE_NOT_ALLOWED check.
    SELECT m.student_id, sp.mentor_id INTO v_student1, v_mentor1
    FROM group_memberships m JOIN student_profiles sp ON sp.id = m.student_id
    WHERE m.group_id = v_group AND m.left_at IS NULL AND sp.mentor_id IS NOT NULL
    ORDER BY m.student_id LIMIT 1;

    SELECT m.student_id, sp.mentor_id INTO v_student2, v_mentor2
    FROM group_memberships m JOIN student_profiles sp ON sp.id = m.student_id
    WHERE m.group_id = v_group AND m.left_at IS NULL AND sp.mentor_id IS NOT NULL
      AND m.student_id <> v_student1
    ORDER BY m.student_id LIMIT 1;

    IF v_student1 IS NULL OR v_student2 IS NULL THEN
      v_log := v_log || 'FAIL setup: fewer than two mentored active students in 58MMWL' || chr(10);
    ELSE
      -- Any triplet gives us a competency to target and copy text from.
      SELECT t.id, k.competency_id INTO v_triplet, v_comp
      FROM kpi_triplets t JOIN competency_kpis k ON k.id = t.kpi_id
      LIMIT 1;

      INSERT INTO group_competency_targets (group_id, competency_id, target_level)
      VALUES (v_group, v_comp, 4)
      ON CONFLICT (group_id, competency_id) DO NOTHING;

      -- A fresh, published assignment for B1/B2/B3, built for this probe only.
      INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
      SELECT v_group, v_triplet, 'PROBE task-1-verification (review)', t.objective, t.criterion, v_advisor, now()
      FROM kpi_triplets t WHERE t.id = v_triplet
      RETURNING id INTO v_assignment;

      -- B1/B3 row: student1, submitted.
      INSERT INTO assignment_submissions
        (assignment_id, student_id, status, reflection, self_level, submitted_at)
      VALUES (v_assignment, v_student1, 'submitted',
              'Probe reflection for task-1 verification, comfortably over twenty characters.', 2, now())
      RETURNING id INTO v_sub1;

      -- B2's fresh row: student2 on the same assignment (the unique
      -- constraint is per (assignment_id, student_id), so this is a distinct
      -- row from v_sub1, never touched by any prior call).
      INSERT INTO assignment_submissions
        (assignment_id, student_id, status, reflection, self_level, submitted_at)
      VALUES (v_assignment, v_student2, 'submitted',
              'A second probe reflection, also comfortably over twenty characters.', 1, now())
      RETURNING id INTO v_sub2;

      -- B1: the group's advisor approves student1's row.
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_advisor)::text, true);
      PERFORM review_assignment(v_sub1, true, 'Tebrikler', 2);

      SELECT status, mentor_level INTO v_status, v_level
      FROM assignment_submissions WHERE id = v_sub1;
      IF v_status = 'approved' AND v_level = 2 THEN
        v_log := v_log || 'PASS B1a: advisor approval sets status=approved, mentor_level=2' || chr(10);
      ELSE
        v_log := v_log || 'FAIL B1a: status=' || coalesce(v_status, '<null>')
                        || ' mentor_level=' || coalesce(v_level::text, '<null>') || chr(10);
      END IF;

      SELECT observed_by INTO v_observed_by
      FROM kpi_observations WHERE assignment_submission_id = v_sub1;
      IF v_observed_by = v_advisor THEN
        v_log := v_log || 'PASS B1b: kpi_observations.observed_by is the advisor' || chr(10);
      ELSE
        v_log := v_log || 'FAIL B1b: observed_by=' || coalesce(v_observed_by::text, '<null>') || chr(10);
      END IF;

      -- B2: the student's own mentor tries the same call on the fresh row.
      -- This is the rule that changed -- assert the code, not just a refusal.
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mentor2)::text, true);
      BEGIN
        PERFORM review_assignment(v_sub2, true, 'nope', 2);
        v_log := v_log || 'FAIL B2: the mentor call succeeded, expected ROLE_NOT_ALLOWED' || chr(10);
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM = 'ROLE_NOT_ALLOWED' THEN
          v_log := v_log || 'PASS B2: the mentor was refused with ROLE_NOT_ALLOWED' || chr(10);
        ELSE
          v_log := v_log || 'FAIL B2: refused with ' || SQLERRM || ', expected ROLE_NOT_ALLOWED' || chr(10);
        END IF;
      END;

      -- B3: the advisor approves the already-approved row a second time.
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_advisor)::text, true);
      BEGIN
        PERFORM review_assignment(v_sub1, true, 'again', 2);
        v_log := v_log || 'FAIL B3: the second approval succeeded, expected ALREADY_APPROVED' || chr(10);
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM = 'ALREADY_APPROVED' THEN
          v_log := v_log || 'PASS B3: the second approval was refused with ALREADY_APPROVED' || chr(10);
        ELSE
          v_log := v_log || 'FAIL B3: refused with ' || SQLERRM || ', expected ALREADY_APPROVED' || chr(10);
        END IF;
      END;

      -- B4: submit_assignment itself, on a second fresh, published,
      -- unsubmitted assignment (so this does not depend on any assignment the
      -- live data happens to already have unsubmitted for student1).
      INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
      SELECT v_group, v_triplet, 'PROBE task-1-verification (submit)', t.objective, t.criterion, v_advisor, now()
      FROM kpi_triplets t WHERE t.id = v_triplet
      RETURNING id INTO v_open_assignment;

      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1)::text, true);
      PERFORM submit_assignment(
        v_open_assignment, 'note',
        'Probe reflection for the submit-notifies-the-advisor check, over twenty characters.',
        '[]'::jsonb,
        '[{"uri":"probe","file_name":"evidence.pdf","file_type":"application/pdf"}]'::jsonb,
        2
      );

      SELECT count(*) INTO v_notif_advisor FROM notifications
      WHERE user_id = v_advisor AND type = 'task_submitted'
        AND data->>'assignmentId' = v_open_assignment::text;
      SELECT count(*) INTO v_notif_mentor FROM notifications
      WHERE user_id = v_mentor1 AND type = 'task_submitted'
        AND data->>'assignmentId' = v_open_assignment::text;

      IF v_notif_advisor = 1 AND v_notif_mentor = 0 THEN
        v_log := v_log || 'PASS B4: task_submitted notification went to the advisor, none to the mentor' || chr(10);
      ELSE
        v_log := v_log || 'FAIL B4: advisor notifications=' || v_notif_advisor
                        || ' mentor notifications=' || v_notif_mentor || chr(10);
      END IF;

      -- B5: a closed student is refused before the role check even runs.
      -- student2 is closed for this check only -- their B2 row is untouched
      -- (still 'submitted', since B2 was refused) and unrelated to it.
      INSERT INTO assignment_submissions
        (assignment_id, student_id, status, reflection, self_level, submitted_at)
      VALUES (v_open_assignment, v_student2, 'submitted',
              'A third probe reflection, also comfortably over twenty characters.', 1, now())
      RETURNING id INTO v_sub3;

      INSERT INTO internship_closures (student_id, group_id, closed_by, report_md)
      VALUES (v_student2, v_group, v_advisor, 'PROBE closure for task-1-verification')
      ON CONFLICT (student_id, group_id) DO UPDATE SET reopened_at = NULL, reopened_by = NULL;

      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_advisor)::text, true);
      BEGIN
        PERFORM review_assignment(v_sub3, true, 'closed', 2);
        v_log := v_log || 'FAIL B5: review succeeded on a closed internship, expected INTERNSHIP_CLOSED' || chr(10);
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM = 'INTERNSHIP_CLOSED' THEN
          v_log := v_log || 'PASS B5: the closed internship was refused with INTERNSHIP_CLOSED' || chr(10);
        ELSE
          v_log := v_log || 'FAIL B5: refused with ' || SQLERRM || ', expected INTERNSHIP_CLOSED' || chr(10);
        END IF;
      END;
    END IF;
  END IF;

  PERFORM set_config('probe.results', v_log, true);
END $$;

SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';

ROLLBACK;


-- ============================================================
-- PART C -- the only real RLS test (owner-run scripts bypass RLS and prove
-- nothing about it). Runs under SET LOCAL ROLE authenticated, in its own
-- rolled-back transaction: assignment_submissions still has no write policy
-- (design unchanged by this task), so the mentor keeps read access and gets
-- nothing from a direct write.
-- ============================================================

BEGIN;

-- Actor and row discovery happens here, as the table owner, before the role
-- switch below takes that access away. If the live data holds no submission
-- at all for a mentored student, one is built for this probe only.
DO $$
DECLARE
  v_mentor     UUID;
  v_student    UUID;
  v_submission UUID;
BEGIN
  SELECT sp.mentor_id, sp.id, s.id INTO v_mentor, v_student, v_submission
  FROM assignment_submissions s
  JOIN student_profiles sp ON sp.id = s.student_id
  WHERE sp.mentor_id IS NOT NULL
  ORDER BY s.submitted_at DESC
  LIMIT 1;

  IF v_mentor IS NULL THEN
    SELECT m.student_id, sp.mentor_id INTO v_student, v_mentor
    FROM group_memberships m JOIN student_profiles sp ON sp.id = m.student_id
    WHERE m.left_at IS NULL AND sp.mentor_id IS NOT NULL
    LIMIT 1;

    INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection, self_level, submitted_at)
    SELECT a.id, v_student, 'submitted',
           'Probe reflection for Part C, comfortably over twenty characters.', 1, now()
    FROM group_assignments a
    JOIN group_memberships m ON m.group_id = a.group_id
    WHERE m.student_id = v_student AND m.left_at IS NULL
    LIMIT 1
    RETURNING id INTO v_submission;
  END IF;

  PERFORM set_config('probe.mentor', v_mentor::text, true);
  PERFORM set_config('probe.submission', v_submission::text, true);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.mentor'))::text, true);

DO $$
DECLARE
  v_submission UUID := current_setting('probe.submission')::uuid;
  v_found      BOOLEAN;
  v_updated    INT;
  v_log        TEXT := '';
BEGIN
  SELECT EXISTS (SELECT 1 FROM assignment_submissions WHERE id = v_submission) INTO v_found;
  IF v_found THEN
    v_log := v_log || 'PASS C1: the mentor can still SELECT the student submission' || chr(10);
  ELSE
    v_log := v_log || 'FAIL C1: the mentor SELECT returned no row' || chr(10);
  END IF;

  UPDATE assignment_submissions SET status = 'approved' WHERE id = v_submission;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    v_log := v_log || 'PASS C2: the mentor UPDATE affected 0 rows (no write policy)' || chr(10);
  ELSE
    v_log := v_log || 'FAIL C2: the mentor UPDATE affected ' || v_updated || ' row(s)' || chr(10);
  END IF;

  PERFORM set_config('probe.results', v_log, true);
END $$;

-- Back to the owner before anything else reads the results, so a failure in
-- the SELECT below cannot be blamed on the role change (house pattern, see
-- docs/task-assignment-verification.sql Part C).
RESET ROLE;

SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';

ROLLBACK;
