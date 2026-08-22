-- docs/task-assignment-verification.sql
-- Run after docs/task-triplets-migration.sql, docs/task-assignment-migration.sql
-- and docs/task-assignment-rpcs.sql. Two separate submissions.
--
-- Part A asserts the schema. Part B exercises the rules that carry the design
-- — an approval writes exactly one observation, a withdrawal takes it back, a
-- level needs both its KPIs demonstrated twice, a log re-save must not sweep
-- away a task observation, and a competency outside the group's scope is
-- refused at review time — inside a transaction that rolls back. Part C drops
-- into the `authenticated` role and evaluates the policies themselves.
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
-- verification runs hid a 42P17 recursion for exactly this reason.
--
-- Part C is the answer to that blind spot: `SET LOCAL ROLE authenticated`
-- makes the same session subject to RLS, so the three assertions there are the
-- first in this project that actually EVALUATE a policy rather than read its
-- catalog entry. Parts A and B still run as owner and are still structural —
-- do not read a green Part A as evidence that a policy works.

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
             WHERE schemaname = 'public'
               AND tablename IN ('kpi_triplets','assignment_submissions')
               AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: a write policy exists on a read-only or RPC-only table';
  END IF;

  -- STRUCTURAL, same caveat: proves no write policy exists on
  -- kpi_observations, never that the SELECT policy evaluates without
  -- recursing. This absence is the security foundation the whole
  -- approval-to-observation bridge rests on: record_kpi_observations and
  -- review_assignment are SECURITY DEFINER and take observed_by from
  -- auth.uid() themselves, so nothing else may write here. A single INSERT
  -- policy would let a client set observed_by to somebody else and
  -- manufacture the two independent observations a level requires.
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public'
               AND tablename = 'kpi_observations'
               AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: a write policy exists on kpi_observations; a client could set observed_by to somebody else and manufacture the two independent observations a level requires';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE indexname = 'one_observation_per_submission') THEN
    RAISE EXCEPTION 'FAIL: one_observation_per_submission is missing; re-approval would double-count';
  END IF;

  -- STRUCTURAL, and the right kind of structural: a trigger either exists or it
  -- does not, and that is exactly what a catalog check can prove. Both of these
  -- guard rules that Part B cannot protect on its own -- case 6 still passes
  -- with trg_assignment_within_scope dropped, because review_assignment's own
  -- scope check catches the same thing one step later. Without these two
  -- assertions the creation-time guard could be deleted in silence.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname = 'group_assignments'
      AND tg.tgname = 'trg_assignment_within_scope'
      AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL: trg_assignment_within_scope is missing; an advisor could create an assignment for a competency outside the group scope, and only the mentor would find out, after the student had done the work';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname = 'group_assignments'
      AND tg.tgname = 'trg_freeze_assessed_assignment'
      AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL: trg_freeze_assessed_assignment is missing; objective, criterion and triplet_id would be editable after approvals exist, so an approval would no longer mean what it meant when it was granted';
  END IF;

  -- STRUCTURAL: the same shape-of-policy check the recursion fix ends with.
  -- These two tables consult group ownership, membership and the mentor link
  -- at once, which is the shape that produced 42P17. This proves no policy
  -- body reads a group table directly (which would re-enter that table's own
  -- policies); it does not execute any policy, so it cannot itself detect a
  -- recursion — only the absence of the pattern that is known to cause one.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('group_assignments','assignment_submissions')
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
--   1 approval           1 observation
--   2 re-approval        still 1 observation
--   3 withdrawal         0 observations
--   3b resubmit after revision  accepted, back to submitted
--   4 full level         current_level = 1
--   5 log re-save        task observation survived
--   5b log tick insert   2 ticks in, 4 task observations still there
--   6 out of scope       rejected NOT_IN_SCOPE
--   7 reopen approved    rejected ALREADY_APPROVED
--   8 student left group rejected STUDENT_LEFT_GROUP
--   9 assignment locked  rejected ASSIGNMENT_LOCKED
--   9b title editable    title changed on an assessed assignment
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
  kpi1 UUID; kpi2 UUID;
  asg UUID; sub UUID; resub UUID; asg8 UUID; sub8 UUID; lg UUID;
  n INT; n2 INT; lvl INT; st TEXT; log TEXT := '';
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

  -- 3b. The other half of case 3, and the claim submit_assignment's own comment
  --     makes about this file: "that path is exercised by the verification
  --     script". Until this case existed it was not. Nothing in Part B ever
  --     resubmitted a needs_revision row -- case 3 leaves `sub` sent back and
  --     case 4 immediately reassigns that variable in its loop -- so the comment
  --     described a case nobody had written.
  --
  --     It is the path that most needs one. Sending work back is only
  --     meaningful if the student can act on it, and submit_assignment's
  --     ALREADY_APPROVED guard is the code standing between them. That guard is
  --     now TWO things -- a standalone EXISTS, and a
  --     `WHERE assignment_submissions.status <> 'approved'` on the DO UPDATE
  --     that makes the check atomic with the write. Either one written a notch
  --     too wide (`= 'submitted'`, say, or an EXISTS that stops testing status)
  --     turns every revision request into a task the student can never hand
  --     back in, and no other case in this file would notice.
  --
  --     Both halves are asserted, because either alone would mislead. The
  --     non-null id is what catches the silent failure that WHERE introduces:
  --     an excluded row updates nothing, RETURNING yields nothing, `submission`
  --     stays NULL, and without submit_assignment's NULL check the client would
  --     be handed NULL as success. The status is what catches an id returned
  --     without the row actually moving.
  --
  --     `asg` is still case 1-3's assignment here; case 4 reassigns it below.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  BEGIN
    SELECT submit_assignment(asg, 'reworked', NULL) INTO resub;
    SELECT s.status INTO st FROM assignment_submissions s WHERE s.id = resub;
    log := log || '3b resubmit after revision' || E'\t'
        || CASE WHEN resub IS NOT NULL AND st = 'submitted'
                     THEN 'accepted, back to submitted'
                WHEN resub IS NULL
                     THEN 'FAIL: submit_assignment returned NULL'
                ELSE 'FAIL: status is ' || coalesce(st, '(row missing)') END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '3b resubmit after revision' || E'\t'
        || 'FAIL: resubmission refused: ' || SQLERRM || E'\n';
  END;

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

  -- 5. Saving a daily log must not sweep away task observations, protected by
  --    the `assignment_submission_id IS NULL` clause in
  --    record_kpi_observations's DELETE. To make that clause the thing this
  --    case actually depends on, the other three predicates of the DELETE
  --    must all match the four task observations from case 4 — student_id,
  --    log_id, and observed_by — leaving assignment_submission_id IS NULL as
  --    the only reason they survive.
  --
  --    Those observations carry log_id = NULL (review_assignment sets it
  --    explicitly) and observed_by = men (the mentor approved them). Calling
  --    as the student with a real log id — the shape the app actually uses —
  --    would exclude them by observed_by and by log_id before the clause
  --    under test ever gets consulted, and this case would report success
  --    even with the clause deleted.
  --
  --    So: call as the mentor, whose id is on those observations, with a NULL
  --    log id. Passing an empty KPI array keeps the case focused — nothing is
  --    deleted or inserted by the array-driven parts of the function, so the
  --    only thing being measured is whether the DELETE spared the task rows.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', men)::text, true);
  PERFORM record_kpi_observations(stu, NULL, ARRAY[]::UUID[]);
  SELECT count(*) INTO n FROM kpi_observations o
  WHERE o.student_id = stu AND o.assignment_submission_id IS NOT NULL;
  log := log || '5 log re-save' || E'\t'
      || CASE WHEN n >= 4 THEN 'task observation survived'
              ELSE 'FAIL: only ' || n || ' task observations left' END || E'\n';

  -- 5b. Case 5 above is deliberately the isolated one: mentor, NULL log, empty
  --     array, so that `assignment_submission_id IS NULL` is the only reason the
  --     task rows survive. The price is that nothing then exercises
  --     record_kpi_observations on its REAL path -- a student saving a log with
  --     boxes ticked -- which is the one function C1 changed. A guard clause can
  --     be made to pass by a call that never reaches the INSERT at all.
  --
  --     So: as the STUDENT, with a real daily_logs id and a non-empty KPI array.
  --     Both halves are asserted, because either alone would mislead. The ticks
  --     must land -- the INSERT branch runs and writes observed_by = the student
  --     -- AND the four task observations from case 4 must still be there, this
  --     time with the DELETE having run on the shape the app actually sends.
  --
  --     The date is in 1900 for the reason the header gives: daily_logs carries
  --     UNIQUE(student_id, date), and colliding with a real log the student
  --     already wrote would surface as a unique_violation that reads like a bug
  --     in the framework rather than a fixture clash.
  INSERT INTO daily_logs (student_id, date, title, content)
  VALUES (stu, DATE '1900-01-01', 'Probe tick', 'Probe tick') RETURNING id INTO lg;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  PERFORM record_kpi_observations(stu, lg, ARRAY[kpi1, kpi2]);

  SELECT count(*) INTO n FROM kpi_observations o
  WHERE o.student_id = stu AND o.log_id = lg AND o.observed_by = stu;
  SELECT count(*) INTO n2 FROM kpi_observations o
  WHERE o.student_id = stu AND o.assignment_submission_id IS NOT NULL;
  log := log || '5b log tick insert' || E'\t'
      || CASE WHEN n = 2 AND n2 >= 4 THEN '2 ticks in, 4 task observations still there'
              WHEN n <> 2 THEN 'FAIL: ' || n || ' ticks landed, expected 2'
              ELSE 'FAIL: ticks landed but only ' || n2
                   || ' task observations left' END || E'\n';

  -- 7. A student cannot reopen their own approved submission. `sub` is the last
  --    submission case 4 approved, and the observation it produced is still
  --    counting toward the level. Letting submit_assignment reset that row to
  --    'submitted' would leave evidence standing behind a submission nobody
  --    approved, and would erase the mentor's attribution on a record that still
  --    grants credit. Reopening is review_assignment(id, false, note), which
  --    retracts the observation in the same statement.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  BEGIN
    PERFORM submit_assignment(
      (SELECT s.assignment_id FROM assignment_submissions s WHERE s.id = sub),
      'trying again', NULL);
    log := log || '7 reopen approved' || E'\t' || 'FAIL: resubmission accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '7 reopen approved' || E'\t'
        || CASE WHEN SQLERRM = 'ALREADY_APPROVED' THEN 'rejected ALREADY_APPROVED'
                ELSE 'FAIL (wrong error): ' || SQLERRM END || E'\n';
  END;

  -- 8. A student who has left the assignment's group cannot be approved into
  --    it. review_assignment validates scope against the ASSIGNMENT's group
  --    while get_competency_progress reads the student's ACTIVE membership, so
  --    without this guard an approval would be validated against group A and
  --    the progress read from group B -- nothing moves, and nothing says why.
  --
  --    The guard sits BEFORE the scope check, so the membership is the fact
  --    reported first. That is why this case can be built without touching the
  --    group's targets at all.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe left', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr
  WHERE tr.kpi_id = kpi1
    AND tr.id NOT IN (SELECT a.triplet_id FROM group_assignments a WHERE a.group_id = grp)
  ORDER BY tr.triplet_index LIMIT 1
  RETURNING id INTO asg8;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  SELECT submit_assignment(asg8, 'probe', NULL) INTO sub8;

  -- join_group_by_code closes a membership exactly this way rather than
  -- deleting it, so this is the real shape of a student moving on.
  UPDATE group_memberships m SET left_at = now()
  WHERE m.group_id = grp AND m.student_id = stu AND m.left_at IS NULL;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', men)::text, true);
  BEGIN
    PERFORM review_assignment(sub8, true, 'ok');
    log := log || '8 student left group' || E'\t' || 'FAIL: approval accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '8 student left group' || E'\t'
        || CASE WHEN SQLERRM = 'STUDENT_LEFT_GROUP' THEN 'rejected STUDENT_LEFT_GROUP'
                ELSE 'FAIL (wrong error): ' || SQLERRM END || E'\n';
  END;

  -- Re-open it. Case 6 below still has the student submit, and
  -- submit_assignment refuses a non-member with ROLE_NOT_ALLOWED, which would
  -- surface as a wrong-error failure on case 6 that has nothing to do with
  -- scope. Setting left_at back to NULL is the narrowest undo: this case owns
  -- the membership only for as long as it needs it.
  UPDATE group_memberships m SET left_at = NULL
  WHERE m.group_id = grp AND m.student_id = stu;

  -- 9. Once an assignment carries a submission, the terms it is assessed
  --    against are frozen. objective and criterion are COPIED from the triplet
  --    precisely so that approvals granted last month still mean what they
  --    meant then; an advisor editing them afterwards would rewrite the
  --    standard a mentor has already judged against, and editing triplet_id
  --    would re-point the assignment at a different KPI while existing
  --    observations kept the old one.
  --
  --    asg8 already carries sub8 from case 8, so it is the row this rule is
  --    about. The UPDATE runs as the owner, which is fine and in fact the
  --    stronger test: RLS is bypassed here, so nothing but the trigger itself
  --    can be what refuses.
  BEGIN
    UPDATE group_assignments a SET criterion = a.criterion || ' (edited)'
    WHERE a.id = asg8;
    log := log || '9 assignment locked' || E'\t' || 'FAIL: criterion edit accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '9 assignment locked' || E'\t'
        || CASE WHEN SQLERRM = 'ASSIGNMENT_LOCKED' THEN 'rejected ASSIGNMENT_LOCKED'
                ELSE 'FAIL (wrong error): ' || SQLERRM END || E'\n';
  END;

  -- 9b. The other half, and the half that makes 9 mean something. A freeze that
  --     blocked every edit would pass case 9 while being a different bug: title,
  --     description and due_date are presentation, not the terms of assessment,
  --     and an advisor must still be able to fix a typo or move a deadline on an
  --     assignment students have already submitted to.
  BEGIN
    UPDATE group_assignments a SET title = 'Probe renamed' WHERE a.id = asg8;
    SELECT count(*) INTO n FROM group_assignments a
    WHERE a.id = asg8 AND a.title = 'Probe renamed';
    log := log || '9b title editable' || E'\t'
        || CASE WHEN n = 1 THEN 'title changed on an assessed assignment'
                ELSE 'FAIL: title unchanged' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '9b title editable' || E'\t'
        || 'FAIL: the freeze blocked a title edit: ' || SQLERRM || E'\n';
  END;

  -- 6. A competency outside the group's scope must be refused at review time,
  --    or the student is approved and nothing moves.
  --
  --    Order matters here. trg_assignment_within_scope now rejects the INSERT
  --    itself once the target is gone, so the assignment has to be created
  --    while the competency IS in scope and the target removed afterwards --
  --    the only sequence that still reaches review_assignment's own check. It
  --    is the truer scenario anyway: the advisor narrows the group's scope
  --    after tasks are already outstanding, which is now the only way a
  --    submission can arrive for a competency the group does not target.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe scope', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi1 ORDER BY tr.triplet_index DESC LIMIT 1
  RETURNING id INTO asg;

  DELETE FROM group_competency_targets gt
  WHERE gt.group_id = grp AND gt.competency_id = comp;

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


-- ============================================================
-- PART C — the policies, actually evaluated. Submit BEGIN..ROLLBACK in one go.
--
--   C1 delete unused      deleted
--   C2 delete assessed    0 rows deleted, row still there
--   C3 direct submission  refused by RLS (42501)
--
-- Parts A and B run as the table owner, and an owner bypasses RLS. Every RLS
-- claim this project has made so far is therefore structural: it proves a
-- policy EXISTS. On 2026-08-20 that blind spot let a 42P17 recursion through
-- two green verification runs. `SET LOCAL ROLE authenticated` closes it — the
-- same session, now subject to RLS, so a policy that cannot be evaluated fails
-- here instead of failing on a device.
--
-- Why C2 asserts a row count and not an error: for DELETE and UPDATE, a USING
-- qual FILTERS rows rather than raising. An advisor deleting an assignment that
-- carries submissions gets a perfectly successful statement affecting zero
-- rows, so "it did not raise" proves nothing and the row itself has to be
-- looked for afterwards. Only INSERT/WITH CHECK raises, which is why C3 can
-- assert an error.
--
-- C3 is the one that matters most. assignment_submissions has no INSERT policy
-- because review_assignment's approval writes a KPI observation; if a client
-- could insert a submission directly, that observation would be forgeable. An
-- accepted insert here is reported as FAIL, not as a curiosity.
--
-- The fixtures are built as the owner BEFORE the role change, and their ids are
-- handed over in transaction-local GUCs — a temp table would be invisible to
-- the next statement (42P01), and PL/pgSQL variables do not outlive their DO
-- block. Building them as owner is not a shortcut: the submission C2 needs
-- cannot be created through RLS by anyone, which is exactly what C3 asserts.
-- ============================================================

BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; grp UUID; kpi UUID;
  a_free UUID; a_used UUID; a_spare UUID;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student'  ORDER BY created_at LIMIT 1;

  IF adv IS NULL OR stu IS NULL THEN
    PERFORM set_config('probe.ready', 'no', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name)
  VALUES (adv, 'Probe policies') RETURNING id INTO grp;

  -- tr_seed_group_competency_targets seeded every competency as a target on
  -- that INSERT, so any triplet is in scope and trg_assignment_within_scope
  -- lets these three through. Three separate assignments, because C1 deletes
  -- one, C2 needs one that already carries a submission, and C3 must insert
  -- against a third: attempting C3 against C2's assignment would hit
  -- UNIQUE (assignment_id, student_id) and could not tell an RLS refusal apart
  -- from a duplicate.
  SELECT k.id INTO kpi
  FROM competency_kpis k
  JOIN competencies c ON c.id = k.competency_id
  WHERE k.level = 1 AND k.kpi_index = 1
  ORDER BY c.display_order LIMIT 1;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe free', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 0 LIMIT 1
  RETURNING id INTO a_free;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe used', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 1 LIMIT 1
  RETURNING id INTO a_used;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe spare', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 2 LIMIT 1
  RETURNING id INTO a_spare;

  INSERT INTO assignment_submissions (assignment_id, student_id, status)
  VALUES (a_used, stu, 'submitted');

  PERFORM set_config('probe.ready',   'yes',         true);
  PERFORM set_config('probe.adv',     adv::text,     true);
  PERFORM set_config('probe.stu',     stu::text,     true);
  PERFORM set_config('probe.a_free',  a_free::text,  true);
  PERFORM set_config('probe.a_used',  a_used::text,  true);
  PERFORM set_config('probe.a_spare', a_spare::text, true);
END $$;

-- The line the whole part turns on. In Supabase the SQL editor connects as
-- `postgres`, which is a member of `authenticated`, so this succeeds. If it
-- raises 42501 (insufficient_privilege) in your editor, STOP: do not replace
-- the three cases below with catalog lookups, because a structural check here
-- would assert exactly what Part A already asserts while reading as though it
-- had proved more. Report Part C as unrunnable instead.
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  adv UUID; stu UUID; a_free UUID; a_used UUID; a_spare UUID;
  n INT; n2 INT; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results',
      'C1-C3 policies' || E'\t' || 'SKIP: needs one advisor and one student profile' || E'\n', true);
    RETURN;
  END IF;

  adv     := current_setting('probe.adv')::UUID;
  stu     := current_setting('probe.stu')::UUID;
  a_free  := current_setting('probe.a_free')::UUID;
  a_used  := current_setting('probe.a_used')::UUID;
  a_spare := current_setting('probe.a_spare')::UUID;

  -- C1. The advisor owns the group and nobody has submitted, so
  --     "advisor deletes assignments" lets the row go. This is the positive
  --     control: without it, C2 passing would be indistinguishable from the
  --     policy refusing everything, or from the advisor not being able to see
  --     the row at all.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv)::text, true);

  DELETE FROM group_assignments a WHERE a.id = a_free;
  GET DIAGNOSTICS n = ROW_COUNT;
  log := log || 'C1 delete unused' || E'\t'
      || CASE WHEN n = 1 THEN 'deleted'
              ELSE 'FAIL: ' || n || ' rows deleted, expected 1' END || E'\n';

  -- C2. The same advisor, an assignment that carries a submission. The USING
  --     qual filters the row out, so the statement succeeds and affects
  --     nothing — and the row must still be there afterwards. Deleting it would
  --     cascade away the submission and, through it, any KPI observation the
  --     approval produced.
  DELETE FROM group_assignments a WHERE a.id = a_used;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT count(*) INTO n2 FROM group_assignments a WHERE a.id = a_used;
  log := log || 'C2 delete assessed' || E'\t'
      || CASE WHEN n = 0 AND n2 = 1 THEN '0 rows deleted, row still there'
              WHEN n <> 0 THEN 'FAIL: ' || n || ' rows deleted'
              ELSE 'FAIL: row is gone' END || E'\n';

  -- C3. A student writing a submission directly. There is no INSERT policy, so
  --     WITH CHECK has nothing to satisfy and the write must be refused. If it
  --     is accepted, the RPC-only write path has a hole and a KPI observation
  --     could be forged from a submission the student wrote for themselves.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  BEGIN
    INSERT INTO assignment_submissions (assignment_id, student_id, status)
    VALUES (a_spare, stu, 'submitted');
    log := log || 'C3 direct submission' || E'\t'
        || 'FAIL: insert accepted -- an observation could be forged' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN
    -- 42501 covers both refusals worth having: "new row violates row-level
    -- security policy" and a missing table-level INSERT grant. Either one means
    -- the client cannot write here.
    log := log || 'C3 direct submission' || E'\t' || 'refused by RLS (42501)' || E'\n';
  WHEN OTHERS THEN
    log := log || 'C3 direct submission' || E'\t'
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
