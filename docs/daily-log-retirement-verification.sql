-- ============================================================
-- Subsystem D1 verification
--
-- Run in the Supabase SQL editor. Anonymous $$ only: a named dollar tag
-- fails with 42601 in that editor.
--
-- PART A is STRUCTURAL. The editor connects as the table owner and an owner
-- bypasses RLS, so these assertions prove a column, a constraint or a policy
-- EXISTS. They never prove a policy can be EVALUATED. On 2026-08-20 that
-- blind spot let a 42P17 recursion through two green verification runs.
-- Part C is where the policies are actually evaluated.
-- ============================================================

-- ============================================================
-- PART A — schema assertions
-- Expected: one row, "PASS: schema assertions held".
-- ============================================================

DO $$
DECLARE
  n INT;
BEGIN
  -- The dual-owner columns.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'log_photos' AND column_name = 'submission_id') THEN
    RAISE EXCEPTION 'FAIL: log_photos.submission_id is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'log_documents' AND column_name = 'submission_id') THEN
    RAISE EXCEPTION 'FAIL: log_documents.submission_id is missing';
  END IF;

  -- log_id must have become nullable, or a task-owned row cannot exist at all.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name IN ('log_photos','log_documents')
               AND column_name = 'log_id' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'FAIL: log_id is still NOT NULL; no row can be owned by a submission';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'assignment_submissions' AND column_name = 'reflection') THEN
    RAISE EXCEPTION 'FAIL: assignment_submissions.reflection is missing';
  END IF;

  -- Both one-owner constraints.
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conname IN ('log_photos_one_owner','log_documents_one_owner');
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: % of 2 one-owner constraints present', n;
  END IF;

  -- Both constraints must actually say "= 1", not merely exist. A
  -- log_documents_one_owner mistyped as <= 1 or >= 1 would pass the count
  -- above and Part B's log_photos-only cases below while permitting exactly
  -- the orphan and double-owner rows the constraint exists to prevent.
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conname IN ('log_photos_one_owner','log_documents_one_owner')
    AND pg_get_constraintdef(oid) LIKE '%= 1%';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: % of 2 one-owner constraints actually say "= 1"; a <= 1 would permit an orphan row', n;
  END IF;

  SELECT count(*) INTO n FROM pg_indexes
  WHERE indexname IN ('idx_log_photos_submission','idx_log_documents_submission');
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: % of 2 submission indexes present', n;
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS part_a;


-- ============================================================
-- PART B — behaviour, as owner. Submit BEGIN..ROLLBACK in one go.
--
--   B1 both owners set          refused (23514)
--   B2 neither owner set        refused (23514)
--   B3 blank reflection         refused (REFLECTION_REQUIRED)
--   B4 resubmit rewrites evidence   1 photo after removing one
--   B5 same-week streak         unchanged
--   B6 submit XP once           1 transaction after two submits
--   B7 photo bonus sees evidence    6 XP for the two photos at first submit
-- ============================================================

BEGIN;

DO $$
DECLARE
  log TEXT := '';
  a_log UUID; adv UUID; the_student UUID; grp UUID; kpi UUID;
  a_assign UUID; a_assign2 UUID;
  n INT; n2 INT;
BEGIN
  SELECT id INTO a_log FROM daily_logs ORDER BY created_at LIMIT 1;

  SELECT id INTO adv         FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO the_student FROM profiles WHERE role = 'student'  ORDER BY created_at LIMIT 1;

  IF adv IS NULL OR the_student IS NULL THEN
    PERFORM set_config('probe.results',
      'B1-B7 behaviour' || E'\t' || 'SKIP: needs one advisor and one student profile' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name)
  VALUES (adv, 'Probe D1') RETURNING id INTO grp;

  -- tr_seed_group_competency_targets seeds every competency as a target on
  -- that INSERT, so any triplet is in scope and trg_assignment_within_scope
  -- lets both assignments through.
  SELECT k.id INTO kpi
  FROM competency_kpis k
  JOIN competencies c ON c.id = k.competency_id
  WHERE k.level = 1 AND k.kpi_index = 1
  ORDER BY c.display_order LIMIT 1;

  -- Two assignments, not one. B5 needs a SECOND submission in the same week;
  -- a second call against a_assign would be a resubmission and would take the
  -- guarded path instead of the streak branch under test.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe one', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 0 LIMIT 1
  RETURNING id INTO a_assign;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe two', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 1 LIMIT 1
  RETURNING id INTO a_assign2;

  -- submit_assignment refuses a non-member with ROLE_NOT_ALLOWED, so the
  -- membership is load-bearing, not scenery. The table is group_memberships;
  -- there is no internship_group_members despite what one fix brief called it.
  INSERT INTO group_memberships (group_id, student_id)
  VALUES (grp, the_student);

  -- submit_assignment reads auth.uid(). Without this every call below would
  -- raise NOT_AUTHENTICATED and B3 would "pass" for the wrong reason.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', the_student)::text, true);

  -- B1. Both owners set. num_nonnulls = 2, so the CHECK must refuse. Guarded:
  -- on an empty or freshly-migrated database a_log is NULL, which would make
  -- this insert log_id = NULL, submission_id = <random>, i.e. num_nonnulls = 1
  -- -- a value the CHECK is designed to ACCEPT, not the both-set case this
  -- step claims to test. The FK on the random submission_id would then fire
  -- and print the same INCONCLUSIVE line a real test would, so the case would
  -- silently verify nothing while looking like it ran. SKIP instead.
  IF a_log IS NULL THEN
    log := log || 'B1 both owners set' || E'\t'
        || 'SKIP: no daily_logs row to borrow a log_id from' || E'\n';
  ELSE
    BEGIN
      INSERT INTO log_photos (log_id, submission_id, uri)
      VALUES (a_log, gen_random_uuid(), 'probe://both');
      log := log || 'B1 both owners set' || E'\t'
          || 'FAIL: accepted -- a row can belong to a log and a submission at once' || E'\n';
    EXCEPTION WHEN check_violation THEN
      log := log || 'B1 both owners set' || E'\t' || 'refused (23514)' || E'\n';
    WHEN foreign_key_violation THEN
      -- The random submission id has no row. That refusal is the FK, not the
      -- CHECK, so it proves nothing about the constraint under test.
      log := log || 'B1 both owners set' || E'\t'
          || 'INCONCLUSIVE: refused by the FK before the CHECK was reached' || E'\n';
    WHEN OTHERS THEN
      log := log || 'B1 both owners set' || E'\t'
          || 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM || E'\n';
    END;
  END IF;

  -- B2. Neither owner set. num_nonnulls = 0. An orphan row belongs to nobody
  --     and no policy can reach it, so it would be invisible and undeletable.
  BEGIN
    INSERT INTO log_photos (log_id, submission_id, uri)
    VALUES (NULL, NULL, 'probe://neither');
    log := log || 'B2 neither owner set' || E'\t'
        || 'FAIL: accepted -- an orphan row no policy can reach' || E'\n';
  EXCEPTION WHEN check_violation THEN
    log := log || 'B2 neither owner set' || E'\t' || 'refused (23514)' || E'\n';
  WHEN OTHERS THEN
    log := log || 'B2 neither owner set' || E'\t'
        || 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B3. A blank reflection is refused. The whole reason the daily log was
  --     removed is that reflection moved onto the task record; an optional
  --     field would go empty and take the reason with it. Whitespace is not
  --     a reflection, so the guard is btrim, not IS NULL.
  BEGIN
    PERFORM submit_assignment(a_assign, 'did the thing', '   ', '[]'::jsonb, '[]'::jsonb);
    log := log || 'B3 blank reflection' || E'\t'
        || 'FAIL: accepted -- whitespace passed as a reflection' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B3 blank reflection' || E'\t'
        || CASE WHEN SQLERRM LIKE '%REFLECTION_REQUIRED%' THEN 'refused (REFLECTION_REQUIRED)'
                ELSE 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- B4. Resubmitting rewrites the evidence rather than appending to it. The
  --     client holds the full list, so a student who removes a photo and
  --     resubmits must end with one photo, not two.
  PERFORM submit_assignment(a_assign, 'first go', 'learned one thing',
    '[{"uri":"probe://p1","caption":"one"},{"uri":"probe://p2","caption":"two"}]'::jsonb,
    '[]'::jsonb);
  PERFORM submit_assignment(a_assign, 'second go', 'learned one thing',
    '[{"uri":"probe://p1","caption":"one"}]'::jsonb,
    '[]'::jsonb);

  SELECT count(*) INTO n FROM log_photos p
  WHERE p.submission_id = (SELECT s.id FROM assignment_submissions s
                           WHERE s.assignment_id = a_assign AND s.student_id = the_student);
  log := log || 'B4 resubmit rewrites evidence' || E'\t'
      || CASE WHEN n = 1 THEN '1 photo after removing one'
              WHEN n = 2 THEN 'FAIL: 2 photos -- evidence appended instead of rewritten'
              ELSE 'FAIL: ' || n || ' photos, expected 1' END || E'\n';

  -- B5. Two submissions in the same week must not move the streak twice.
  --     The daily version got this for free from UNIQUE(student_id, date).
  --     Here it is a branch that can be deleted without any other case
  --     noticing, which is exactly why it gets a case of its own.
  SELECT current_streak INTO n FROM student_profiles WHERE id = the_student;

  PERFORM submit_assignment(a_assign2, 'same week', 'learned another thing',
    '[]'::jsonb, '[]'::jsonb);

  SELECT current_streak INTO n2 FROM student_profiles WHERE id = the_student;
  log := log || 'B5 same-week streak' || E'\t'
      || CASE WHEN n2 = n THEN 'unchanged at ' || n
              ELSE 'FAIL: moved ' || n || ' -> ' || n2
                   || ' for a second task in the same week' END || E'\n';

  -- B6. Submit XP is paid once per submission, not once per submit call.
  --     B4 already called submit_assignment twice on a_assign.
  SELECT count(*) INTO n FROM xp_transactions x
  WHERE x.student_id = the_student
    AND x.reason = 'assignment_submitted:' || (
      SELECT s.id FROM assignment_submissions s
      WHERE s.assignment_id = a_assign AND s.student_id = the_student)::text;
  log := log || 'B6 submit XP once' || E'\t'
      || CASE WHEN n = 1 THEN '1 transaction after two submits'
              ELSE 'FAIL: ' || n || ' transactions' END || E'\n';

  -- B7. The photo bonus counts the evidence this function just wrote. A
  --     trigger on assignment_submissions would fire before those rows exist
  --     and always read zero -- the reason the awards live in the RPC.
  SELECT coalesce(sum(x.amount), 0) INTO n FROM xp_transactions x
  WHERE x.student_id = the_student
    AND x.reason = 'assignment_photo:' || (
      SELECT s.id FROM assignment_submissions s
      WHERE s.assignment_id = a_assign AND s.student_id = the_student)::text;
  log := log || 'B7 photo bonus sees evidence' || E'\t'
      || CASE WHEN n = 6 THEN '6 XP for the two photos at first submit'
              WHEN n = 0 THEN 'FAIL: 0 XP -- the count ran before the evidence was written'
              ELSE 'FAIL: ' || n || ' XP, expected 6' END || E'\n';

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;


-- ============================================================
-- PART C — the evidence policy, actually evaluated.
-- Submit BEGIN..ROLLBACK in one go.
--
--   C1 owner student reads   1 photo        (positive control)
--   C2 unrelated student     0 photos
--   C3 evidence on approved  refused by RLS (42501)
--
-- C1 is the positive control and is not optional. Without it, C2 returning
-- zero is indistinguishable from the policy refusing everyone, or from the
-- new branch never being reached at all.
-- ============================================================

BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; other UUID; grp UUID; kpi UUID;
  a_open UUID; a_done UUID; s_open UUID; s_done UUID;
BEGIN
  SELECT id INTO adv   FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu   FROM profiles WHERE role = 'student'  ORDER BY created_at LIMIT 1;
  SELECT id INTO other FROM profiles WHERE role = 'student' AND id <> stu
                                     ORDER BY created_at LIMIT 1;

  IF adv IS NULL OR stu IS NULL OR other IS NULL THEN
    PERFORM set_config('probe.ready', 'no', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name)
  VALUES (adv, 'Probe D1 policies') RETURNING id INTO grp;

  SELECT k.id INTO kpi
  FROM competency_kpis k
  JOIN competencies c ON c.id = k.competency_id
  WHERE k.level = 1 AND k.kpi_index = 1
  ORDER BY c.display_order LIMIT 1;

  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe open', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 0 LIMIT 1
  RETURNING id INTO a_open;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe done', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 1 LIMIT 1
  RETURNING id INTO a_done;

  -- Written directly rather than through submit_assignment: this is the owner
  -- session, and the point of the fixture is a known starting state, not an
  -- exercise of the RPC. Direct writes are only possible here BECAUSE the
  -- session is the owner -- which is exactly what C3 proves a client cannot do.
  INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection)
  VALUES (a_open, stu, 'submitted', 'probe') RETURNING id INTO s_open;

  INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection)
  VALUES (a_done, stu, 'approved', 'probe') RETURNING id INTO s_done;

  INSERT INTO log_photos (submission_id, uri) VALUES (s_open, 'probe://open');
  INSERT INTO log_photos (submission_id, uri) VALUES (s_done, 'probe://done');

  PERFORM set_config('probe.ready',  'yes',        true);
  PERFORM set_config('probe.stu',    stu::text,    true);
  PERFORM set_config('probe.other',  other::text,  true);
  PERFORM set_config('probe.s_open', s_open::text, true);
  PERFORM set_config('probe.s_done', s_done::text, true);
END $$;

-- If this raises 42501 in your editor, STOP. Do not replace the cases below
-- with catalog lookups: a structural check here would assert what Part A
-- already asserts while reading as though it had proved more. Report Part C
-- as unrunnable instead.
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  stu UUID; other UUID; s_open UUID; s_done UUID;
  n INT; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results',
      'C1-C3 policies' || E'\t'
      || 'SKIP: needs one advisor and two student profiles' || E'\n', true);
    RETURN;
  END IF;

  stu    := current_setting('probe.stu')::UUID;
  other  := current_setting('probe.other')::UUID;
  s_open := current_setting('probe.s_open')::UUID;
  s_done := current_setting('probe.s_done')::UUID;

  -- C1. The owning student reads their own evidence. POSITIVE CONTROL.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  SELECT count(*) INTO n FROM log_photos p WHERE p.submission_id = s_open;
  log := log || 'C1 owner student reads' || E'\t'
      || CASE WHEN n = 1 THEN '1 photo'
              WHEN n = 0 THEN 'FAIL: 0 photos -- the submission branch is unreachable'
              ELSE 'FAIL: ' || n || ' photos' END || E'\n';

  -- C2. An unrelated student. The branch delegates to
  --     assignment_submissions' own SELECT policy, which does not admit them.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other)::text, true);
  SELECT count(*) INTO n FROM log_photos p WHERE p.submission_id = s_open;
  log := log || 'C2 unrelated student' || E'\t'
      || CASE WHEN n = 0 THEN '0 photos'
              ELSE 'FAIL: ' || n || ' photos leaked' END || E'\n';

  -- C3. Attaching evidence to an APPROVED submission. The insert policy's
  --     status <> 'approved' clause must refuse: an approved submission has
  --     produced a KPI observation, and changing the evidence under it means
  --     a level standing on something the mentor never saw.
  --
  --     This one asserts an ERROR, unlike C2's row count, because INSERT is
  --     the one command where a failed WITH CHECK raises 42501 instead of
  --     silently filtering.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  BEGIN
    INSERT INTO log_photos (submission_id, uri) VALUES (s_done, 'probe://late');
    log := log || 'C3 evidence on approved' || E'\t'
        || 'FAIL: accepted -- evidence changed under a written observation' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN
    log := log || 'C3 evidence on approved' || E'\t' || 'refused by RLS (42501)' || E'\n';
  WHEN OTHERS THEN
    log := log || 'C3 evidence on approved' || E'\t'
        || 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

-- Back to the owner before anything else reads the results, so a failure in the
-- SELECT below cannot be blamed on the role change.
RESET ROLE;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;


-- ============================================================
-- How to run this
--
-- The three parts are submitted SEPARATELY. Parts B and C each go in as one
-- block, BEGIN..ROLLBACK in a single submission -- the SQL editor gives each
-- submission its own connection, so a transaction split across submissions
-- loses its state (42P01).
--
-- Expected output: Part A one row reading PASS; Part B seven rows; Part C
-- three rows. Any cell beginning FAIL, INCONCLUSIVE or SKIP is a real result
-- to look at, not noise to scroll past.
--
-- This script requires the D1 SQL to already be applied, and that must NOT
-- happen until D2 is complete: Task 2 dropped the submit_assignment
-- signature the currently-shipped client still calls, so applying D1 early
-- breaks every student on an old build. Run this at the end of D2, not now.
-- ============================================================
