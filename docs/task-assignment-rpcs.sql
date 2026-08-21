-- docs/task-assignment-rpcs.sql
-- Run AFTER docs/task-assignment-migration.sql. Idempotent.
--
-- Every column reference below is alias-qualified. RETURNS TABLE (level INT, …)
-- creates a PL/pgSQL variable named `level`, and an unqualified `WHERE level = …`
-- raises 42702 — a bug that shipped in this codebase once and survived months,
-- because it only fires on the success path.

ALTER TABLE kpi_observations
  ADD COLUMN IF NOT EXISTS assignment_submission_id UUID
    REFERENCES assignment_submissions(id) ON DELETE CASCADE;

-- One observation per approved submission. UNIQUE (kpi_id, log_id, observed_by)
-- treats NULLs as distinct, so two approvals of DIFFERENT tasks for one KPI
-- correctly produce two observations — that is what two independent pieces of
-- evidence means. But re-approving ONE submission would also produce two,
-- manufacturing two observations from a single piece of evidence.
CREATE UNIQUE INDEX IF NOT EXISTS one_observation_per_submission
  ON kpi_observations(assignment_submission_id)
  WHERE assignment_submission_id IS NOT NULL;

-- ============================================
-- record_kpi_observations: task observations must survive a log re-save.
-- Signature unchanged from docs/competency-rpcs.sql.
-- ============================================
CREATE OR REPLACE FUNCTION record_kpi_observations(
  p_student_id UUID,
  p_log_id     UUID,
  p_kpi_ids    UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT can_view_competency(p_student_id) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  DELETE FROM kpi_observations o
  WHERE o.student_id = p_student_id
    AND o.log_id IS NOT DISTINCT FROM p_log_id
    AND o.observed_by = auth.uid()
    AND o.assignment_submission_id IS NULL;   -- never a task observation

  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by)
  SELECT p_student_id, kid, p_log_id, auth.uid()
  FROM unnest(coalesce(p_kpi_ids, ARRAY[]::UUID[])) AS kid;
END;
$$;

-- ============================================
-- submit_assignment
-- ============================================
CREATE OR REPLACE FUNCTION submit_assignment(
  p_assignment_id UUID,
  p_note          TEXT DEFAULT NULL,
  p_log_id        UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_group UUID;
  submission   UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT a.group_id INTO target_group
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
  -- resubmit from there. That path is exercised by the verification script.
  IF EXISTS (
    SELECT 1 FROM assignment_submissions s
    WHERE s.assignment_id = p_assignment_id
      AND s.student_id = auth.uid()
      AND s.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'ALREADY_APPROVED';
  END IF;

  INSERT INTO assignment_submissions
    (assignment_id, student_id, status, student_note, log_id, submitted_at)
  VALUES (p_assignment_id, auth.uid(), 'submitted', p_note, p_log_id, now())
  ON CONFLICT (assignment_id, student_id) DO UPDATE
    SET status = 'submitted',
        student_note = EXCLUDED.student_note,
        log_id = EXCLUDED.log_id,
        submitted_at = now(),
        reviewed_at = NULL,
        reviewed_by = NULL
  RETURNING id INTO submission;

  RETURN submission;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_assignment(UUID, TEXT, UUID) TO authenticated;

-- Resubmitting after a revision request clears reviewed_at and reviewed_by, so
-- the mentor's queue shows it as waiting again.

-- ============================================
-- review_assignment: the bridge from approval to observation
-- ============================================
CREATE OR REPLACE FUNCTION review_assignment(
  p_submission_id UUID,
  p_approved      BOOLEAN,
  p_note          TEXT DEFAULT NULL
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

  UPDATE assignment_submissions s
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'needs_revision' END,
      mentor_note = p_note,
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
      DO NOTHING;
  ELSE
    -- A withdrawn approval must stop counting. Otherwise the student stays
    -- promoted on evidence that was taken back.
    DELETE FROM kpi_observations o
    WHERE o.assignment_submission_id = p_submission_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION review_assignment(UUID, BOOLEAN, TEXT) TO authenticated;

-- ============================================
-- XP on approval. Mirrors the log-approval branch in
-- docs/gamification-server-side-migration.sql:174-183, including its guard
-- against paying twice.
-- ============================================
CREATE OR REPLACE FUNCTION award_assignment_xp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved'
     AND OLD.status IS DISTINCT FROM 'approved'
     AND NOT EXISTS (
       SELECT 1 FROM xp_transactions x
       WHERE x.student_id = NEW.student_id
         AND x.reason = 'assignment_approved:' || NEW.id::text
     )
  THEN
    PERFORM award_xp_internal(
      NEW.student_id, 20, 'assignment_approved:' || NEW.id::text, NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_xp ON assignment_submissions;
CREATE TRIGGER trg_assignment_xp
  AFTER UPDATE ON assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION award_assignment_xp();

-- xp_transactions.log_id cannot hold a submission id, so the submission is
-- carried in `reason` and that is what makes the duplicate guard work. Twenty
-- XP matches log approval: an approved task is the student's work confirmed
-- by someone else, the same kind of thing.
--
-- This fires on UPDATE only. submit_assignment inserts with status
-- 'submitted', so the first approval is always an UPDATE.
