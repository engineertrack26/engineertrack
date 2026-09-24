-- docs/review-by-advisor.sql — idempotent. Apply after
-- docs/internship-closure-guards.sql.
--
-- NEW HOME of submit_assignment and review_assignment. They lived in
-- docs/internship-closure-guards.sql, which took them from
-- docs/self-assessment-migration.sql; that file now carries a note pointing
-- here. RE-RUNNING IT PUTS THE MENTOR GATE BACK.
--
-- Change (spec docs/superpowers/specs/2026-09-24-advisor-review-design.md):
-- the group's advisor reviews and approves, not the workplace mentor. The
-- advisor draws the task from the framework and assigns it, so the owners want
-- the same person to judge it. The mentor keeps attendance confirmation
-- (internship_review), messaging and read-only access to the work.

-- ============================================================
-- submit_assignment -- was docs/self-assessment-migration.sql
-- ============================================================
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
  the_reviewer     UUID;
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

  -- Simulation finding #10 (2026-09-20): "Yaptım." was accepted five times. A
  -- reflection is the student's voice on the work; twenty characters is the
  -- floor the owner chose, and the form shows the same counter.
  IF char_length(btrim(p_reflection)) < 20 THEN
    RAISE EXCEPTION 'REFLECTION_TOO_SHORT';
  END IF;

  -- Simulation finding #9: a submission with no photo and no document went
  -- through and was approved. The form says "evidence: at least one photo";
  -- the rule the owner chose is at least one photo OR one document.
  IF jsonb_typeof(coalesce(p_photos, '[]'::jsonb)) IS DISTINCT FROM 'array'
     OR jsonb_typeof(coalesce(p_documents, '[]'::jsonb)) IS DISTINCT FROM 'array'
     OR jsonb_array_length(coalesce(p_photos, '[]'::jsonb)) + jsonb_array_length(coalesce(p_documents, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'EVIDENCE_REQUIRED';
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

  -- Internship closure: the record is read-only once closed (design §3).
  IF internship_closed(auth.uid(), target_group) THEN
    RAISE EXCEPTION 'INTERNSHIP_CLOSED';
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
        -- Simulation finding #16: the revision note stayed on the resubmitted
        -- row and the "waiting" card kept telling the student to fix it.
        mentor_note = NULL,
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
    SELECT g.advisor_id INTO the_reviewer
    FROM group_memberships m
    JOIN internship_groups g ON g.id = m.group_id
    WHERE m.student_id = auth.uid() AND m.left_at IS NULL
    LIMIT 1;

    -- A student not in a group cannot have an assignment to submit, so this is
    -- belt and braces; it leaves through the ordinary path, never the handler.
    IF the_reviewer IS NOT NULL THEN
      SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
      INTO student_name FROM profiles p WHERE p.id = auth.uid();

      INSERT INTO notifications (user_id, title, body, type, data)
      VALUES (
        the_reviewer,
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
    RAISE WARNING 'submit_assignment: advisor notification failed: %', SQLERRM;
  END;

  RETURN submission;
END;
$$;
GRANT EXECUTE ON FUNCTION submit_assignment(UUID, TEXT, TEXT, JSONB, JSONB, SMALLINT) TO authenticated;

-- ============================================================
-- review_assignment -- was docs/self-assessment-migration.sql
-- ============================================================
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
  the_status  TEXT;
  the_title   TEXT;
  the_assignment UUID;
  mentor_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT s.student_id, t.kpi_id, a.group_id, k.competency_id, s.status, a.title, a.id
  INTO the_student, the_kpi, the_group, the_comp, the_status, the_title, the_assignment
  FROM assignment_submissions s
  JOIN group_assignments a ON a.id = s.assignment_id
  JOIN kpi_triplets t      ON t.id = a.triplet_id
  JOIN competency_kpis k   ON k.id = t.kpi_id
  WHERE s.id = p_submission_id;

  IF the_student IS NULL THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_FOUND';
  END IF;

  -- Internship closure: the record is read-only once closed (design §3).
  IF internship_closed(the_student, the_group) THEN
    RAISE EXCEPTION 'INTERNSHIP_CLOSED';
  END IF;

  -- The advisor evaluates: they draw the task from the framework and assign
  -- it, so they judge whether it was done (2026-09-24 spec). The mentor still
  -- reads the submission and still confirms attendance, but cannot decide.
  IF NOT is_group_advisor_of(the_student) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  -- Simulation finding #3: a second approval silently overwrote the mentor's
  -- level and note after the student and advisor could already see them.
  -- Approval is final (CLAUDE.md); the one way back is the withdrawal below
  -- (p_approved = false), which the comments explain.
  IF p_approved AND the_status = 'approved' THEN
    RAISE EXCEPTION 'ALREADY_APPROVED';
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

  -- Simulation finding #11: the decision's notification used to be inserted
  -- by the mentor's app after this RPC returned, so any other client or a
  -- crash in between left the student unnotified. Same title/body shape the
  -- client used (notificationContent() localises it), written here, in the
  -- same transaction as the decision.
  SELECT trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, ''))
  INTO mentor_name FROM profiles_public pp WHERE pp.id = auth.uid();
  INSERT INTO notifications (user_id, title, body, type, data)
  VALUES (the_student,
          CASE WHEN p_approved THEN 'Task Approved!' ELSE 'Revision Requested' END,
          left(coalesce(nullif(mentor_name, ''), 'Your advisor')
               || CASE WHEN p_approved THEN ' approved your task "' ELSE ' requested revisions on your task "' END
               || coalesce(the_title, '') || '".', 200),
          CASE WHEN p_approved THEN 'task_approved' ELSE 'task_revision_requested' END,
          jsonb_build_object('assignmentId', the_assignment));
END;
$$;
GRANT EXECUTE ON FUNCTION review_assignment(UUID, BOOLEAN, TEXT, SMALLINT) TO authenticated;
