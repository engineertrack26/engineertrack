-- NOTE 2026-09-16: submit_assignment, review_assignment now live in
-- docs/internship-closure-guards.sql, and as of 2026-09-24 in
-- docs/review-by-advisor.sql on top of that (review_assignment now belongs
-- to the group's ADVISOR, not the mentor). RE-RUNNING THIS FILE REMOVES THE
-- CLOSURE GUARD AND THE ADVISOR GATE from them -- re-apply
-- docs/internship-closure-guards.sql, then docs/review-by-advisor.sql,
-- afterwards.
-- docs/self-assessment-migration.sql
-- Self-assessment and mentor comparison: the student rates their own work on
-- submit, the mentor rates it on approval, on the same four-step supervision
-- scale the internship journal already uses (0 observed .. 3 independent).
-- Neither rating gates progression -- approval still creates the KPI
-- observation exactly as before this file.
--
-- Run AFTER docs/daily-log-retirement-rpcs.sql and docs/task-assignment-rpcs.sql
-- (both of which defined the functions this file redefines with a rating
-- parameter -- see the NOTE at the top of each). Idempotent; safe to re-run.
-- Apply order: this file, then docs/self-assessment-verification.sql.
-- Anonymous dollar-quoting only in the Supabase SQL editor.
--
-- Every column reference below is alias-qualified, for the same reason the
-- two files above give: RETURNS TABLE (level INT, …) would shadow an
-- unqualified `level`, and that bug only shows up on the success path.

-- ---- columns ----
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS self_level SMALLINT;
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS mentor_level SMALLINT;
ALTER TABLE assignment_submissions DROP CONSTRAINT IF EXISTS assignment_submissions_self_level_range;
ALTER TABLE assignment_submissions ADD CONSTRAINT assignment_submissions_self_level_range CHECK (self_level IS NULL OR self_level BETWEEN 0 AND 3);
ALTER TABLE assignment_submissions DROP CONSTRAINT IF EXISTS assignment_submissions_mentor_level_range;
ALTER TABLE assignment_submissions ADD CONSTRAINT assignment_submissions_mentor_level_range CHECK (mentor_level IS NULL OR mentor_level BETWEEN 0 AND 3);

-- ============================================
-- submit_assignment: gains the student's own rating (spec decision 1,
-- required). The old five-argument signature MUST be dropped, not merely
-- replaced -- CREATE OR REPLACE with a different argument list creates an
-- OVERLOAD, and PostgREST resolves overloads by the argument names a caller
-- sends, so a client still sending the old five would silently keep hitting
-- the old body forever. That is an intermittent wrong-behaviour bug, not an
-- error at deploy time -- see docs/daily-log-retirement-rpcs.sql's own note
-- on the three-argument signature it replaced, for the same reason.
-- ============================================
CREATE OR REPLACE FUNCTION submit_assignment(
  p_assignment_id UUID,
  p_note          TEXT  DEFAULT NULL,
  p_reflection    TEXT  DEFAULT NULL,
  p_photos        JSONB DEFAULT '[]'::jsonb,
  p_documents     JSONB DEFAULT '[]'::jsonb,
  p_self_level    SMALLINT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_group     UUID;
  submission       UUID;
  assignment_title TEXT;
  the_mentor       UUID;
  student_name     TEXT;
  v_photos         INTEGER;
  v_week           DATE;
  v_prev_week      DATE;
  v_streak         INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- Refuse before any write. A blank reflection is the one new precondition
  -- this signature adds, and it is checked here so the student gets a named
  -- refusal instead of a half-written submission.
  IF btrim(coalesce(p_reflection, '')) = '' THEN
    RAISE EXCEPTION 'REFLECTION_REQUIRED';
  END IF;

  -- The student's own rating on the supervision scale (spec decision 1). Required.
  IF p_self_level IS NULL OR p_self_level NOT BETWEEN 0 AND 3 THEN
    RAISE EXCEPTION 'SELF_LEVEL_REQUIRED';
  END IF;

  SELECT a.group_id, a.title INTO target_group, assignment_title
  FROM group_assignments a WHERE a.id = p_assignment_id;

  IF target_group IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND';
  END IF;

  -- Only an active member of the assignment's group may submit to it.
  IF NOT is_member_of_group(target_group) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  -- An approved submission is a finished record. The observation it produced is
  -- counting toward a competency level and carries the mentor's name.
  --
  -- Without this guard the DO UPDATE below would reset the row to 'submitted'
  -- and clear reviewed_by while leaving that observation in place — the one
  -- state this design says cannot exist: evidence backed by a submission nobody
  -- approved. review_assignment handles the mentor withdrawing an approval and
  -- deletes the observation in the same statement; nothing handled the student
  -- reopening it from this side, because the rule is written over there and the
  -- hole was here.
  --
  -- Reopening stays the mentor's call: review_assignment(id, false, note) moves
  -- the row to needs_revision and retracts the observation, and the student can
  -- resubmit from there. That path is exercised by Part B case 3b of
  -- docs/task-assignment-verification.sql, which resubmits the row case 3 sent
  -- back and asserts it returns a non-null id in status 'submitted'.
  --
  -- This standalone EXISTS is kept for the common case: a student tapping
  -- Submit on an already-approved task gets a clean ALREADY_APPROVED without
  -- depending on the race path below. It is NOT the whole guard, because it
  -- cannot be: under READ COMMITTED this SELECT and the INSERT below see
  -- different row versions.
  IF EXISTS (
    SELECT 1 FROM assignment_submissions s
    WHERE s.assignment_id = p_assignment_id
      AND s.student_id = auth.uid()
      AND s.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'ALREADY_APPROVED';
  END IF;

  -- The WHERE on the DO UPDATE is what makes the guard atomic with the write it
  -- protects. Without it: the student's EXISTS above passes while the row is
  -- still 'submitted', the mentor's approval commits, and this statement then
  -- re-reads the freshly committed row and resets it to 'submitted' with
  -- reviewed_by cleared -- while the observation that approval wrote survives.
  -- Evidence standing behind a submission nobody approved is exactly the state
  -- the guard exists to prevent. ON CONFLICT DO UPDATE re-reads the conflicting
  -- row under a lock and evaluates this WHERE against that fresh version, so
  -- the two are one statement and there is no window between them.
  --
  -- 'needs_revision' and 'submitted' both pass the WHERE, which is the point:
  -- a resubmission after a revision request must still go through.
  INSERT INTO assignment_submissions
    (assignment_id, student_id, status, student_note, reflection, self_level, submitted_at)
  VALUES (p_assignment_id, auth.uid(), 'submitted', p_note, p_reflection, p_self_level, now())
  ON CONFLICT (assignment_id, student_id) DO UPDATE
    SET status = 'submitted',
        student_note = EXCLUDED.student_note,
        reflection = EXCLUDED.reflection,
        self_level = EXCLUDED.self_level,
        mentor_level = NULL,
        submitted_at = now(),
        reviewed_at = NULL,
        reviewed_by = NULL
    WHERE assignment_submissions.status <> 'approved'
  RETURNING id INTO submission;

  -- When that WHERE excludes the row, the statement updates nothing, RETURNING
  -- yields no row, and `submission` is left NULL -- which returned as-is would
  -- report the race as a SUCCESS to a client that then has no submission id.
  -- id is the primary key and NOT NULL, and both the plain-insert path and the
  -- accepted-update path return it, so NULL here means one thing only: the row
  -- was already 'approved'. Raise the same code the sequential path raises, so
  -- the client cannot tell the race apart from the ordinary refusal.
  IF submission IS NULL THEN
    RAISE EXCEPTION 'ALREADY_APPROVED';
  END IF;

  -- Evidence, written here rather than by the client.
  --
  -- assignment_submissions has no draft state -- this function inserts
  -- straight to 'submitted' -- so there is no row for a client to attach
  -- photos to beforehand, and attaching them afterwards would leave a window
  -- where the mentor sees an evidence-less submission. The files are already
  -- in the bucket by the time this runs; only the rows are written here.
  --
  -- Delete-then-rewrite, not append: the client sends the full list, so a
  -- student who removes a photo and resubmits must end up without it. The
  -- pattern is the one record_kpi_observations uses.
  --
  -- jsonb_to_recordset matches keys to column names case-sensitively, so the
  -- JSON the client sends must use file_name, file_type, file_size --
  -- snake_case, not the camelCase the TypeScript layer uses elsewhere. D2's
  -- service (src/services/assignments.ts) is responsible for that mapping;
  -- this comment is here so the two halves cannot drift apart unnoticed.
  --
  -- log_documents.file_name and file_type are NOT NULL at the table level
  -- (docs/database-schema.sql). A client that drifts back to camelCase -- or
  -- sends any other malformed element -- would leave those columns NULL and
  -- raise 23502 AFTER the submission row and the photos above are already
  -- written, so the student would simply be unable to submit. The WHERE below
  -- filters uri, file_name and file_type the same way the photo INSERT
  -- filters uri: a malformed document row is silently dropped, not allowed to
  -- abort a submission that otherwise succeeded. file_size keeps the coalesce
  -- rather than joining the filter, since 0 is a valid size for evidence whose
  -- byte count could not be determined client-side.
  DELETE FROM log_photos    WHERE submission_id = submission;
  DELETE FROM log_documents WHERE submission_id = submission;

  INSERT INTO log_photos (submission_id, uri, caption)
  SELECT submission, e.uri, e.caption
  FROM jsonb_to_recordset(coalesce(p_photos, '[]'::jsonb))
       AS e(uri TEXT, caption TEXT)
  WHERE e.uri IS NOT NULL;

  INSERT INTO log_documents (submission_id, uri, file_name, file_type, file_size)
  SELECT submission, e.uri, e.file_name, e.file_type, coalesce(e.file_size, 0)
  FROM jsonb_to_recordset(coalesce(p_documents, '[]'::jsonb))
       AS e(uri TEXT, file_name TEXT, file_type TEXT, file_size INTEGER)
  WHERE e.uri IS NOT NULL AND e.file_name IS NOT NULL AND e.file_type IS NOT NULL;

  -- Gamification, first submission only.
  --
  -- All of it lives here rather than in a trigger, and that is not a style
  -- choice. A trigger on assignment_submissions fires when the submission row
  -- is written, which is BEFORE the evidence block above -- a photo count read
  -- from a trigger is always zero. Approval XP stays in the
  -- award_assignment_xp trigger, where no such ordering exists.
  --
  -- Doing it here is safe because this function is the only way a submission
  -- row can exist: assignment_submissions has no write policy at all, so RLS
  -- forbids direct inserts and only SECURITY DEFINER can write.
  --
  -- The guard is the submission id inside `reason`. That id is stable across
  -- resubmissions because the statement above upserts, so a resubmit cannot
  -- earn submit XP, the photo bonus or a streak step a second time. It is also
  -- what stops a student resubmitting an old task in a quiet week to keep a
  -- streak alive without doing new work.
  IF NOT EXISTS (
    SELECT 1 FROM xp_transactions x
    WHERE x.student_id = auth.uid()
      AND x.reason = 'assignment_submitted:' || submission::text
  ) THEN
    PERFORM award_xp_internal(auth.uid(), 10,
      'assignment_submitted:' || submission::text, NULL);

    -- Mirrors POINT_VALUES.photoAttached (3) and the daily log's cap of 5.
    SELECT count(*) INTO v_photos FROM log_photos WHERE submission_id = submission;
    IF v_photos > 0 THEN
      PERFORM award_xp_internal(auth.uid(), 3 * LEAST(v_photos, 5),
        'assignment_photo:' || submission::text, NULL);
    END IF;

    PERFORM award_badge_internal(auth.uid(), 'first_task');

    -- Weekly streak: consecutive ISO weeks containing at least one submission.
    -- date_trunc('week', ...) returns the Monday, so `- 7` is the week before.
    v_week := date_trunc('week', now())::date;

    SELECT MAX(date_trunc('week', s.submitted_at)::date) INTO v_prev_week
    FROM assignment_submissions s
    WHERE s.student_id = auth.uid() AND s.id <> submission;

    -- IS DISTINCT FROM, not <>: a first-ever submission has a NULL prev_week,
    -- and `NULL <> v_week` is NULL, which would skip the whole block and leave
    -- the streak at 0 forever.
    IF v_prev_week IS DISTINCT FROM v_week THEN
      IF v_prev_week = v_week - 7 THEN
        SELECT current_streak + 1 INTO v_streak
        FROM student_profiles WHERE id = auth.uid();
      ELSE
        v_streak := 1;
      END IF;

      UPDATE student_profiles
      SET current_streak = v_streak,
          longest_streak = GREATEST(longest_streak, v_streak)
      WHERE id = auth.uid();

      -- 4 and 8 weeks, down from 7 and 30 days. The badge ids are kept so
      -- rows students already hold are not orphaned; only the copy in
      -- en.json changes.
      IF v_streak >= 8 THEN
        PERFORM award_badge_internal(auth.uid(), 'streak_30');
      ELSIF v_streak >= 4 THEN
        PERFORM award_badge_internal(auth.uid(), 'streak_7');
      END IF;
    END IF;
  END IF;

  -- Tell the mentor, from here rather than from the client.
  --
  -- app/(student)/my-tasks.tsx used to insert this notification itself. It
  -- could not: the only INSERT policy on notifications is
  --   auth.uid() = user_id OR is_mentor_of(user_id) OR is_advisor_of(user_id)
  -- and a student writing to their mentor fails all three -- they are not the
  -- recipient, and both helpers look for a student_profiles row keyed by the
  -- MENTOR's id, which does not exist. Every call raised 42501 into a .catch,
  -- so the student saw "Task submitted." and the mentor was never told. This is
  -- the app's only student->mentor notification; the other six directions are
  -- advisor->student or mentor->student, which the policy admits.
  --
  -- This function is already SECURITY DEFINER, so it runs as the table owner
  -- and bypasses that policy -- the same move report_join_issue makes in
  -- docs/join-hardening-migration.sql to notify an institution admin.
  --
  -- The strings are plain English on purpose: the database has no access to
  -- i18n, and every other server-written notification in this project
  -- (award_xp_internal, award_badge_internal, report_join_issue) is English
  -- too. They carry the wording the deleted client-side block used to build
  -- from notifications.taskSubmittedTitle/Body; those two keys are gone from
  -- en.json with the only code that ever read them.
  -- A failed notification must never roll back a submission that succeeded.
  -- All six client-side notify sites carry a .catch for exactly that reason,
  -- and moving THIS one into the function is what dropped the protection: an
  -- unhandled error in here aborts submit_assignment and takes the student's
  -- submission with it. An exception block in plpgsql is a subtransaction, so
  -- this restores the same rule server-side -- the notification rolls back on
  -- failure, the submission does not.
  --
  -- EVERY statement that composes the notification is inside the block,
  -- including the two lookups. The mentor lookup used to sit above it, and it
  -- had the same exposure as the rest: it picks the recipient, so it composes
  -- the notification, and student_profiles is a table dependency this change
  -- newly introduced into submit_assignment -- before it, this function never
  -- touched that table. A bare SELECT ... INTO returns NULL rather than raising
  -- when it finds no row, so the realistic probability is very low, but that is
  -- the same "will not fail, not cannot fail" reasoning this block already
  -- rejects for the INSERT, and it does not get an exception here.
  --
  -- Both known failure paths are closed today (notifications has no FORCE ROW
  -- LEVEL SECURITY, so the definer bypasses RLS; student_profiles.mentor_id and
  -- notifications.user_id both reference profiles(id) with the default NO
  -- ACTION, so mentor_id cannot dangle). That is an argument this will not
  -- fail, not that it cannot: notifications is a table someone will add a
  -- constraint or a trigger to eventually, and the symptom would be students
  -- unable to submit, with the cause three files away.
  --
  -- WHEN OTHERS is deliberately broad, but NOT silent. This is the .catch, not
  -- a place to decide which failures matter -- the submission has already been
  -- written and returning it is the contract -- but it leaves a trace on the
  -- way past. See the handler.
  BEGIN
    SELECT sp.mentor_id INTO the_mentor
    FROM student_profiles sp WHERE sp.id = auth.uid();

    -- A student whose mentor is not linked yet is a normal state, not a
    -- failure, and it stays a plain condition: the NULL case leaves this block
    -- through the ordinary path, never through the handler below. Moving the
    -- lookup inside the block does not change that -- only genuine errors
    -- reach the EXCEPTION arm.
    IF the_mentor IS NOT NULL THEN
      SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
      INTO student_name FROM profiles p WHERE p.id = auth.uid();

      INSERT INTO notifications (user_id, title, body, type, data)
      VALUES (
        the_mentor,
        'Task Submitted',
        coalesce(nullif(student_name, ''), 'A student')
          || ' submitted "' || coalesce(assignment_title, 'a task') || '" for review.',
        'task_submitted',
        jsonb_build_object('assignmentId', p_assignment_id)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Silent would repeat the mistake this whole change exists to fix: the
    -- client-side version of this notification failed with 42501 on every
    -- submission from the day it shipped, and a deliberate catch is why nobody
    -- knew. The transaction is still protected -- a WARNING aborts neither the
    -- subtransaction nor the outer one -- but the failure leaves a trace in the
    -- server log, which is where someone asking "why do mentors never hear
    -- about submissions" would look, and where a Supabase project's logs
    -- already collect.
    RAISE WARNING 'submit_assignment: mentor notification failed: %', SQLERRM;
  END;

  RETURN submission;
END;
$$;

DROP FUNCTION IF EXISTS submit_assignment(UUID, TEXT, TEXT, JSONB, JSONB);
GRANT EXECUTE ON FUNCTION submit_assignment(UUID, TEXT, TEXT, JSONB, JSONB, SMALLINT) TO authenticated;

-- Resubmitting after a revision request clears reviewed_at and reviewed_by, so
-- the mentor's queue shows it as waiting again.

-- log_id stays on assignment_submissions and stops being written here. It is
-- not dropped: docs/database-schema.sql and the archive screens still
-- reference it, and a dropped column is not idempotent to re-add.

-- ============================================
-- review_assignment: gains the mentor's own rating (spec decision 2), stored
-- only on approval and cleared on a revision request -- the approval it
-- belonged to is gone. It never gates the observation below (spec decision
-- 3: a v1 choice, not a schema limit). The old three-argument signature MUST
-- be dropped for the same overload-resolution reason as submit_assignment
-- above.
-- ============================================
CREATE OR REPLACE FUNCTION review_assignment(
  p_submission_id UUID,
  p_approved      BOOLEAN,
  p_note          TEXT DEFAULT NULL,
  p_level         SMALLINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  the_student UUID;
  the_kpi     UUID;
  the_group   UUID;
  the_comp    UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT s.student_id, t.kpi_id, a.group_id, k.competency_id
  INTO the_student, the_kpi, the_group, the_comp
  FROM assignment_submissions s
  JOIN group_assignments a ON a.id = s.assignment_id
  JOIN kpi_triplets t      ON t.id = a.triplet_id
  JOIN competency_kpis k   ON k.id = t.kpi_id
  WHERE s.id = p_submission_id;

  IF the_student IS NULL THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_FOUND';
  END IF;

  -- The workplace mentor evaluates. The advisor assigns and watches.
  IF NOT is_mentor_of(the_student) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  -- Both guards below are gated on p_approved, and the gate is the fix for a
  -- trap, not a convenience.
  --
  -- Each of them asks whether an observation written NOW would be meaningful.
  -- That question only arises in the approve direction. A withdrawal writes no
  -- observation; it DELETES one. There is nothing for these checks to validate,
  -- and nothing they could protect by refusing -- refusing a withdrawal only
  -- keeps evidence standing that the mentor has decided to take back.
  --
  -- Ungated, they made an approval permanently un-retractable. Mentor approves,
  -- observation written, XP paid; the student then joins another group, which
  -- closes the first membership; the mentor tries to retract and gets
  -- STUDENT_LEFT_GROUP. The observation keeps counting -- get_competency_progress
  -- filters on nothing about groups -- and kpi_observations has no DELETE policy
  -- and no other RPC that removes a row, so the app has no way back at all.
  -- NOT_IN_SCOPE set the identical trap one step later: an advisor narrowing the
  -- group's scope after an approval would freeze that approval in place.
  --
  -- Approving is a claim about the present; withdrawing is a correction to the
  -- past. Only the claim has preconditions.
  IF p_approved THEN
    -- The mentor's rating on the same scale (spec decision 2). Required on approval,
    -- meaningless on a revision request. It never gates the observation below.
    IF p_level IS NULL OR p_level NOT BETWEEN 0 AND 3 THEN
      RAISE EXCEPTION 'LEVEL_REQUIRED';
    END IF;

    -- get_competency_progress computes against the student's ACTIVE membership,
    -- while the scope check below validates against the ASSIGNMENT's group.
    -- join_group_by_code closes the old membership and opens a new one, so a
    -- student who re-joins between submitting and being approved would be
    -- approved against group A's targets and read from group B's -- and if B
    -- does not target that competency, nothing moves and nothing says why.
    -- Approving into a void is worse than refusing with a name: the work
    -- belongs to a term the student has left.
    --
    -- Reading group_memberships here is fine. This is a function body, not a
    -- policy qual, so it cannot re-enter that table's policies and cause
    -- 42P17 -- the same reason every SECURITY DEFINER helper in this project
    -- reaches it.
    IF NOT EXISTS (
      SELECT 1 FROM group_memberships m
      WHERE m.group_id = the_group
        AND m.student_id = the_student
        AND m.left_at IS NULL
    ) THEN
      RAISE EXCEPTION 'STUDENT_LEFT_GROUP';
    END IF;

    -- An observation for a competency outside the group's scope is written but
    -- never reported, because get_competency_progress only returns competencies
    -- with a target row. The student would do the work, be approved, and see
    -- nothing move.
    IF NOT EXISTS (
      SELECT 1 FROM group_competency_targets gt
      WHERE gt.group_id = the_group AND gt.competency_id = the_comp
    ) THEN
      RAISE EXCEPTION 'NOT_IN_SCOPE';
    END IF;
  END IF;

  UPDATE assignment_submissions s
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'needs_revision' END,
      mentor_note = p_note,
      mentor_level = CASE WHEN p_approved THEN p_level ELSE NULL END,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  WHERE s.id = p_submission_id;

  IF p_approved THEN
    -- one_observation_per_submission is a PARTIAL unique index (predicate:
    -- assignment_submission_id IS NOT NULL). Postgres only infers a partial
    -- index as an ON CONFLICT arbiter when the conflict target repeats that
    -- same predicate; without it, index inference finds no matching arbiter
    -- and every call raises 42P10, not just genuine duplicates. Repeating the
    -- WHERE here looks redundant next to the index definition but is load-
    -- bearing -- do not drop it.
    INSERT INTO kpi_observations
      (student_id, kpi_id, log_id, observed_by, assignment_submission_id)
    VALUES (the_student, the_kpi, NULL, auth.uid(), p_submission_id)
    ON CONFLICT (assignment_submission_id) WHERE assignment_submission_id IS NOT NULL
      DO UPDATE SET observed_by = auth.uid(), observed_at = now();
  ELSE
    -- A withdrawn approval must stop counting. Otherwise the student stays
    -- promoted on evidence that was taken back.
    DELETE FROM kpi_observations o
    WHERE o.assignment_submission_id = p_submission_id;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS review_assignment(UUID, BOOLEAN, TEXT);
GRANT EXECUTE ON FUNCTION review_assignment(UUID, BOOLEAN, TEXT, SMALLINT) TO authenticated;

-- ---- competency_self_vs_mentor ----
-- The gap between what the student thought and what the mentor saw, per
-- competency. Readable by the student, their mentor, and the advisor of a
-- group they are an active member of. Approved submissions with both
-- ratings only (legacy rows have NULLs and are ignored).
CREATE OR REPLACE FUNCTION competency_self_vs_mentor(p_student_id UUID)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (p_student_id = auth.uid() OR is_mentor_of(p_student_id)
          OR EXISTS (SELECT 1 FROM group_memberships m JOIN internship_groups g ON g.id = m.group_id
                     WHERE m.student_id = p_student_id AND m.left_at IS NULL AND g.advisor_id = auth.uid())) THEN
    RAISE EXCEPTION 'SELF_ASSESSMENT_FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'competencyId', c.id, 'code', c.code, 'name', c.name,
    'tasks', count(*),
    'avgSelf', round(avg(s.self_level)::numeric, 1),
    'avgMentor', round(avg(s.mentor_level)::numeric, 1),
    'gap', round((avg(s.mentor_level) - avg(s.self_level))::numeric, 1),
    'overRated', count(*) FILTER (WHERE s.self_level > s.mentor_level),
    'underRated', count(*) FILTER (WHERE s.self_level < s.mentor_level))
  FROM assignment_submissions s
  JOIN group_assignments a ON a.id = s.assignment_id
  JOIN kpi_triplets t ON t.id = a.triplet_id
  JOIN competency_kpis k ON k.id = t.kpi_id
  JOIN competencies c ON c.id = k.competency_id
  WHERE s.student_id = p_student_id AND s.status = 'approved'
    AND s.self_level IS NOT NULL AND s.mentor_level IS NOT NULL
  GROUP BY c.id, c.code, c.name
  ORDER BY c.code;
END;
$$;
GRANT EXECUTE ON FUNCTION competency_self_vs_mentor(UUID) TO authenticated;
