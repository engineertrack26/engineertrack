-- docs/internship-groups-rls-fix.sql
-- Run AFTER docs/internship-groups-migration.sql and
-- docs/internship-groups-rpcs.sql. Idempotent; safe to re-run.
--
-- Three RLS holes found by the whole-branch review, all of them live.
-- Nothing here changes a function's return type, so no DROP FUNCTION is
-- needed and re-running is harmless.

-- ============================================
-- 1. leaderboard_public was world-readable
-- ============================================
-- The policy was `USING (true)`, so any authenticated user could run
-- `select * from leaderboard_public` and read EVERY student's full surname,
-- XP, level and streak, across every group, without ever calling the RPC.
-- That made get_my_group_leaderboard's surname masking cosmetic: the RPC
-- returns an initial, but the table behind it returned the whole name to
-- anyone who asked it directly.
--
-- No application code reads this table directly — every read goes through
-- get_my_group_leaderboard, which is SECURITY DEFINER and therefore bypasses
-- RLS. Removing the policy closes the back door and breaks nothing. This is
-- the same reasoning that kept an INSERT policy off group_memberships.
DROP POLICY IF EXISTS "leaderboard_public_select" ON leaderboard_public;

-- ============================================
-- 2. profiles_public was world-readable
-- ============================================
-- Same `USING (true)`, so closing the leaderboard alone would not have made
-- the surname masking real — the full name was still one query away here.
--
-- "Do we share an active group?" — either direction, advisor or student.
CREATE OR REPLACE FUNCTION shares_group_with(target UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM internship_groups g
    WHERE (
      g.advisor_id = auth.uid()
      OR EXISTS (SELECT 1 FROM group_memberships m
                 WHERE m.group_id = g.id AND m.left_at IS NULL AND m.student_id = auth.uid())
    )
    AND (
      g.advisor_id = target
      OR EXISTS (SELECT 1 FROM group_memberships m
                 WHERE m.group_id = g.id AND m.left_at IS NULL AND m.student_id = target)
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS "profiles_public_select" ON profiles_public;
CREATE POLICY "profiles_public_select" ON profiles_public
  FOR SELECT TO authenticated USING (
    id = auth.uid()
    OR shares_group_with(id)
    -- A mentor or advisor reading a student they supervise.
    OR is_mentor_of(id)
    OR is_advisor_of(id)
    -- The reverse: a student reading the mentor or advisor linked to them.
    -- Without this the student profile shows the advisor's name in one card
    -- and blank in the next, because every other disjunct only ever grants a
    -- supervisor read access to a student, never the other way round.
    OR EXISTS (
      SELECT 1 FROM student_profiles sp
      WHERE sp.id = auth.uid()
        AND (sp.mentor_id = profiles_public.id OR sp.advisor_id = profiles_public.id)
    )
  );

-- ============================================
-- 3. An advisor could reassign a membership to any student
-- ============================================
-- The UPDATE policy had no WITH CHECK. Postgres then reuses USING for the new
-- row, and USING only constrained group_id — never student_id. So an advisor
-- holding any membership row in their own group could rewrite its student_id
-- to an arbitrary user and clear left_at, silently making someone an active
-- member of a group they never joined and never consented to. The join-code
-- model exists precisely to make that consent explicit.
--
-- Closing now goes through a function, exactly as opening already does. The
-- function writes left_at and nothing else, so the identity on the row cannot
-- move at all.
DROP POLICY IF EXISTS "advisor closes membership" ON group_memberships;

CREATE OR REPLACE FUNCTION close_membership(p_membership_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT g.advisor_id INTO owner
  FROM group_memberships m
  JOIN internship_groups g ON g.id = m.group_id
  WHERE m.id = p_membership_id;

  IF owner IS NULL THEN
    RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND';
  END IF;

  IF owner <> auth.uid() THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  -- left_at only. student_id and group_id are never written here, which is
  -- the whole point of routing this through a function.
  UPDATE group_memberships m
  SET left_at = now()
  WHERE m.id = p_membership_id AND m.left_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION close_membership(UUID) TO authenticated;
