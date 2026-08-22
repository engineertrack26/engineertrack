-- docs/competency-assessment-migration.sql
-- Run AFTER docs/competency-framework-migration.sql. Idempotent.

-- ============================================
-- 1. Which part of the framework a group uses
-- ============================================
-- The row's existence IS the selection. There is no `enabled` flag, which makes
-- "not selected but targeting level 3" unrepresentable rather than merely
-- discouraged.
CREATE TABLE IF NOT EXISTS group_competency_targets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  competency_id UUID NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
  target_level  INT  NOT NULL CHECK (target_level BETWEEN 1 AND 4),
  UNIQUE (group_id, competency_id)
);

ALTER TABLE group_competency_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group targets read" ON group_competency_targets;
CREATE POLICY "group targets read" ON group_competency_targets
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM internship_groups g
            WHERE g.id = group_competency_targets.group_id AND g.advisor_id = auth.uid())
    OR EXISTS (SELECT 1 FROM group_memberships m
               WHERE m.group_id = group_competency_targets.group_id
                 AND m.student_id = auth.uid() AND m.left_at IS NULL)
  );

DROP POLICY IF EXISTS "advisor writes group targets" ON group_competency_targets;
CREATE POLICY "advisor writes group targets" ON group_competency_targets
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM internship_groups g
            WHERE g.id = group_competency_targets.group_id AND g.advisor_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM internship_groups g
            WHERE g.id = group_competency_targets.group_id AND g.advisor_id = auth.uid())
  );

-- ============================================
-- 2. A new group starts with the whole framework
-- ============================================
-- An advisor who never opens the competency screen must not leave their
-- students with an empty framework. Defaulting to all six matches the
-- document's position that they are equally important. Level 2 is the one
-- arbitrary number in this design and is a single constant.
CREATE OR REPLACE FUNCTION seed_group_competency_targets()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO group_competency_targets (group_id, competency_id, target_level)
  SELECT NEW.id, c.id, 2
  FROM competencies c
  ON CONFLICT (group_id, competency_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_seed_group_competency_targets ON internship_groups;
CREATE TRIGGER tr_seed_group_competency_targets
  AFTER INSERT ON internship_groups
  FOR EACH ROW EXECUTE FUNCTION seed_group_competency_targets();

-- Backfill the groups that predate the trigger above -- and ONLY those.
--
-- The row's existence IS the selection, as the header of this file says, so a
-- competency an advisor deliberately unticked is represented by the ABSENCE of
-- a row. `ON CONFLICT DO NOTHING` protects rows that exist; it cannot protect a
-- deliberate absence, because an absent row does not conflict. Without the
-- NOT EXISTS below, re-applying this file would re-insert every unticked
-- competency at level 2 and silently widen a scope the advisor had narrowed.
--
-- That is not hypothetical. app/(advisor)/group-competencies.tsx calls
-- competencyService.setGroupTargets, which DELETEs the group's rows and
-- re-inserts only the ticked ones, precisely so that unticking removes one.
-- And this file is no longer applied once: it declares
-- kpi_observations.assignment_submission_id, which made "re-apply this file"
-- step 1 of the C1 runbook. A one-shot backfill became a standing instruction.
--
-- So the unit of the backfill is the GROUP, not the (group, competency) pair:
-- a group with no targets at all has never been configured and gets the whole
-- framework; a group with even one target has been decided about, by the
-- trigger or by an advisor, and is left exactly as it stands.
--
-- The ON CONFLICT stays as a second belt: it costs nothing and keeps a
-- concurrent seed from turning this into a unique_violation.
INSERT INTO group_competency_targets (group_id, competency_id, target_level)
SELECT g.id, c.id, 2
FROM internship_groups g CROSS JOIN competencies c
WHERE NOT EXISTS (
  SELECT 1 FROM group_competency_targets t WHERE t.group_id = g.id
)
ON CONFLICT (group_id, competency_id) DO NOTHING;

-- ============================================
-- 3. Observations
-- ============================================
CREATE TABLE IF NOT EXISTS kpi_observations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kpi_id      UUID NOT NULL REFERENCES competency_kpis(id) ON DELETE CASCADE,
  log_id      UUID REFERENCES daily_logs(id) ON DELETE SET NULL,
  observed_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kpi_id, log_id, observed_by)
);

CREATE INDEX IF NOT EXISTS kpi_observations_student_idx
  ON kpi_observations(student_id, kpi_id);

-- Which assignment approval produced this observation, if any. A tick from a
-- daily log has log_id set and this null; an observation written by
-- review_assignment has the reverse.
--
-- The column lives here, with the table, rather than in the migration that
-- introduced it (docs/task-assignment-rpcs.sql), because record_kpi_observations
-- below reads it — and that function is defined in docs/competency-rpcs.sql,
-- which runs before any task-assignment file. Declaring it there would have left
-- a function referring to a column that does not exist yet: plpgsql bodies are
-- not checked at CREATE time, so it would create cleanly and fail at the first
-- call, on an install that applied only this subsystem.
--
-- Its FOREIGN KEY to assignment_submissions stays in docs/task-assignment-rpcs.sql,
-- because that table does not exist until then. A bare UUID here is enough for
-- the guard that reads it.
ALTER TABLE kpi_observations
  ADD COLUMN IF NOT EXISTS assignment_submission_id UUID;

ALTER TABLE kpi_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "observations read" ON kpi_observations;
CREATE POLICY "observations read" ON kpi_observations
  FOR SELECT TO authenticated USING (
    student_id = auth.uid()
    OR observed_by = auth.uid()
    OR is_mentor_of(student_id)
    OR is_group_advisor_of(student_id)
  );

-- No INSERT, UPDATE or DELETE policy: record_kpi_observations is the only write
-- path. It is SECURITY DEFINER and writes as the table owner. A direct INSERT
-- would let a client set observed_by to someone else and manufacture the two
-- independent observations a level requires.
DROP POLICY IF EXISTS "observations insert" ON kpi_observations;
