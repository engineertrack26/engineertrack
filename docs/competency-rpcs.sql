-- docs/competency-rpcs.sql
-- Run AFTER both competency migrations. Idempotent.
--
-- Every column reference inside these functions is alias-qualified. RETURNS
-- TABLE (level INT, …) creates a PL/pgSQL variable named `level`, and an
-- unqualified `WHERE level = …` raises 42702 — a bug that shipped in this
-- codebase once and survived months, because it only fires on the success path.

-- ============================================
-- 1. Who may look at whose progress
-- ============================================
CREATE OR REPLACE FUNCTION can_view_competency(p_student_id UUID)
RETURNS BOOLEAN AS $$
  SELECT p_student_id = auth.uid()
      OR is_mentor_of(p_student_id)
      OR is_group_advisor_of(p_student_id);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- 2. Current and target level per competency
-- ============================================
CREATE OR REPLACE FUNCTION get_competency_progress(p_student_id UUID)
RETURNS TABLE (
  competency_id   UUID,
  competency_code TEXT,
  competency_name TEXT,
  current_level   INT,
  target_level    INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_group UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT can_view_competency(p_student_id) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  SELECT m.group_id INTO my_group
  FROM group_memberships m
  WHERE m.student_id = p_student_id AND m.left_at IS NULL
  LIMIT 1;

  -- A student not in a group has no framework yet. Empty, not an error: this
  -- feeds a dashboard, not an action they took.
  IF my_group IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH demonstrated AS (
    -- Two observations from someone OTHER than the student. The exclusion is
    -- the whole reason a student cannot promote themselves, and it needs no
    -- extra column: a self-observation is exactly observed_by = student_id.
    SELECT k.id AS kid, k.competency_id AS cid, k.level AS lvl
    FROM competency_kpis k
    WHERE (
      SELECT count(*) FROM kpi_observations o
      WHERE o.kpi_id = k.id
        AND o.student_id = p_student_id
        AND o.observed_by <> p_student_id
    ) >= 2
  ),
  levels_done AS (
    SELECT d.cid, d.lvl
    FROM demonstrated d
    GROUP BY d.cid, d.lvl
    HAVING count(*) = 2          -- both KPIs of that level
  )
  SELECT t.competency_id, c.code, c.name,
    COALESCE((
      -- The highest L for which every level 1..L is complete. A gap anywhere
      -- below stops the ladder there, so L3 is unreachable without L2.
      SELECT max(candidate.lvl)
      FROM generate_series(1, 4) AS candidate(lvl)
      WHERE NOT EXISTS (
        SELECT 1 FROM generate_series(1, candidate.lvl) AS needed(lvl)
        WHERE NOT EXISTS (
          SELECT 1 FROM levels_done ld
          WHERE ld.cid = t.competency_id AND ld.lvl = needed.lvl
        )
      )
    ), 0)::INT,
    t.target_level
  FROM group_competency_targets t
  JOIN competencies c ON c.id = t.competency_id
  WHERE t.group_id = my_group
  ORDER BY c.display_order;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competency_progress(UUID) TO authenticated;

-- ============================================
-- 3. The KPIs to show on a log right now
-- ============================================
-- Only the two KPIs of each competency's working level — the lowest not yet
-- reached. Showing everything up to the group target would be 24 checkboxes on
-- every daily log. A competency already at its target drops off entirely.
CREATE OR REPLACE FUNCTION get_working_kpis(p_student_id UUID)
RETURNS TABLE (
  kpi_id          UUID,
  competency_id   UUID,
  competency_name TEXT,
  level           INT,
  kpi_index       INT,
  statement       TEXT
)
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

  RETURN QUERY
  SELECT k.id, k.competency_id, c.name, k.level, k.kpi_index, k.statement
  FROM get_competency_progress(p_student_id) AS p
  JOIN competencies c ON c.id = p.competency_id
  JOIN competency_kpis k
    ON k.competency_id = p.competency_id
   AND k.level = p.current_level + 1
  WHERE p.current_level < p.target_level
  ORDER BY c.display_order, k.kpi_index;
END;
$$;

GRANT EXECUTE ON FUNCTION get_working_kpis(UUID) TO authenticated;

-- ============================================
-- 4. Recording ticks
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

  -- Re-saving a log replaces that observer's ticks on it rather than adding to
  -- them, so unticking a box actually removes the observation.
  DELETE FROM kpi_observations o
  WHERE o.student_id = p_student_id
    AND o.log_id IS NOT DISTINCT FROM p_log_id
    AND o.observed_by = auth.uid();

  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by)
  SELECT p_student_id, kid, p_log_id, auth.uid()
  FROM unnest(coalesce(p_kpi_ids, ARRAY[]::UUID[])) AS kid;
END;
$$;

GRANT EXECUTE ON FUNCTION record_kpi_observations(UUID, UUID, UUID[]) TO authenticated;
