-- ============================================================
-- Internship closure guards. This file is now the current home of the
-- bodies of these ten write RPCs -- edit here, not in the originals:
--   submit_assignment(UUID, TEXT, TEXT, JSONB, JSONB, SMALLINT)
--   review_assignment(UUID, BOOLEAN, TEXT, SMALLINT)
--   set_submission_sharing(UUID, BOOLEAN)
--   internship_open_day(UUID, DATE, TEXT, TEXT)
--   internship_save_log(UUID, INTEGER, TEXT, TEXT, TEXT, INTEGER, BOOLEAN, TEXT, UUID, JSONB)
--   internship_review(JSONB, TEXT, TEXT)
--   internship_note(UUID, INTEGER, TEXT, BOOLEAN)
--   open_conversation(UUID, UUID)
--   open_case(UUID, UUID)
--   send_message(UUID, TEXT)
-- Each gained exactly one closure guard (`IF internship_closed(...) THEN
-- RAISE EXCEPTION 'INTERNSHIP_CLOSED'; END IF;`), placed after authentication
-- and before any write, per docs/superpowers/specs/2026-09-16-internship-closure-design.md §3.
-- Nothing else in any body changed from its original home.
-- Apply order: docs/internship-closure-migration.sql, then this file, then
-- docs/internship-closure-verification.sql.
-- Anonymous dollar-quoting only.
-- ============================================================

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

  -- Internship closure: the record is read-only once closed (design §3).
  IF internship_closed(the_student, the_group) THEN
    RAISE EXCEPTION 'INTERNSHIP_CLOSED';
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
GRANT EXECUTE ON FUNCTION review_assignment(UUID, BOOLEAN, TEXT, SMALLINT) TO authenticated;

-- ============================================================
-- set_submission_sharing -- was docs/group-feed-rpcs.sql
-- The submission's group is not a parameter -- derive it via the assignment,
-- same join the brief specifies.
-- ============================================================
CREATE OR REPLACE FUNCTION set_submission_sharing(p_submission_id UUID, p_share BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_group UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  SELECT student_id INTO v_owner FROM assignment_submissions WHERE id = p_submission_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_FOUND';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_OWNER';
  END IF;

  -- Internship closure: the record is read-only once closed (design §3).
  SELECT a.group_id INTO v_group FROM assignment_submissions s
    JOIN group_assignments a ON a.id = s.assignment_id WHERE s.id = p_submission_id;
  IF internship_closed(v_owner, v_group) THEN
    RAISE EXCEPTION 'INTERNSHIP_CLOSED';
  END IF;

  UPDATE assignment_submissions SET share_to_feed = p_share WHERE id = p_submission_id;

  IF p_share THEN
    PERFORM feed_publish_submission(p_submission_id);
  ELSE
    DELETE FROM feed_posts WHERE submission_id = p_submission_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION set_submission_sharing(UUID, BOOLEAN) TO authenticated;

-- ============================================================
-- internship_open_day -- was docs/internship-days-migration.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.internship_open_day(p_student_id uuid, p_date date, p_timezone text, p_reason text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sp student_profiles%ROWTYPE; g internship_groups%ROWTYPE; placement internship_placements%ROWTYPE;
  existing internship_days%ROWTYPE; result uuid; actor_role text; local_today date;
BEGIN
  SELECT role INTO actor_role FROM profiles WHERE id = auth.uid();
  IF actor_role NOT IN ('student','mentor') OR actor_role IS NULL OR NOT internship_can_student(p_student_id,auth.uid()) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  IF p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
  SELECT * INTO sp FROM student_profiles WHERE id=p_student_id FOR UPDATE;
  IF sp.mentor_id IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=sp.mentor_id AND role='mentor')
    OR nullif(trim(sp.company_name),'') IS NULL OR sp.internship_start_date IS NULL OR sp.internship_end_date IS NULL
    OR sp.internship_end_date < sp.internship_start_date THEN RAISE EXCEPTION 'ID_SETUP'; END IF;
  -- The app currently supports one active group. Do not choose arbitrarily if that invariant is broken.
  IF (SELECT count(*) FROM group_memberships m JOIN internship_groups gr ON gr.id=m.group_id
      WHERE m.student_id=sp.id AND m.left_at IS NULL AND NOT gr.is_archived) <> 1 THEN RAISE EXCEPTION 'ID_SETUP'; END IF;
  SELECT gr.* INTO g FROM internship_groups gr JOIN group_memberships m ON m.group_id=gr.id
    WHERE m.student_id=sp.id AND m.left_at IS NULL AND NOT gr.is_archived;
  -- Internship closure: the record is read-only once closed (design §3).
  IF internship_closed(sp.id, g.id) THEN RAISE EXCEPTION 'INTERNSHIP_CLOSED'; END IF;
  SELECT * INTO existing FROM internship_days WHERE student_id=sp.id AND day_date=p_date;
  IF FOUND THEN
    IF NOT internship_can_day(existing.id) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
    RETURN existing.id; -- idempotent reconnect/double tap; never changes the original check-in time
  END IF;
  INSERT INTO internship_placements(student_id,group_id,mentor_id,company_name,start_date,end_date,timezone)
    VALUES(sp.id,g.id,sp.mentor_id,trim(sp.company_name),sp.internship_start_date,sp.internship_end_date,p_timezone)
    ON CONFLICT(student_id,group_id,mentor_id,company_name,start_date,end_date) DO NOTHING;
  SELECT * INTO placement FROM internship_placements WHERE student_id=sp.id AND group_id=g.id AND mentor_id=sp.mentor_id
    AND company_name=trim(sp.company_name) AND start_date=sp.internship_start_date AND end_date=sp.internship_end_date;
  local_today := (now() AT TIME ZONE placement.timezone)::date;
  IF p_date IS NULL OR p_date > local_today OR p_date NOT BETWEEN placement.start_date AND placement.end_date
    OR char_length(coalesce(p_reason,'')) > 2000 THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
  IF (p_date < local_today OR actor_role='mentor') AND nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'ID_REASON'; END IF;
  INSERT INTO internship_days(placement_id,student_id,day_date,reported_by,check_in_at,report_reason)
    VALUES(placement.id,sp.id,p_date,auth.uid(),CASE WHEN actor_role='student' AND p_date=local_today THEN now() ELSE NULL END,coalesce(trim(p_reason),'')) RETURNING id INTO result;
  INSERT INTO internship_day_events(day_id,actor_id,event_type,note,next_value)
    VALUES(result,auth.uid(),'created',coalesce(trim(p_reason),''),jsonb_build_object('date',p_date,'source',actor_role));
  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.internship_open_day(uuid,date,text,text) TO authenticated;

-- ============================================================
-- internship_save_log -- was docs/internship-days-migration.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.internship_save_log(p_day uuid,p_version integer,p_experience text,p_learning text,p_next_step text,p_support integer,p_submit boolean,p_reason text DEFAULT '',p_task uuid DEFAULT NULL,p_attachment jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d internship_days%ROWTYPE; task_label text; competency_label text;
BEGIN
  SELECT * INTO d FROM internship_days WHERE id=p_day FOR UPDATE;
  IF NOT FOUND OR d.student_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  -- Internship closure: the record is read-only once closed (design §3).
  IF internship_closed(d.student_id, (SELECT group_id FROM internship_placements WHERE id = d.placement_id)) THEN RAISE EXCEPTION 'INTERNSHIP_CLOSED'; END IF;
  IF d.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'ID_CONFLICT'; END IF;
  IF p_submit IS NULL OR p_experience IS NULL OR p_learning IS NULL OR p_next_step IS NULL
    OR char_length(p_experience)>4000 OR char_length(p_learning)>4000 OR char_length(p_next_step)>2000
    OR p_support NOT BETWEEN 0 AND 3 OR char_length(coalesce(p_reason,''))>2000 THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
  IF p_submit AND (nullif(trim(p_experience),'') IS NULL OR nullif(trim(p_learning),'') IS NULL OR p_support IS NULL) THEN RAISE EXCEPTION 'ID_REQUIRED'; END IF;
  IF d.log_status='submitted' AND (NOT p_submit OR nullif(trim(p_reason),'') IS NULL) THEN RAISE EXCEPTION 'ID_REASON'; END IF;
  IF p_task IS NOT NULL THEN
    IF p_task = d.task_id THEN task_label:=d.task_title; competency_label:=d.competency_name;
    ELSE
      SELECT a.title,c.name INTO task_label,competency_label FROM group_assignments a
        JOIN internship_placements p ON p.id=d.placement_id AND p.group_id=a.group_id
        JOIN kpi_triplets kt ON kt.id=a.triplet_id JOIN competency_kpis k ON k.id=kt.kpi_id JOIN competencies c ON c.id=k.competency_id
        WHERE a.id=p_task AND a.published_at IS NOT NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
    END IF;
  END IF;
  IF p_attachment IS NOT NULL AND (jsonb_typeof(p_attachment) IS DISTINCT FROM 'object'
    OR nullif(trim(p_attachment->>'name'),'') IS NULL OR char_length(p_attachment->>'name')>255
    OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='internship-day-files' AND o.name=p_attachment->>'path'
      AND split_part(o.name,'/',1)=auth.uid()::text AND split_part(o.name,'/',2)=d.id::text)) THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
  UPDATE internship_days SET experience=trim(p_experience),learning=trim(p_learning),next_step=trim(p_next_step),support_level=p_support,
    task_id=p_task,task_title=task_label,competency_name=competency_label,attachment=p_attachment,
    log_status=CASE WHEN p_submit THEN 'submitted' ELSE 'draft' END,
    submitted_at=CASE WHEN p_submit THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=p_day;
  INSERT INTO internship_day_events(day_id,actor_id,event_type,note,previous_value,next_value)
    SELECT p_day,auth.uid(),CASE WHEN p_submit THEN 'log_submitted' ELSE 'log_saved' END,coalesce(trim(p_reason),''),
      jsonb_build_object('experience',d.experience,'learning',d.learning,'next_step',d.next_step,'support_level',d.support_level,'log_status',d.log_status,'task_title',d.task_title,'attachment',d.attachment),
      jsonb_build_object('experience',experience,'learning',learning,'next_step',next_step,'support_level',support_level,'log_status',log_status,'task_title',task_title,'attachment',attachment)
    FROM internship_days WHERE id=p_day;
  IF p_submit THEN
    PERFORM internship_notify(p.mentor_id,'internship_log_submitted','Journal submitted',
      concat_ws(' ',pr.first_name,pr.last_name)||' submitted the journal for '||to_char(d.day_date,'YYYY-MM-DD'),
      jsonb_build_object('dayId',d.id,'studentId',d.student_id,'date',d.day_date))
    FROM internship_placements p JOIN profiles pr ON pr.id=d.student_id WHERE p.id=d.placement_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.internship_save_log(uuid,integer,text,text,text,integer,boolean,text,uuid,jsonb) TO authenticated;

-- ============================================================
-- internship_review -- was docs/internship-days-migration.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.internship_review(p_days jsonb,p_status text,p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item jsonb; d internship_days%ROWTYPE; v_student uuid; v_group uuid; v_count int := 0; v_closed int := 0; v_first date; v_last date;
BEGIN
  IF (SELECT role FROM profiles WHERE id=auth.uid()) IS DISTINCT FROM 'mentor' THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('present','partial','excused','absent') OR jsonb_typeof(p_days) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_days) NOT BETWEEN 1 AND 31 OR char_length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_days) ORDER BY value->>'id' LOOP
    SELECT * INTO d FROM internship_days WHERE id=(item->>'id')::uuid FOR UPDATE;
    IF NOT FOUND OR NOT internship_can_day(d.id) OR NOT EXISTS(
      SELECT 1 FROM internship_placements p JOIN student_profiles sp ON sp.id=p.student_id
      WHERE p.id=d.placement_id AND p.mentor_id=auth.uid() AND sp.mentor_id=auth.uid()) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
    -- Internship closure: the record is read-only once closed (design §3).
    IF internship_closed(d.student_id, (SELECT group_id FROM internship_placements WHERE id = d.placement_id)) THEN RAISE EXCEPTION 'INTERNSHIP_CLOSED'; END IF;
    IF d.version IS DISTINCT FROM (item->>'version')::integer THEN RAISE EXCEPTION 'ID_CONFLICT'; END IF;
    IF (d.attendance<>'pending' OR p_status<>'present' OR d.correction_requested) AND nullif(trim(p_note),'') IS NULL THEN RAISE EXCEPTION 'ID_REASON'; END IF;
    UPDATE internship_days SET attendance=p_status,attendance_by=auth.uid(),attendance_at=now(),attendance_note=coalesce(trim(p_note),''),
      correction_requested=false,version=version+1,updated_at=now() WHERE id=d.id;
    INSERT INTO internship_day_events(day_id,actor_id,event_type,note,previous_value,next_value)
      VALUES(d.id,auth.uid(),'attendance',coalesce(trim(p_note),''),jsonb_build_object('attendance',d.attendance,'correction_requested',d.correction_requested),jsonb_build_object('attendance',p_status));
    -- A selection belongs to one student (the screen reviews one student at a
    -- time); if it ever spans two, each student is told about their own days.
    IF v_student IS DISTINCT FROM d.student_id AND v_student IS NOT NULL THEN
      PERFORM internship_notify(v_student,'internship_attendance','Attendance decided',
        v_count||' day(s) marked '||p_status||' ('||to_char(v_first,'YYYY-MM-DD')||' to '||to_char(v_last,'YYYY-MM-DD')||')',
        jsonb_build_object('studentId',v_student,'status',p_status,'count',v_count));
      v_count := 0; v_closed := 0; v_first := NULL;
    END IF;
    v_student := d.student_id; v_count := v_count+1; v_last := d.day_date; v_first := coalesce(v_first,d.day_date);
    IF d.correction_requested THEN v_closed := v_closed+1; SELECT group_id INTO v_group FROM internship_placements WHERE id=d.placement_id; END IF;
  END LOOP;
  IF v_student IS NOT NULL THEN
    PERFORM internship_notify(v_student,'internship_attendance','Attendance decided',
      v_count||' day(s) marked '||p_status||' ('||to_char(v_first,'YYYY-MM-DD')||' to '||to_char(v_last,'YYYY-MM-DD')||')',
      jsonb_build_object('studentId',v_student,'status',p_status,'count',v_count));
    IF v_closed > 0 THEN
      PERFORM internship_notify(g.advisor_id,'internship_feedback','Correction answered',
        concat_ws(' ',pr.first_name,pr.last_name)||': '||v_closed||' day(s) re-decided as '||p_status,
        jsonb_build_object('studentId',v_student,'count',v_closed))
      FROM internship_groups g JOIN profiles pr ON pr.id=v_student WHERE g.id=v_group;
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.internship_review(jsonb,text,text) TO authenticated;

-- ============================================================
-- internship_note -- was docs/internship-days-migration.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.internship_note(p_day uuid,p_version integer,p_note text,p_correction boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d internship_days%ROWTYPE; actor_role text;
BEGIN
  SELECT role INTO actor_role FROM profiles WHERE id=auth.uid();
  SELECT * INTO d FROM internship_days WHERE id=p_day FOR UPDATE;
  IF NOT FOUND OR NOT internship_can_day(p_day) OR actor_role IS NULL OR actor_role NOT IN ('mentor','advisor')
    OR (p_correction AND actor_role<>'advisor') THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  -- Internship closure: the record is read-only once closed (design §3).
  IF internship_closed(d.student_id, (SELECT group_id FROM internship_placements WHERE id = d.placement_id)) THEN RAISE EXCEPTION 'INTERNSHIP_CLOSED'; END IF;
  -- After the archive the record is closed: the advisor can still read it, not write to it.
  IF EXISTS (SELECT 1 FROM internship_placements p JOIN internship_groups g ON g.id=p.group_id
             WHERE p.id=d.placement_id AND g.is_archived) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  IF d.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'ID_CONFLICT'; END IF;
  IF p_correction IS NULL OR nullif(trim(p_note),'') IS NULL OR char_length(p_note)>2000 THEN RAISE EXCEPTION 'ID_REQUIRED'; END IF;
  UPDATE internship_days SET correction_requested=CASE WHEN p_correction THEN true ELSE correction_requested END,version=version+1,updated_at=now() WHERE id=p_day;
  INSERT INTO internship_day_events(day_id,actor_id,event_type,note)
    VALUES(p_day,auth.uid(),CASE WHEN p_correction THEN 'correction' ELSE 'feedback' END,trim(p_note));
  IF p_correction THEN
    PERFORM internship_notify(p.mentor_id,'internship_correction','Correction requested',
      concat_ws(' ',pr.first_name,pr.last_name)||' / '||to_char(d.day_date,'YYYY-MM-DD')||': '||trim(p_note),
      jsonb_build_object('dayId',d.id,'studentId',d.student_id,'date',d.day_date))
    FROM internship_placements p JOIN profiles pr ON pr.id=d.student_id WHERE p.id=d.placement_id;
  ELSE
    PERFORM internship_notify(d.student_id,'internship_feedback','Feedback on your internship day',
      to_char(d.day_date,'YYYY-MM-DD')||': '||trim(p_note),
      jsonb_build_object('dayId',d.id,'date',d.day_date));
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.internship_note(uuid,integer,text,boolean) TO authenticated;

-- ============================================================
-- open_conversation -- was docs/direct-messages-rpcs.sql
-- ============================================================
CREATE OR REPLACE FUNCTION open_conversation(p_group_id UUID, p_other_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_kind TEXT; v_key TEXT; v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  v_kind := can_message(p_group_id, auth.uid(), p_other_id);
  IF v_kind IS NULL THEN RAISE EXCEPTION 'CANNOT_MESSAGE'; END IF;
  -- Internship closure: the record is read-only once closed (design §3) --
  -- neither party may open a new conversation about a closed student.
  IF internship_closed(auth.uid(), p_group_id) OR internship_closed(p_other_id, p_group_id) THEN
    RAISE EXCEPTION 'INTERNSHIP_CLOSED';
  END IF;
  v_key := LEAST(auth.uid(), p_other_id)::text || ':' || GREATEST(auth.uid(), p_other_id)::text;
  SELECT id INTO v_id FROM conversations WHERE group_id = p_group_id AND pair_key = v_key;
  IF v_id IS NULL THEN
    INSERT INTO conversations (group_id, kind, pair_key, created_by) VALUES (p_group_id, v_kind, v_key, auth.uid())
    ON CONFLICT (group_id, pair_key) DO UPDATE SET kind = EXCLUDED.kind
    RETURNING id INTO v_id;
    INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_id, auth.uid()), (v_id, p_other_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION open_conversation(UUID, UUID) TO authenticated;

-- ============================================================
-- open_case -- was docs/direct-messages-rpcs.sql
-- ============================================================
CREATE OR REPLACE FUNCTION open_case(p_group_id UUID, p_student_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_mentor UUID; v_name TEXT; v_new BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM internship_groups g WHERE g.id = p_group_id AND g.advisor_id = auth.uid() AND NOT g.is_archived)
     OR NOT EXISTS (SELECT 1 FROM group_memberships m WHERE m.group_id = p_group_id AND m.student_id = p_student_id AND m.left_at IS NULL) THEN
    RAISE EXCEPTION 'CANNOT_OPEN_CASE';
  END IF;
  SELECT sp.mentor_id INTO v_mentor FROM student_profiles sp WHERE sp.id = p_student_id;
  IF v_mentor IS NULL THEN RAISE EXCEPTION 'CASE_NEEDS_MENTOR'; END IF;
  -- Internship closure: the record is read-only once closed (design §3).
  IF internship_closed(p_student_id, p_group_id) THEN RAISE EXCEPTION 'INTERNSHIP_CLOSED'; END IF;
  INSERT INTO conversations (group_id, kind, subject_id, created_by) VALUES (p_group_id, 'case', p_student_id, auth.uid())
  ON CONFLICT (group_id, subject_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM conversations WHERE group_id = p_group_id AND subject_id = p_student_id;
  ELSE
    v_new := true;
  END IF;
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_id, auth.uid()), (v_id, p_student_id), (v_id, v_mentor) ON CONFLICT DO NOTHING;
  IF v_new THEN
    SELECT trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')) INTO v_name FROM profiles_public pp WHERE pp.id = auth.uid();
    INSERT INTO notifications (user_id, title, body, type, data)
    SELECT u, 'Case opened', coalesce(nullif(v_name, ''), 'Your advisor') || ' opened a case thread with you.',
           'direct_message', jsonb_build_object('conversationId', v_id)
    FROM unnest(ARRAY[p_student_id, v_mentor]) AS u;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION open_case(UUID, UUID) TO authenticated;

-- ============================================================
-- send_message -- was docs/direct-messages-rpcs.sql
-- ============================================================
CREATE OR REPLACE FUNCTION send_message(p_conversation_id UUID, p_body TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c conversations%ROWTYPE; v_other UUID; v_msg UUID; v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF btrim(coalesce(p_body, '')) = '' THEN RAISE EXCEPTION 'MESSAGE_EMPTY'; END IF;
  SELECT * INTO v_c FROM conversations WHERE id = p_conversation_id;
  IF v_c.id IS NULL OR NOT can_access_conversation(p_conversation_id) THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
  -- Internship closure: the record is read-only once closed (design §3) -- for
  -- the sender, the case subject (if any), or any closed participant of the
  -- conversation's group.
  IF internship_closed(auth.uid(), v_c.group_id)
     OR (v_c.subject_id IS NOT NULL AND internship_closed(v_c.subject_id, v_c.group_id))
     OR EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = v_c.id AND internship_closed(cp.user_id, v_c.group_id))
  THEN
    RAISE EXCEPTION 'INTERNSHIP_CLOSED';
  END IF;
  IF v_c.kind IN ('member', 'mentor') THEN
    v_other := conversation_other(p_conversation_id, auth.uid());
    IF EXISTS (SELECT 1 FROM conversation_blocks WHERE conversation_id = p_conversation_id AND blocker_id = v_other) THEN
      RAISE EXCEPTION 'BLOCKED';
    END IF;
  END IF;

  INSERT INTO messages (conversation_id, sender_id, body) VALUES (p_conversation_id, auth.uid(), btrim(p_body)) RETURNING id INTO v_msg;
  UPDATE conversations SET last_message_at = now() WHERE id = p_conversation_id;
  INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES (p_conversation_id, auth.uid(), now())
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;

  SELECT trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')) INTO v_name FROM profiles_public pp WHERE pp.id = auth.uid();
  -- One notification per other participant (two in a case).
  INSERT INTO notifications (user_id, title, body, type, data)
  SELECT cp.user_id, 'New message', coalesce(nullif(v_name, ''), 'Someone') || ': ' || left(btrim(p_body), 80),
         'direct_message', jsonb_build_object('conversationId', p_conversation_id)
  FROM conversation_participants cp WHERE cp.conversation_id = p_conversation_id AND cp.user_id <> auth.uid();
  RETURN v_msg;
END;
$$;
GRANT EXECUTE ON FUNCTION send_message(UUID, TEXT) TO authenticated;
