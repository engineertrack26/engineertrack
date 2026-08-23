-- docs/daily-log-retirement-rpcs.sql
-- Run AFTER docs/daily-log-retirement-migration.sql. Idempotent.
--
-- Every column reference below is alias-qualified. RETURNS TABLE (level INT, …)
-- creates a PL/pgSQL variable named `level`, and an unqualified `WHERE level = …`
-- raises 42702 — a bug that shipped in this codebase once and survived months,
-- because it only fires on the success path.

-- ============================================
-- submit_assignment: new signature, carrying the reflection and the evidence
-- ============================================
--
-- The old signature MUST be dropped, not merely replaced. CREATE OR REPLACE
-- with a different argument list creates an OVERLOAD, and PostgREST resolves
-- overloads by the argument names a caller sends -- so both would live in the
-- catalog and a client sending the old three would silently keep hitting the
-- old body. That surfaces as an intermittent wrong-behaviour bug, not as an
-- error at deploy time.
DROP FUNCTION IF EXISTS submit_assignment(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION submit_assignment(
  p_assignment_id UUID,
  p_note          TEXT  DEFAULT NULL,
  p_reflection    TEXT  DEFAULT NULL,
  p_photos        JSONB DEFAULT '[]'::jsonb,
  p_documents     JSONB DEFAULT '[]'::jsonb
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
    (assignment_id, student_id, status, student_note, reflection, submitted_at)
  VALUES (p_assignment_id, auth.uid(), 'submitted', p_note, p_reflection, now())
  ON CONFLICT (assignment_id, student_id) DO UPDATE
    SET status = 'submitted',
        student_note = EXCLUDED.student_note,
        reflection = EXCLUDED.reflection,
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
  WHERE e.uri IS NOT NULL;

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

GRANT EXECUTE ON FUNCTION submit_assignment(UUID, TEXT, TEXT, JSONB, JSONB) TO authenticated;

-- Resubmitting after a revision request clears reviewed_at and reviewed_by, so
-- the mentor's queue shows it as waiting again.

-- log_id stays on assignment_submissions and stops being written here. It is
-- not dropped: docs/database-schema.sql and the archive screens still
-- reference it, and a dropped column is not idempotent to re-add.
