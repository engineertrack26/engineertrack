-- docs/internship-groups-rls-recursion-fix.sql
-- Fixes 42P17: infinite recursion detected in policy for relation
-- "internship_groups". Idempotent; safe to re-run.
--
-- THE CYCLE
--
--   internship_groups SELECT policy  reads group_memberships
--   group_memberships SELECT policy  reads internship_groups
--
-- Each subquery is itself subject to the other table's RLS, so evaluating
-- either policy re-enters the other and Postgres aborts with 42P17. Every
-- authenticated read of either table fails — the advisor's group list, the
-- competency scope screen, group-scoped polls.
--
-- WHY IT SURVIVED THE VERIFICATION SCRIPTS
--
-- The Supabase SQL editor runs as the table owner, and an owner bypasses RLS.
-- docs/internship-groups-verification.sql and docs/competency-verification.sql
-- both passed against a database where every authenticated session was broken,
-- because neither ever evaluated a policy. Only the app hit it. That is worth
-- remembering the next time a script "proves" a policy works: asserting that a
-- policy EXISTS is not the same as asserting that it can be EVALUATED.
--
-- THE FIX
--
-- Two SECURITY DEFINER helpers, matching the is_group_advisor_of pattern
-- already in docs/internship-groups-migration.sql:229. A SECURITY DEFINER
-- function runs as its owner, which is the table owner, so the reads inside it
-- are not subject to RLS and cannot re-enter a policy.
--
-- Breaking one side of the cycle would be enough. All five policies that touch
-- these two tables are routed through the helpers anyway, so that no policy
-- body reads either table directly and the cycle cannot be reintroduced by a
-- later edit.

-- ============================================
-- 1. The two helpers
-- ============================================
-- Keyed on the GROUP id. is_group_advisor_of is keyed on a STUDENT id and
-- answers a different question; these are not duplicates of it.

CREATE OR REPLACE FUNCTION owns_group(p_group_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM internship_groups g
    WHERE g.id = p_group_id AND g.advisor_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION is_member_of_group(p_group_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_memberships m
    WHERE m.group_id = p_group_id
      AND m.student_id = auth.uid()
      AND m.left_at IS NULL
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION owns_group(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_member_of_group(UUID) TO authenticated;

-- ============================================
-- 2. The two policies that formed the cycle
-- ============================================

DROP POLICY IF EXISTS "group owner and members read" ON internship_groups;
CREATE POLICY "group owner and members read" ON internship_groups
  FOR SELECT TO authenticated USING (
    advisor_id = auth.uid()
    OR is_member_of_group(id)
  );

DROP POLICY IF EXISTS "membership read" ON group_memberships;
CREATE POLICY "membership read" ON group_memberships
  FOR SELECT TO authenticated USING (
    student_id = auth.uid()
    OR owns_group(group_id)
  );

-- ============================================
-- 3. The three policies dragged into it
-- ============================================
-- These were not the cause, but each reads one of the two tables directly, so
-- each triggered the recursive evaluation. Same rules, expressed through the
-- helpers.

DROP POLICY IF EXISTS "group targets read" ON group_competency_targets;
CREATE POLICY "group targets read" ON group_competency_targets
  FOR SELECT TO authenticated USING (
    owns_group(group_id)
    OR is_member_of_group(group_id)
  );

-- The WITH CHECK is load-bearing: without it an advisor could update a row of
-- their own group to point at a group they do not own, because USING only
-- tests the row as it stood BEFORE the update.
DROP POLICY IF EXISTS "advisor writes group targets" ON group_competency_targets;
CREATE POLICY "advisor writes group targets" ON group_competency_targets
  FOR ALL TO authenticated
  USING (owns_group(group_id))
  WITH CHECK (owns_group(group_id));

-- Unchanged in meaning: active, role-targeted, and group-scoped, where a poll
-- with no group_id is unscoped and visible to everyone whose role matches —
-- which is how mentors, who belong to no group, still see polls at all.
DROP POLICY IF EXISTS "Users can view active polls" ON polls;
CREATE POLICY "Users can view active polls" ON polls
  FOR SELECT USING (
    is_active = TRUE
    AND (
      target_role = 'all'
      OR EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = polls.target_role
      )
    )
    AND (
      polls.group_id IS NULL
      OR is_member_of_group(polls.group_id)
      OR owns_group(polls.group_id)
    )
  );

-- ============================================
-- 4. Assert the cycle is gone
-- ============================================
-- Fails loudly if any policy on these tables still names either table in its
-- own body. Run as the owner this cannot detect recursion by executing it —
-- owners bypass RLS — so it checks the structure instead.
DO $$
DECLARE
  offending TEXT;
BEGIN
  SELECT string_agg(policyname || ' on ' || tablename, ', ') INTO offending
  FROM pg_policies
  WHERE tablename IN ('internship_groups','group_memberships',
                      'group_competency_targets','polls')
    AND (
      coalesce(qual, '') ~ '\minternship_groups\M'
      OR coalesce(qual, '') ~ '\mgroup_memberships\M'
      OR coalesce(with_check, '') ~ '\minternship_groups\M'
      OR coalesce(with_check, '') ~ '\mgroup_memberships\M'
    );

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'a policy still reads a group table directly: %', offending;
  END IF;
END $$;

SELECT 'PASS: no policy reads internship_groups or group_memberships directly' AS result;
