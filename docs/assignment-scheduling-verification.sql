-- docs/assignment-scheduling-verification.sql
-- Proves docs/assignment-scheduling.sql: sending a task can be scheduled, and
-- a pg_cron job publishes what is due every minute.
-- Spec: docs/superpowers/specs/2026-10-10-assignment-scheduling-design.md
--
-- Run in the Supabase SQL editor, ONE PART PER SUBMISSION. Anonymous
-- dollar-quoting only (a named tag fails in the editor).
-- Apply order: docs/assignment-scheduling.sql first, and pg_cron must already
-- be enabled in the dashboard (Database -> Extensions) -- that file registers
-- the job and will not apply at all without it.
--
-- PART A is STRUCTURAL and comes in TWO submissions, because the editor shows
-- only the LAST statement's result: A1-A7 in one paste, then the cron check on
-- its own. The cron check is separate for a second reason -- on a database
-- without pg_cron the schema `cron` does not exist and a query naming
-- cron.job fails at PARSE time, which would take the other seven rows down
-- with it. See the header above that statement for what each outcome means.
-- PART B is BEHAVIOUR: owner-run, actors impersonated through
-- request.jwt.claims, everything inside BEGIN ... ROLLBACK. The owner bypasses
-- RLS here, so the one check about who may SEE an assignment calls the read
-- policy's own predicate (can_see_assignment) -- a raw SELECT from this
-- session answers "yes" for everybody and would report FAIL on correct code.
-- PART C is the only real RLS test: SET LOCAL ROLE authenticated, which is
-- what actually makes a policy evaluate (see the note in
-- docs/review-by-advisor-verification.sql), and the only place the two
-- internal functions' REVOKEs are evaluated rather than merely read.
--
-- Parts B and C accumulate PASS/FAIL lines into a v_log and publish it through
-- set_config('probe.results', ...) because the editor hides NOTICE and shows
-- only the last statement's result. Every check sits in its own
-- BEGIN ... EXCEPTION sub-block -- that is a savepoint, so one failing check
-- rolls back only itself and the checks after it still run. The fixtures each
-- part builds first are deliberately NOT guarded: if they cannot be built, no
-- check below them means anything and the owner should see the raw error.
--
-- ---- THREE THINGS PART B DOES TO LIVE DATA, ALL UNDONE BY THE ROLLBACK ----
-- 1. It ARCHIVES group 58MMWL (check B9 is about a group archived between
--    scheduling and the hour) and un-archives it again. Archiving fires
--    trg_dm_group_archived, which DELETES every conversation of the group and,
--    through trg_dm_conversation_deleted, their direct_message notifications.
--    The un-archive does NOT bring those back -- only the ROLLBACK does. So
--    PART B MUST BE PASTED WHOLE, BEGIN and ROLLBACK included. Pasting its DO
--    block alone would destroy the simulation group's message history.
-- 2. It parks any assignment that is already due a century into the future,
--    because publish_due_assignments() is global and a stranger's due row
--    would be counted into the return values B4, B5 and B12b assert exactly.
-- 3. It touches the advisory lock publish_due_assignments() uses. A SESSION
--    advisory lock does NOT come back with a ROLLBACK, which is why B12b
--    drains the key before it measures and drains it again if it raises.
-- ============================================================


-- ============================================================
-- PART A (1 of 2) -- structural. Run this statement alone. Expect 7 rows,
-- all PASS. A FAIL here means docs/assignment-scheduling.sql was not applied,
-- or was applied and then partly undone by re-running an older file.
-- ============================================================
WITH checks AS (
  SELECT 'A1 scheduled_for column on group_assignments' AS check_name,
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'group_assignments'
                   AND column_name = 'scheduled_for'
                   AND data_type = 'timestamp with time zone') AS ok
  -- timestamptz, not timestamp or date: the picker produces the advisor's local
  -- moment and a student in another country must see that same moment.
  UNION ALL SELECT 'A2 schedule_error column on group_assignments',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'group_assignments'
                   AND column_name = 'schedule_error'
                   AND data_type = 'text')
  -- Non-NULL here is also what means "do not try again". Without the column the
  -- job would re-notify a broken batch every minute, forever.
  UNION ALL SELECT 'A3 group_assignments_due_idx exists',
         EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname = 'public' AND tablename = 'group_assignments'
                   AND indexname = 'group_assignments_due_idx')
  -- The job's only query runs every minute of every day; this is the index it
  -- runs on.
  UNION ALL SELECT 'A4 publish_assignments_internal: definer, fixed search_path, callable by neither authenticated nor anon',
         -- to_regprocedure returns NULL instead of raising when the function is
         -- absent, so a database that has not seen the migration gets a FAIL
         -- row here rather than an error that kills the whole of Part A.
         EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.oid = to_regprocedure('public.publish_assignments_internal(uuid[])')
                   AND p.prosecdef
                   AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%')
         -- coalesce(..., true) on a NEGATIVE assertion, so an absent function
         -- reads FAIL rather than passing by vacuum.
     AND NOT coalesce((SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                       FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.publish_assignments_internal(uuid[])')), true)
     AND NOT coalesce((SELECT has_function_privilege('anon', p.oid, 'EXECUTE')
                       FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.publish_assignments_internal(uuid[])')), true)
  -- This is the function with NO identity check of its own: it trusts its
  -- caller to have established one, because the cron job has no auth.uid() to
  -- establish. EXECUTE granted to authenticated would let any logged-in
  -- student publish any draft in any group, naming its ids. Creating a
  -- function grants EXECUTE to PUBLIC, which anon inherits, so the REVOKE in
  -- the migration is load-bearing and this row is what proves it ran.
  UNION ALL SELECT 'A5 publish_due_assignments: definer, fixed search_path, callable by neither authenticated nor anon',
         EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.oid = to_regprocedure('public.publish_due_assignments()')
                   AND p.prosecdef
                   AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%')
     AND NOT coalesce((SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                       FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.publish_due_assignments()')), true)
     AND NOT coalesce((SELECT has_function_privilege('anon', p.oid, 'EXECUTE')
                       FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.publish_due_assignments()')), true)
  -- SECURITY DEFINER matters more here than anywhere else in the file: the job
  -- runs with no logged-in user at all, so every table it touches it touches as
  -- the owner. The fixed search_path is what stops an unqualified name in the
  -- body resolving somewhere else.
  UNION ALL SELECT 'A6 schedule_assignments is callable by authenticated',
         coalesce((SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   FROM pg_proc p
                   WHERE p.oid = to_regprocedure('public.schedule_assignments(uuid[],timestamptz)')), false)
  -- The advisor's screen calls this one. Without the grant the Schedule button
  -- fails for everybody with a message about a missing function.
  UNION ALL SELECT 'A7 publish_assignments is callable by authenticated',
         coalesce((SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   FROM pg_proc p
                   WHERE p.oid = to_regprocedure('public.publish_assignments(uuid[])')), false)
  -- The migration re-creates publish_assignments as a thin wrapper, and a
  -- CREATE OR REPLACE keeps the old grants -- but this file is also the new
  -- HOME of that function, so on a database rebuilt from scratch the grant
  -- comes from here. Send now is the default path in the UI; if this row is
  -- red, publishing is broken for every advisor.
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, check_name
FROM checks
-- coalesce, not a bare ok: a NULL from a missing object sorts last under the
-- default NULLS LAST and would hide a failure below the passing rows.
ORDER BY coalesce(ok, false), check_name;


-- ============================================================
-- PART A (2 of 2) -- the cron job. Run this statement ALONE, as its own
-- submission. One row. Three possible outcomes, and they mean different
-- things:
--   * PASS -- the job exists under the expected name and runs every minute.
--   * FAIL -- pg_cron IS enabled, but there is no job named
--     publish-due-assignments with schedule '* * * * *'. Either the tail of
--     docs/assignment-scheduling.sql did not run, or somebody unscheduled it.
--     Nothing will ever publish itself; every scheduled task sits as a draft
--     until an advisor taps Send now (the overdue state in the drafts tray
--     exists for exactly this).
--   * ERROR 3F000 / 42P01 naming the schema or relation "cron" -- pg_cron is
--     NOT enabled on this database. That is the owner's dashboard step
--     (Database -> Extensions) and it must be done BEFORE
--     docs/assignment-scheduling.sql is pasted, because that file registers
--     the job in its last statement and a failure there rolls the whole file
--     back. This is also why the check is a statement of its own: the
--     reference to cron.job cannot be resolved at parse time, so inside Part A
--     (1 of 2) it would have taken all seven structural rows down with it.
-- This row does NOT look at cron.job.active: a job somebody disabled by hand
-- reads PASS here and still never runs.
-- ============================================================
SELECT CASE WHEN coalesce((SELECT count(*) = 1 FROM cron.job
                           WHERE jobname = 'publish-due-assignments'
                             AND schedule = '* * * * *'), false)
            THEN 'PASS' ELSE 'FAIL' END AS result,
       'A8 the cron job is registered every minute' AS check_name;


-- ============================================================
-- PART B -- behaviour, live against the simulation group (join code 58MMWL).
-- Run this whole block alone -- BEGIN and ROLLBACK included, see the warning
-- in the file header. Expect 13 lines: B1, B2, B3, B4, B5, B6, B7, B8, B9,
-- B10, B11, B12a, B12b. Thirteen, not the twelve checks in the plan: B12 is
-- split into what can be read off the function body and what can be observed
-- from a real run, because the plan's version of B12 cannot be written in one
-- session at all -- the long comment above B12a says why.
-- A setup guard that trips prints ONE worded "FAIL setup" line instead and
-- nothing else; the three it can print name the group, its archived flag and
-- its members. On a database where docs/assignment-scheduling.sql has NOT been
-- applied the setup instead dies on a raw "column scheduled_for does not
-- exist" and returns no rows at all -- run Part A first; it is the gate that
-- says so in a sentence.
-- Nothing is kept: the transaction rolls back.
--
-- Every actor and every row is resolved or built inside the transaction; no
-- uuid is hard-coded. The checks are stateful and build on each other, so the
-- order below is load-bearing and each step says what it leaves behind.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_log       TEXT := '';
  g           UUID;
  advisor     UUID;
  s1          UUID;   -- an active member: the target of a_sel, and the student
                      -- B3 tries to show a scheduled task to
  v_archived  BOOLEAN;
  v_triplet   UUID;
  v_comp      UUID;
  a_group     UUID;   -- group audience; scheduled with a_sel, published by B5
  a_sel       UUID;   -- selected audience, targets {s1}; same batch as a_group
  a_batch     UUID;   -- stays a draft until B11 tries to schedule it
  a_fail      UUID;   -- the batch that fails at its hour (B9, B10)
  a_lock      UUID;   -- the due row B12b publishes
  n           INT;
  v_bad       INT;
  v_members   INT;
  v_notif     INT;
  v_recip     INT;
  v_before    INT;
  v_after     INT;
  v_cards_grp INT;
  v_cards_sel INT;
  v_failnote  INT;
  v_failnote2 INT;
  v_see       BOOLEAN;
  v_held      BOOLEAN;
  v_pub       TIMESTAMPTZ;
  v_sched     TIMESTAMPTZ;
  v_err       TEXT;
  v_err2      TEXT;
  v_refusal   TEXT;
  v_def       TEXT;
BEGIN
  -- ---- Setup. Deliberately unguarded past the three worded guards below: if
  -- ---- the fixtures cannot be built, no check means anything and the owner
  -- ---- should see the raw error.
  SELECT ig.id, ig.advisor_id, ig.is_archived INTO g, advisor, v_archived
  FROM internship_groups ig WHERE ig.join_code = '58MMWL';

  IF g IS NULL THEN
    PERFORM set_config('probe.results',
      'FAIL setup: no internship_groups row with join_code 58MMWL' || chr(10), true);
    RETURN;
  END IF;

  -- An already-archived group would have every schedule below refused with
  -- GROUP_ARCHIVED, for a reason that has nothing to do with what B1 and B2
  -- assert -- and B9, which archives it on purpose, would prove nothing.
  IF v_archived THEN
    PERFORM set_config('probe.results',
      'FAIL setup: 58MMWL is archived; Part B needs a live group' || chr(10), true);
    RETURN;
  END IF;

  -- An active member with an OPEN internship: submit_assignment refuses a
  -- closed one with INTERNSHIP_CLOSED before it ever reaches the visibility
  -- guard B3 is about, and the simulation really does hold a closed student.
  SELECT m.student_id INTO s1 FROM group_memberships m
  WHERE m.group_id = g AND m.left_at IS NULL AND NOT internship_closed(m.student_id, g)
  ORDER BY m.joined_at, m.student_id LIMIT 1;

  IF s1 IS NULL THEN
    PERFORM set_config('probe.results',
      'FAIL setup: 58MMWL has no active member with an open internship' || chr(10), true);
    RETURN;
  END IF;

  -- publish_due_assignments() is global: it publishes every due row in the
  -- database, not just this group's. A due row somebody else left behind would
  -- be added to the counts B4, B5 and B12b assert exactly, and would turn a
  -- correct run into a FAIL. Park what is already due a century out -- this
  -- runs before any row of ours exists, so it can only touch strangers, and
  -- the ROLLBACK puts them back. (The condition is the job's own query, down
  -- to schedule_error IS NULL: a row the job already skips cannot disturb a
  -- count either.)
  UPDATE group_assignments
     SET scheduled_for = scheduled_for + interval '100 years'
   WHERE published_at IS NULL AND scheduled_for IS NOT NULL AND schedule_error IS NULL;

  -- A triplet, and its competency put inside the group's scope: every draft
  -- below would otherwise be refused by trg_assignment_within_scope on INSERT,
  -- and both schedule_assignments and publish_assignments_internal re-check
  -- the same thing. ON CONFLICT DO NOTHING because the simulation group
  -- already has targets; the row, new or old, disappears with the ROLLBACK
  -- either way.
  SELECT t.id, k.competency_id INTO v_triplet, v_comp
  FROM kpi_triplets t
  JOIN competency_kpis k ON k.id = t.kpi_id
  ORDER BY k.competency_id, t.id
  LIMIT 1;

  INSERT INTO group_competency_targets (group_id, competency_id, target_level)
  VALUES (g, v_comp, 4)
  ON CONFLICT (group_id, competency_id) DO NOTHING;

  -- Five drafts. a_group and a_sel travel together as one scheduled batch;
  -- the other three each exist so that no later check can pass or fail
  -- because of what an earlier one left behind.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE scheduling: group task', t.objective, t.criterion, advisor
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_group;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE scheduling: selected task', t.objective, t.criterion, advisor
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_sel;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE scheduling: draft in a published batch', t.objective, t.criterion, advisor
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_batch;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE scheduling: fails at its hour', t.objective, t.criterion, advisor
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_fail;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE scheduling: the lock case', t.objective, t.criterion, advisor
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_lock;

  -- Everything from here that writes goes through an RPC, and every RPC reads
  -- auth.uid(); without this they all raise NOT_AUTHENTICATED. The 'role' key
  -- is not decoration: auth.uid() reads 'sub' and auth.role() reads 'role',
  -- and a policy or predicate that tests auth.role() sees NULL without it --
  -- which refuses everybody and can make a "cannot see" check pass for the
  -- wrong reason (docs/assignment-targeting-verification.sql Part D lost an
  -- afternoon to exactly that).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', advisor, 'role', 'authenticated')::text, true);

  -- a_sel becomes a selected-audience task with one target. Done through the
  -- one writer, not an INSERT: set_assignment_targets sets the audience and
  -- the rows together, and trg_target_requires_selected refuses a target row
  -- on a 'group' audience anyway.
  n := set_assignment_targets(a_sel, ARRAY[s1]);

  -- ---- B1: a time in the past is refused on the spot ----
  -- At 15:00 nobody is there to read an alert, so schedule_assignments runs
  -- every check publishing runs. This is the one check that is only about
  -- scheduling.
  BEGIN
    n := schedule_assignments(ARRAY[a_group, a_sel], now() - interval '1 hour');
    v_log := v_log || 'FAIL B1: scheduling into the past returned '
                    || coalesce(n::text, '<null>') || ', expected SCHEDULE_IN_PAST' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'SCHEDULE_IN_PAST' THEN
      v_log := v_log || 'PASS B1: scheduling into the past raised SCHEDULE_IN_PAST' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B1: refused with ' || SQLERRM || ', expected SCHEDULE_IN_PAST' || chr(10);
    END IF;
  END;

  -- ---- B2: the third state ----
  -- scheduled_for set with published_at still NULL. A version that wrote a
  -- future published_at instead -- the design's rejected alternative -- fails
  -- here, and would have made the task visible an hour early.
  BEGIN
    n := schedule_assignments(ARRAY[a_group, a_sel], now() + interval '1 hour');
    SELECT count(*)::INT INTO v_bad FROM group_assignments a
    WHERE a.id = ANY(ARRAY[a_group, a_sel])
      AND (a.scheduled_for IS NULL OR a.published_at IS NOT NULL);
    IF n = 2 AND v_bad = 0 THEN
      v_log := v_log || 'PASS B2: both rows scheduled, scheduled_for set and published_at still NULL' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B2: returned ' || coalesce(n::text, '<null>')
                      || ' (expected 2), rows in the wrong state: '
                      || coalesce(v_bad::text, '<null>') || ' (expected 0)' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B2: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B3: a scheduled task is still a draft to every existing rule ----
  -- The predicate, not a SELECT: this session is the table owner and bypasses
  -- RLS, so "SELECT count(*) FROM group_assignments WHERE id = a_group" answers
  -- 1 for every impersonated actor and this check would read FAIL on correct
  -- code. can_see_assignment is exactly what the read policy calls; Part C
  -- proves the policy calls it, on these same two states.
  -- NOT_TARGETED is submit_assignment's last guard and the one
  -- can_see_assignment feeds, so a PASS here means specifically "not visible
  -- yet" -- any earlier refusal (INTERNSHIP_CLOSED, ROLE_NOT_ALLOWED) comes
  -- back as a named FAIL instead of a false reassurance.
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', s1, 'role', 'authenticated')::text, true);
    v_see := can_see_assignment(a_group);
    BEGIN
      -- The reflection and the document are real, not placeholders: a blank or
      -- short reflection raises REFLECTION_REQUIRED / REFLECTION_TOO_SHORT and
      -- no evidence raises EVIDENCE_REQUIRED, all long before the visibility
      -- guard. 2::SMALLINT, not 2 -- integer to smallint is not an implicit
      -- cast in function resolution and a bare 2 fails with "function does not
      -- exist".
      PERFORM submit_assignment(a_group, 'probe',
        'Probe reflection on a task that has only been scheduled, comfortably over twenty characters.',
        '[]'::jsonb,
        '[{"uri":"probe","file_name":"evidence.pdf","file_type":"application/pdf"}]'::jsonb,
        2::SMALLINT);
      v_refusal := '<accepted>';
    EXCEPTION WHEN OTHERS THEN
      v_refusal := SQLERRM;
    END;
    IF NOT v_see AND v_refusal = 'NOT_TARGETED' THEN
      v_log := v_log || 'PASS B3: a member cannot see the scheduled task and submitting to it raised NOT_TARGETED' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B3: can_see_assignment=' || coalesce(v_see::text, '<null>')
                      || ' (expected false), submit refused with '
                      || coalesce(v_refusal, '<null>') || ' (expected NOT_TARGETED)' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B3: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- Back to the advisor for everything below. Outside the block above on
  -- purpose: a raise inside it must not leave the student impersonated.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', advisor, 'role', 'authenticated')::text, true);

  -- ---- B4: the job leaves a future time alone ----
  -- The cheap half of the job's query, and the one a careless `<= now()`
  -- inversion or a missing condition breaks: an hour early is indistinguishable
  -- from no scheduling at all.
  BEGIN
    n := publish_due_assignments();
    SELECT count(*)::INT INTO v_bad FROM group_assignments a
    WHERE a.id = ANY(ARRAY[a_group, a_sel]) AND a.published_at IS NOT NULL;
    IF n = 0 AND v_bad = 0 THEN
      v_log := v_log || 'PASS B4: the job published nothing while the time is in the future' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B4: the job returned ' || coalesce(n::text, '<null>')
                      || ' (expected 0) and published ' || coalesce(v_bad::text, '<null>')
                      || ' of the two scheduled rows (expected 0)' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B4: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B5: the hour arrives ----
  -- Back-dating by hand rather than waiting a minute. now() is the transaction
  -- timestamp, so both rows get the IDENTICAL value -- which is what keeps them
  -- one batch under the job's GROUP BY (group_id, scheduled_for), and that is
  -- the whole premise of B6. scheduled_for must come back NULL: a row that
  -- kept it would read "scheduled" forever in the drafts tray.
  BEGIN
    UPDATE group_assignments SET scheduled_for = now() - interval '1 minute'
     WHERE id = ANY(ARRAY[a_group, a_sel]);

    n := publish_due_assignments();
    SELECT count(*)::INT INTO v_bad FROM group_assignments a
    WHERE a.id = ANY(ARRAY[a_group, a_sel])
      AND (a.published_at IS NULL OR a.scheduled_for IS NOT NULL);
    IF n = 2 AND v_bad = 0 THEN
      v_log := v_log || 'PASS B5: the job published both due rows, published_at set and scheduled_for cleared' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B5: the job returned ' || coalesce(n::text, '<null>')
                      || ' (expected 2), rows in the wrong state: '
                      || coalesce(v_bad::text, '<null>') || ' (expected 0)' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B5: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B6: one notification per recipient, not per assignment ----
  -- Two tasks sent in one batch are ONE event to the student. Publishing row by
  -- row -- which is what the job would do without its GROUP BY -- gives every
  -- student two notifications for one decision, and that is the regression this
  -- row exists for. The body is asserted verbatim because
  -- src/utils/notificationContent.ts matches these exact English templates to
  -- render Turkish; a reworded string silently falls back to English.
  --
  -- created_at >= now(): NOW() is transaction_timestamp(), so every row this
  -- transaction inserts carries exactly it and every row committed before the
  -- transaction began carries less. That is how "new" is measured here, with
  -- nothing deleted from a live table to make room.
  BEGIN
    SELECT count(*)::INT INTO v_members FROM group_memberships m
    WHERE m.group_id = g AND m.left_at IS NULL;

    SELECT count(*)::INT,
           count(DISTINCT n2.user_id)::INT,
           (count(*) FILTER (WHERE n2.body <> '2 new tasks have been assigned.'))::INT
      INTO v_notif, v_recip, v_bad
    FROM notifications n2
    WHERE n2.type = 'task_assigned'
      AND n2.created_at >= now()
      AND n2.user_id IN (SELECT m.student_id FROM group_memberships m
                         WHERE m.group_id = g AND m.left_at IS NULL);

    IF v_notif = v_members AND v_recip = v_members AND v_bad = 0 THEN
      v_log := v_log || 'PASS B6: ' || v_members || ' active members, '
                      || v_notif || ' task_assigned rows, one each, body "2 new tasks have been assigned."' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B6: ' || coalesce(v_members::text, '<null>')
                      || ' active members but ' || coalesce(v_notif::text, '<null>')
                      || ' task_assigned rows across ' || coalesce(v_recip::text, '<null>')
                      || ' recipients, ' || coalesce(v_bad::text, '<null>')
                      || ' of them not the plural template' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B6: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B7: the second call notifies nobody ----
  -- The cron job and a "Send now" tap can reach the same row in the same
  -- second, so this is a real race and not a hypothetical. The count is taken
  -- across the WHOLE notifications table before and after, not just the return
  -- value: a body that re-ran its INSERT over p_ids while correctly returning 0
  -- would pass a return-value-only check and still notify every student twice.
  BEGIN
    SELECT count(*)::INT INTO v_before FROM notifications n2
    WHERE n2.type = 'task_assigned' AND n2.created_at >= now();

    n := publish_assignments_internal(ARRAY[a_group, a_sel]);

    SELECT count(*)::INT INTO v_after FROM notifications n2
    WHERE n2.type = 'task_assigned' AND n2.created_at >= now();

    IF n = 0 AND v_after = v_before THEN
      v_log := v_log || 'PASS B7: publishing the same ids again returned 0 and added no notification row' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B7: returned ' || coalesce(n::text, '<null>')
                      || ' (expected 0), notification rows went from '
                      || coalesce(v_before::text, '<null>') || ' to '
                      || coalesce(v_after::text, '<null>') || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B7: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B8: the stream card, from the timer's side ----
  -- The card comes from trg_feed_assignment_post, an AFTER UPDATE OF
  -- published_at trigger with a WHEN clause the targeting file added. A publish
  -- that reached published_at any other way -- a timer that inserted a new row,
  -- or one that set the column in a way the trigger does not see -- gives a
  -- group task no card at all. The selected half is the privacy half: a card
  -- announces to the whole group exactly what targeting exists to avoid.
  BEGIN
    SELECT count(*)::INT INTO v_cards_grp FROM feed_posts fp WHERE fp.assignment_id = a_group;
    SELECT count(*)::INT INTO v_cards_sel FROM feed_posts fp WHERE fp.assignment_id = a_sel;
    IF v_cards_grp = 1 AND v_cards_sel = 0 THEN
      v_log := v_log || 'PASS B8: the group task got one stream card, the selected task got none' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B8: group task cards=' || coalesce(v_cards_grp::text, '<null>')
                      || ' (expected 1), selected task cards=' || coalesce(v_cards_sel::text, '<null>')
                      || ' (expected 0)' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B8: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B9: a batch that fails at its hour tells the advisor ----
  -- The group is archived between the scheduling and the hour -- the advisor has
  -- wound the internship up, and publishing into it would put a task in front
  -- of students who are done. Note what this does to live data: archiving fires
  -- trg_dm_group_archived, which deletes the group's conversations. The
  -- ROLLBACK is what restores them (file header, warning 1).
  --
  -- scheduled_for is written by hand rather than through schedule_assignments,
  -- because that function refuses a past time AND an archived group -- by
  -- design, so the advisor hears it on screen. A direct UPDATE is the only way
  -- to reach the state a real group archived AFTER scheduling is in, which is
  -- precisely the state the job's failure handler exists for.
  --
  -- Without that notification the task would simply never arrive and nobody
  -- would know: the failure the owners would notice last and mind most.
  BEGIN
    UPDATE internship_groups SET is_archived = true WHERE id = g;
    UPDATE group_assignments SET scheduled_for = now() - interval '1 minute' WHERE id = a_fail;

    n := publish_due_assignments();

    SELECT a.published_at, a.schedule_error INTO v_pub, v_err
    FROM group_assignments a WHERE a.id = a_fail;

    SELECT count(*)::INT INTO v_failnote FROM notifications n2
    WHERE n2.type = 'schedule_failed' AND n2.user_id = advisor AND n2.created_at >= now();

    IF n = 0 AND v_pub IS NULL AND v_err LIKE '%GROUP_ARCHIVED%' AND v_failnote = 1 THEN
      v_log := v_log || 'PASS B9: the archived group published nothing, the row carries GROUP_ARCHIVED and the advisor was notified once' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B9: the job returned ' || coalesce(n::text, '<null>')
                      || ' (expected 0), published_at=' || coalesce(v_pub::text, '<null>')
                      || ' (expected NULL), schedule_error=' || coalesce(v_err, '<null>')
                      || ' (expected GROUP_ARCHIVED), advisor schedule_failed rows='
                      || coalesce(v_failnote::text, '<null>') || ' (expected 1)' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B9: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B10: a permanent failure is reported once, not every minute ----
  -- The job runs 1,440 times a day. Without schedule_error IS NULL in its
  -- query, a group archived on Friday afternoon hands the advisor a thousand
  -- identical notifications by Saturday morning. v_err2 is compared to what B9
  -- read AND required non-NULL, so a run that cleared the error instead of
  -- keeping it cannot pass here.
  BEGIN
    n := publish_due_assignments();

    SELECT a.schedule_error INTO v_err2 FROM group_assignments a WHERE a.id = a_fail;

    SELECT count(*)::INT INTO v_failnote2 FROM notifications n2
    WHERE n2.type = 'schedule_failed' AND n2.user_id = advisor AND n2.created_at >= now();

    IF n = 0 AND v_err2 IS NOT NULL AND v_err2 IS NOT DISTINCT FROM v_err
       AND v_failnote2 = v_failnote THEN
      v_log := v_log || 'PASS B10: the next run skipped the failed row, kept its error and wrote no second notification' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B10: the job returned ' || coalesce(n::text, '<null>')
                      || ' (expected 0), schedule_error now ' || coalesce(v_err2, '<null>')
                      || ' (was ' || coalesce(v_err, '<null>')
                      || '), advisor schedule_failed rows ' || coalesce(v_failnote2::text, '<null>')
                      || ' (was ' || coalesce(v_failnote::text, '<null>') || ')' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B10: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- Live group again. B11 and B12b are about scheduling and the lock; left
  -- archived, B12b's publish would be refused with GROUP_ARCHIVED for a reason
  -- that has nothing to do with the lock. The ROLLBACK is still what restores
  -- the conversations B9's archive deleted -- this only restores the flag.
  UPDATE internship_groups SET is_archived = false WHERE id = g;

  -- ---- B11: one published row refuses the whole batch ----
  -- A sent task cannot be un-sent by scheduling it again, and the refusal is
  -- all-or-nothing rather than "schedule the rest", the same shape publishing
  -- already has. The load-bearing half of this check is the refusal CODE: the
  -- surviving "still unscheduled" assertion is weaker than it looks, because
  -- this sub-block is a savepoint and would roll a partial UPDATE back anyway.
  -- What it does catch is the version that refuses nothing: then the FAIL
  -- branch below fires with the row count it scheduled.
  BEGIN
    n := schedule_assignments(ARRAY[a_group, a_batch], now() + interval '1 hour');
    v_log := v_log || 'FAIL B11: a batch holding a published task scheduled '
                    || coalesce(n::text, '<null>') || ' row(s), expected ALREADY_PUBLISHED' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ALREADY_PUBLISHED' THEN
      SELECT a.scheduled_for INTO v_sched FROM group_assignments a WHERE a.id = a_batch;
      IF v_sched IS NULL THEN
        v_log := v_log || 'PASS B11: the batch raised ALREADY_PUBLISHED and the draft in it is still unscheduled' || chr(10);
      ELSE
        v_log := v_log || 'FAIL B11: raised ALREADY_PUBLISHED but the draft came back scheduled for '
                        || v_sched::text || chr(10);
      END IF;
    ELSE
      v_log := v_log || 'FAIL B11: refused with ' || SQLERRM || ', expected ALREADY_PUBLISHED' || chr(10);
    END IF;
  END;

  -- ---- B12a: the overlapping-runs guard, read off the body ----
  -- THE PLAN ASKED FOR SOMETHING THAT CANNOT BE WRITTEN HERE. It asked this
  -- session to take pg_advisory_lock(hashtext('publish_due_assignments')) and
  -- then call publish_due_assignments(), expecting 0. Postgres advisory locks
  -- are re-entrant WITHIN a session: "if a session already holds a given
  -- advisory lock, additional requests by it will always succeed". The
  -- function's pg_try_advisory_lock would therefore return TRUE on the very
  -- same key, publish the due row, and the check would report FAIL on
  -- perfectly correct code. The refusal can only be observed from a SECOND
  -- backend, which is what pg_cron actually provides -- every run is its own
  -- session -- and which a pasted script has no way to open.
  --
  -- So the claim is split in two. B12a reads the guard off the function body:
  -- the key must be taken with pg_try_advisory_lock and released with
  -- pg_advisory_unlock under the SAME hashtext(...) literal. A mismatch
  -- between the two keys is the subtle version of this bug -- the lock is
  -- taken and never released, and the first overrunning minute strands it for
  -- the life of that backend. B12b then proves, from a real run, that the
  -- function leaves no lock behind.
  BEGIN
    v_def := pg_get_functiondef(to_regprocedure('public.publish_due_assignments()')::oid);
    IF v_def LIKE '%pg_try_advisory_lock(hashtext(''publish_due_assignments''))%'
       AND v_def LIKE '%pg_advisory_unlock(hashtext(''publish_due_assignments''))%' THEN
      v_log := v_log || 'PASS B12a: the body takes and releases the same advisory key, hashtext(''publish_due_assignments'')' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B12a: the body does not take AND release pg_advisory_lock on hashtext(''publish_due_assignments'')'
                      || ' -- two runs of the job could meet on the same due rows, or one run could strand the lock' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B12a: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B12b: a real run leaves no lock behind, and publishes ----
  -- pg_advisory_unlock returns true if THIS session held the key and released
  -- it, false if it held nothing. So after a run that took and released the
  -- lock as it should, the probe below must come back false. It coming back
  -- true is the leak: a session-level lock survives a ROLLBACK, so a leaked one
  -- is held for the life of the backend, and in production that is the pg_cron
  -- worker going quiet forever.
  --
  -- The drain first, because of that same survival: an earlier paste of this
  -- part that died mid-flight can leave the key held in this very session, and
  -- the probe at the end would then read a leak that is not there. Draining in
  -- a loop because a session counts its ACQUISITIONS of a key, not whether it
  -- holds one: two takes need two unlocks. (The unlock that finally finds
  -- nothing emits a WARNING the editor does not show.) The handler drains
  -- again, so a check that raises cannot be the thing that strands the lock.
  BEGIN
    WHILE pg_advisory_unlock(hashtext('publish_due_assignments')) LOOP
      NULL;
    END LOOP;

    UPDATE group_assignments SET scheduled_for = now() - interval '1 minute' WHERE id = a_lock;

    n := publish_due_assignments();
    SELECT a.published_at INTO v_pub FROM group_assignments a WHERE a.id = a_lock;
    v_held := pg_advisory_unlock(hashtext('publish_due_assignments'));

    IF n = 1 AND v_pub IS NOT NULL AND NOT v_held THEN
      v_log := v_log || 'PASS B12b: the run published the one due row and released the advisory lock it took' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B12b: the job returned ' || coalesce(n::text, '<null>')
                      || ' (expected 1), published_at=' || coalesce(v_pub::text, '<null>')
                      || ' (expected a timestamp), lock still held afterwards='
                      || coalesce(v_held::text, '<null>') || ' (expected false)' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    WHILE pg_advisory_unlock(hashtext('publish_due_assignments')) LOOP
      NULL;
    END LOOP;
    v_log := v_log || 'FAIL B12b: unexpected error: ' || SQLERRM || chr(10);
  END;

  PERFORM set_config('probe.results', v_log, true);
END $$;

SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';

ROLLBACK;


-- ============================================================
-- PART C -- policies. Run this whole block alone. Expect 3 rows, all PASS.
-- A setup guard that trips prints ONE worded "FAIL setup" line instead.
-- An owner-run script proves a policy and a REVOKE exist; SET LOCAL ROLE
-- authenticated is what makes them evaluate. This is the only part of the file
-- where the read policy itself, rather than the predicate behind it, decides
-- whether a scheduled task is visible -- and the only place the two internal
-- functions' REVOKEs are tested rather than read out of a catalogue.
-- ============================================================

BEGIN;

-- The fixture is built here, as the owner, BEFORE the role switch: under role
-- authenticated there is no write path to group_assignments for a student at
-- all, and the point is to test reading, not writing.
DO $$
DECLARE
  g         UUID;
  advisor   UUID;
  s_member  UUID;
  v_triplet UUID;
  v_comp    UUID;
  a_sched   UUID;
  a_pub     UUID;
BEGIN
  SELECT ig.id, ig.advisor_id INTO g, advisor
  FROM internship_groups ig WHERE ig.join_code = '58MMWL';

  SELECT m.student_id INTO s_member FROM group_memberships m
  WHERE m.group_id = g AND m.left_at IS NULL
  ORDER BY m.joined_at, m.student_id LIMIT 1;

  -- Worded, not raw: without this the fixture below dies on a NOT NULL
  -- violation and the owner reads a constraint name instead of a sentence.
  -- Part B says the same thing first, but Part C is pasted on its own.
  IF g IS NULL OR s_member IS NULL THEN
    PERFORM set_config('probe.results',
      'FAIL setup: Part C needs group 58MMWL with at least one active member' || chr(10), true);
    PERFORM set_config('probe.scheduled', '', true);
    RETURN;
  END IF;

  SELECT t.id, k.competency_id INTO v_triplet, v_comp
  FROM kpi_triplets t
  JOIN competency_kpis k ON k.id = t.kpi_id
  ORDER BY k.competency_id, t.id
  LIMIT 1;

  INSERT INTO group_competency_targets (group_id, competency_id, target_level)
  VALUES (g, v_comp, 4)
  ON CONFLICT (group_id, competency_id) DO NOTHING;

  -- The row under test: scheduled, which is scheduled_for set with published_at
  -- still NULL.
  INSERT INTO group_assignments
    (group_id, triplet_id, title, objective, criterion, created_by, scheduled_for)
  SELECT g, t.id, 'PROBE scheduling: Part C scheduled', t.objective, t.criterion,
         advisor, now() + interval '1 hour'
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_sched;

  -- The control row, and C1 is worthless without it. "The student reads 0
  -- rows" is also exactly what EVERY actor reads when the claims object is
  -- malformed: an absent or wrong 'role' key makes auth.role() NULL, the
  -- policy's USING clause NULL, and every row invisible -- so a broken probe
  -- would PASS. A published task the same student must still read, in the same
  -- impersonation, is what separates "the state hides it" from "nothing works".
  -- published_at is written in the INSERT, which keeps trg_feed_assignment_post
  -- -- an AFTER UPDATE trigger -- out of this entirely.
  INSERT INTO group_assignments
    (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT g, t.id, 'PROBE scheduling: Part C published control', t.objective, t.criterion,
         advisor, now()
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_pub;

  PERFORM set_config('probe.scheduled', a_sched::text, true);
  PERFORM set_config('probe.published', a_pub::text, true);
  PERFORM set_config('probe.member', s_member::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  a_sched  UUID;
  a_pub    UUID;
  v_sched  INT;
  v_pub    INT;
  v_log    TEXT := '';
BEGIN
  -- The fixture above sets probe.scheduled to '' when it could not build
  -- itself, having already written its reason into probe.results. Reading it
  -- in DECLARE would raise on the cast, so the guard comes first.
  IF coalesce(current_setting('probe.scheduled', true), '') = '' THEN
    PERFORM set_config('probe.results',
      coalesce(current_setting('probe.results', true),
               'FAIL setup: the Part C fixture did not run -- paste the whole part' || chr(10)), true);
    RETURN;
  END IF;

  a_sched := current_setting('probe.scheduled')::uuid;
  a_pub   := current_setting('probe.published')::uuid;

  -- ---- C1: a scheduled task is invisible through the policy itself ----
  -- Read the two counts as ONE claim, never the first alone: 0 and 1 together
  -- mean the state is what hides the row. 0 and 0 mean the impersonation or
  -- the fixture is broken and this check proves nothing.
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', current_setting('probe.member'), 'role', 'authenticated')::text, true);
    SELECT count(*)::INT INTO v_sched FROM group_assignments WHERE id = a_sched;
    SELECT count(*)::INT INTO v_pub   FROM group_assignments WHERE id = a_pub;
    IF v_sched = 0 AND v_pub = 1 THEN
      v_log := v_log || 'PASS C1: the member reads the published control row and not the scheduled one' || chr(10);
    ELSE
      v_log := v_log || 'FAIL C1: the member read ' || coalesce(v_sched::text, '<null>')
                      || ' scheduled row(s) (expected 0) and ' || coalesce(v_pub::text, '<null>')
                      || ' published row(s) (expected 1 -- 0 here means the impersonation, not the policy)' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL C1: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- C2: authenticated cannot call publish_assignments_internal ----
  -- The function with no identity check of its own. If this row goes red, any
  -- logged-in student can publish any draft in any group -- including one
  -- scheduled for next week -- by naming its id. Matched on SQLSTATE, not on
  -- message text: "permission denied for function" is 42501 whatever the
  -- wording.
  BEGIN
    PERFORM publish_assignments_internal(ARRAY[a_sched]);
    v_log := v_log || 'FAIL C2: authenticated called publish_assignments_internal' || chr(10);
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_log := v_log || 'PASS C2: authenticated calling publish_assignments_internal was refused with 42501' || chr(10);
    WHEN OTHERS THEN
      v_log := v_log || 'FAIL C2: refused with SQLSTATE ' || SQLSTATE || ' (' || SQLERRM
                      || '), expected 42501' || chr(10);
  END;

  -- ---- C3: authenticated cannot call publish_due_assignments ----
  -- Nobody outside the database has any business running the job by hand: it
  -- publishes due rows in EVERY group, for every advisor on the platform.
  BEGIN
    PERFORM publish_due_assignments();
    v_log := v_log || 'FAIL C3: authenticated called publish_due_assignments' || chr(10);
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_log := v_log || 'PASS C3: authenticated calling publish_due_assignments was refused with 42501' || chr(10);
    WHEN OTHERS THEN
      v_log := v_log || 'FAIL C3: refused with SQLSTATE ' || SQLSTATE || ' (' || SQLERRM
                      || '), expected 42501' || chr(10);
  END;

  PERFORM set_config('probe.results', v_log, true);
END $$;

-- Back to the owner before anything reads the results, so a failure in the
-- SELECT below cannot be blamed on the role change (house pattern, see
-- docs/task-assignment-verification.sql Part C).
RESET ROLE;

SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';

ROLLBACK;
