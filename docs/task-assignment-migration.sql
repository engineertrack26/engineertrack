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

DROP POLICY IF EXISTS "advisor writes assignments" ON group_assignments;
CREATE POLICY "advisor writes assignments" ON group_assignments
  FOR ALL TO authenticated
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
