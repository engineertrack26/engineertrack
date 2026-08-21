-- docs/task-assignment-migration.sql
-- Run AFTER docs/task-triplets-migration.sql. Idempotent.

-- A mentor belongs to no group, but must read the assignments of the students
-- they supervise in order to evaluate them. SECURITY DEFINER for the same
-- reason every other helper here is: a policy body that reads internship_groups
-- or group_memberships directly re-enters their policies, which is what caused
-- 42P17 on 2026-08-20.
CREATE OR REPLACE FUNCTION mentors_a_member_of_group(p_group_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_memberships m
    JOIN student_profiles sp ON sp.id = m.student_id
    WHERE m.group_id = p_group_id
      AND m.left_at IS NULL
      AND sp.mentor_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION mentors_a_member_of_group(UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS group_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  triplet_id  UUID NOT NULL REFERENCES kpi_triplets(id),
  title       TEXT NOT NULL,
  description TEXT,
  objective   TEXT NOT NULL,
  criterion   TEXT NOT NULL,
  due_date    DATE,
  created_by  UUID NOT NULL REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_assignments_group_idx
  ON group_assignments(group_id);

-- objective and criterion are copied from the triplet rather than joined. If
-- the reference text is corrected next month, approvals granted last month must
-- still mean what they meant when they were granted.

ALTER TABLE group_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignments read" ON group_assignments;
CREATE POLICY "assignments read" ON group_assignments
  FOR SELECT TO authenticated USING (
    owns_group(group_id)
    OR is_member_of_group(group_id)
    OR mentors_a_member_of_group(group_id)
  );

-- Replaced by three separately-governed policies below (insert, update,
-- delete) so a database that already has this FOR ALL policy loses it on
-- re-run. FOR ALL included DELETE, and this table's child rows can carry
-- approvals that must not be casually erasable — see the delete policy.
DROP POLICY IF EXISTS "advisor writes assignments" ON group_assignments;

DROP POLICY IF EXISTS "advisor inserts assignments" ON group_assignments;
CREATE POLICY "advisor inserts assignments" ON group_assignments
  FOR INSERT TO authenticated
  WITH CHECK (owns_group(group_id));

-- WITH CHECK matters as much as USING here: with only USING, an advisor
-- could move a row to a group they do not own, because USING only tests the
-- row as it stood BEFORE the update.
DROP POLICY IF EXISTS "advisor updates assignments" ON group_assignments;
CREATE POLICY "advisor updates assignments" ON group_assignments
  FOR UPDATE TO authenticated
  USING (owns_group(group_id))
  WITH CHECK (owns_group(group_id));

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES group_assignments(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('submitted','approved','needs_revision')),
  student_note  TEXT,
  mentor_note   TEXT,
  log_id        UUID REFERENCES daily_logs(id) ON DELETE SET NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES profiles(id),
  UNIQUE (assignment_id, student_id)
);

-- There is no 'assigned' status. A row appears on the student's first action,
-- so its absence IS "not started", and the advisor's overview is a LEFT JOIN
-- from the group's members. That also means a student who joins in week eight
-- inherits every earlier assignment, which is deliberate: a visible backlog
-- beats a silent omission.

CREATE INDEX IF NOT EXISTS assignment_submissions_student_idx
  ON assignment_submissions(student_id, status);

-- An assignment nobody has acted on is a mistake the advisor can take back.
-- One that carries submissions is a record: deleting it would cascade away
-- approvals and, through them, the KPI observations those approvals produced.
-- SECURITY DEFINER because the policy must see whether ANY student has
-- submitted, and an advisor's own RLS view of assignment_submissions is
-- limited to their group's students; this also keeps the rule this file
-- already follows -- no policy body reads another RLS-protected table
-- directly.
CREATE OR REPLACE FUNCTION assignment_has_submissions(p_assignment_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignment_submissions s
    WHERE s.assignment_id = p_assignment_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION assignment_has_submissions(UUID) TO authenticated;

DROP POLICY IF EXISTS "advisor deletes assignments" ON group_assignments;
CREATE POLICY "advisor deletes assignments" ON group_assignments
  FOR DELETE TO authenticated
  USING (owns_group(group_id) AND NOT assignment_has_submissions(id));

ALTER TABLE assignment_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "submissions read" ON assignment_submissions;
CREATE POLICY "submissions read" ON assignment_submissions
  FOR SELECT TO authenticated USING (
    student_id = auth.uid()
    OR is_mentor_of(student_id)
    OR is_group_advisor_of(student_id)
  );

-- No INSERT, UPDATE or DELETE policy. submit_assignment and review_assignment
-- are the only write paths, both SECURITY DEFINER, both taking the actor from
-- auth.uid() rather than a parameter. A mentor's approval writes a KPI
-- observation; a direct write path would make that observation forgeable, which
-- is the same reasoning that left kpi_observations with no INSERT policy.
DROP POLICY IF EXISTS "submissions insert" ON assignment_submissions;
DROP POLICY IF EXISTS "submissions update" ON assignment_submissions;

-- ============================================
-- A rule RLS cannot express, as a trigger
-- ============================================
-- It sits at the end of the file because CREATE TRIGGER needs its table. The
-- function BODY is plpgsql and so is not resolved against the catalog at
-- CREATE FUNCTION time -- unlike the LANGUAGE sql helpers above, which is
-- exactly why those had to be ordered, and this merely follows the same
-- discipline for readability.

-- Scope is meant to be "enforced twice -- a filter in the UI and a validation
-- in the RPC". Until now the only enforcement was in review_assignment, which
-- fires AFTER the student has done the work and reports to the MENTOR, who
-- cannot fix it: the competency scope lives on the advisor's screen. The
-- student's submission became unresolvable. Creation is where the advisor can
-- still act, so the same NOT_IN_SCOPE refusal is raised here.
--
-- A trigger rather than a WITH CHECK on "advisor inserts assignments" because
-- the check must resolve the triplet's competency through kpi_triplets and
-- competency_kpis; a policy qual that walked those tables would be one more
-- policy body reading tables it does not own, the pattern this file avoids.
--
-- SECURITY DEFINER so the lookup is not itself filtered by the caller's RLS
-- view of group_competency_targets: an advisor can read their own group's
-- targets, but the function must answer the same way for every caller.
CREATE OR REPLACE FUNCTION assignment_within_group_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  the_comp UUID;
BEGIN
  SELECT k.competency_id INTO the_comp
  FROM kpi_triplets t
  JOIN competency_kpis k ON k.id = t.kpi_id
  WHERE t.id = NEW.triplet_id;

  -- No separate "triplet not found" branch: triplet_id carries a FOREIGN KEY,
  -- so the only way the_comp is NULL is a triplet whose KPI vanished, and the
  -- EXISTS below is false for NULL anyway. One refusal, one code.
  IF NOT EXISTS (
    SELECT 1 FROM group_competency_targets gt
    WHERE gt.group_id = NEW.group_id
      AND gt.competency_id = the_comp
  ) THEN
    RAISE EXCEPTION 'NOT_IN_SCOPE';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_within_scope ON group_assignments;
CREATE TRIGGER trg_assignment_within_scope
  BEFORE INSERT ON group_assignments
  FOR EACH ROW EXECUTE FUNCTION assignment_within_group_scope();

-- INSERT only, not UPDATE. Narrowing scope after an assignment exists is a
-- decision the advisor is allowed to make -- get_competency_progress simply
-- stops reporting that competency, and the observations survive to reappear if
-- the target is restored. Firing on UPDATE would turn an unrelated edit to a
-- title into a refusal the advisor cannot explain.
