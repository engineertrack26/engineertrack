-- docs/internship-groups-rpcs.sql
-- Run AFTER docs/internship-groups-migration.sql. Idempotent.

-- ============================================
-- 1. Inspect a group code without joining
-- ============================================
CREATE OR REPLACE FUNCTION validate_group_code(p_code TEXT)
RETURNS TABLE (id UUID, name TEXT, term TEXT, advisor_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  RETURN QUERY
    SELECT g.id, g.name, g.term,
           trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    FROM internship_groups g
    JOIN profiles p ON p.id = g.advisor_id
    WHERE g.join_code = upper(trim(p_code))
      AND g.is_archived = false
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_group_code(TEXT) TO authenticated;

-- ============================================
-- 2. Join a group
-- ============================================
CREATE OR REPLACE FUNCTION join_group_by_code(p_code TEXT)
RETURNS TABLE (id UUID, name TEXT, term TEXT, advisor_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_group UUID;
  archived     BOOLEAN;
  target_advisor UUID;
  caller_role  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT role INTO caller_role FROM profiles WHERE profiles.id = auth.uid();
  IF caller_role <> 'student' THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  SELECT g.id, g.is_archived, g.advisor_id
  INTO target_group, archived, target_advisor
  FROM internship_groups g
  WHERE g.join_code = upper(trim(p_code))
  LIMIT 1;

  IF target_group IS NULL THEN
    RAISE EXCEPTION 'INVALID_CODE';
  END IF;

  IF archived THEN
    RAISE EXCEPTION 'GROUP_ARCHIVED';
  END IF;

  -- Close any current membership first. The partial unique index would
  -- reject the insert below otherwise, and closing rather than deleting is
  -- what preserves the previous term's logs and reviews.
  UPDATE group_memberships m
  SET left_at = now()
  WHERE m.student_id = auth.uid() AND m.left_at IS NULL;

  INSERT INTO group_memberships (group_id, student_id)
  VALUES (target_group, auth.uid());

  -- Everything the advisor's existing screens read hangs off advisor_id, so
  -- validation, student-monitor and reports keep working unchanged.
  UPDATE student_profiles sp
  SET advisor_id = target_advisor
  WHERE sp.id = auth.uid();

  RETURN QUERY
    SELECT g.id, g.name, g.term,
           trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    FROM internship_groups g
    JOIN profiles p ON p.id = g.advisor_id
    WHERE g.id = target_group;
END;
$$;

GRANT EXECUTE ON FUNCTION join_group_by_code(TEXT) TO authenticated;

-- ============================================
-- 3. Link a student — mentors only
-- ============================================
-- docs/internship-groups-migration.sql dropped the previous definitions of
-- this and get_my_student_code, so these are creates, not replaces. That drop
-- is required rather than tidy: get_my_student_code goes from five result
-- columns to one, and CREATE OR REPLACE cannot change a return type.
-- The advisor branch is gone: advisors acquire students through group
-- membership and never link individually. INSTITUTION_MISMATCH and the
-- composite-code segment checks went with the institution model.
CREATE OR REPLACE FUNCTION link_student_by_code(p_code TEXT, p_role TEXT)
RETURNS TABLE (student_id UUID, student_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_code     TEXT;
  student_uuid UUID;
  code_active  BOOLEAN;
  caller_role  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT role INTO caller_role FROM profiles WHERE profiles.id = auth.uid();

  IF caller_role <> 'mentor' THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  raw_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));

  IF length(raw_code) <> 6 THEN
    RAISE EXCEPTION 'INVALID_CODE_FORMAT';
  END IF;

  SELECT sc.student_id, sc.is_active
  INTO student_uuid, code_active
  FROM student_codes sc
  WHERE sc.code = raw_code
  ORDER BY sc.is_active DESC, sc.created_at DESC
  LIMIT 1;

  IF student_uuid IS NULL THEN
    RAISE EXCEPTION 'INVALID_CODE';
  END IF;

  IF code_active IS NOT TRUE THEN
    RAISE EXCEPTION 'EXPIRED_CODE';
  END IF;

  UPDATE student_profiles sp SET mentor_id = auth.uid() WHERE sp.id = student_uuid;

  RETURN QUERY
    SELECT p.id, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    FROM profiles p WHERE p.id = student_uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION link_student_by_code(TEXT, TEXT) TO authenticated;

-- ============================================
-- 4. The student's own code — no composite parts any more
-- ============================================
CREATE OR REPLACE FUNCTION get_my_student_code()
RETURNS TABLE (code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  RETURN QUERY
    SELECT sc.code
    FROM student_codes sc
    WHERE sc.student_id = auth.uid() AND sc.is_active = true
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_student_code() TO authenticated;

-- ============================================
-- 5. Leaderboard, scoped to the caller's active group
-- ============================================
-- The caller's group is resolved internally rather than passed in, so nobody
-- can read another group's ranking by supplying its id.
--
-- The surname is reduced to an initial HERE rather than in the client. The
-- screen has always displayed "Ada Y.", but an earlier version of this
-- function returned the whole surname, so the masking was cosmetic — the full
-- name still reached every group member's device and anyone reading the
-- response could recover it. The privacy notice promises an initial, so the
-- function returns an initial.
--
-- DROP before CREATE is required, not tidiness: this changes the result
-- column from last_name to last_initial, and CREATE OR REPLACE cannot change
-- a function's return type.
DROP FUNCTION IF EXISTS get_my_group_leaderboard(INT);

CREATE OR REPLACE FUNCTION get_my_group_leaderboard(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id             UUID,
  total_xp       INTEGER,
  current_level  INTEGER,
  current_streak INTEGER,
  first_name     TEXT,
  last_initial   TEXT,
  avatar_url     TEXT
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

  SELECT m.group_id INTO my_group
  FROM group_memberships m
  WHERE m.student_id = auth.uid() AND m.left_at IS NULL
  LIMIT 1;

  -- A student who has not joined a group yet sees an empty board, not an
  -- error: the leaderboard is a dashboard tab, not an action they took.
  IF my_group IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT lp.id, lp.total_xp, lp.current_level, lp.current_streak,
           lp.first_name,
           CASE WHEN coalesce(lp.last_name, '') = '' THEN ''
                ELSE upper(left(lp.last_name, 1)) END,
           lp.avatar_url
    FROM leaderboard_public lp
    JOIN group_memberships m
      ON m.student_id = lp.id AND m.left_at IS NULL
    WHERE m.group_id = my_group
    ORDER BY lp.total_xp DESC
    LIMIT greatest(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_group_leaderboard(INT) TO authenticated;
