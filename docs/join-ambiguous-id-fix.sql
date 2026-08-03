-- docs/join-ambiguous-id-fix.sql
--
-- Fixes 42702 "column reference \"id\" is ambiguous" in the two join RPCs.
--
-- WHAT WAS WRONG
-- Both functions declare `RETURNS TABLE (id UUID, ...)`, which creates a
-- PL/pgSQL OUT parameter named `id`. Their bodies then ran:
--
--     UPDATE profiles SET ... WHERE id = auth.uid();
--
-- With `plpgsql.variable_conflict` at its default of `error`, PostgreSQL will
-- not choose between the OUT parameter and profiles.id — it raises 42702.
--
-- WHY IT WENT UNNOTICED
-- Every rejection path (unknown code, blocked e-mail domain) raises BEFORE
-- reaching the UPDATE. So the functions behaved correctly whenever they were
-- supposed to refuse, and failed only when they were supposed to succeed. The
-- client maps the raw 42702 through mapRpcError, which has no entry for it, so
-- the user saw the generic errors.unknown message rather than anything that
-- pointed at a join.
--
-- SCOPE
-- Present since docs/admin-migration.sql; docs/join-hardening-migration.sql
-- inherited it verbatim when it rewrote join_department_by_code. Both source
-- files are now corrected, so a fresh environment built from them is fine.
-- This file exists to repair a database those migrations were already applied
-- to. It is idempotent — run it as one submission.
--
-- The read-only validate_institution_code and validate_department_code share
-- the same OUT parameter names but qualify every reference, so they were never
-- affected and are not touched here.
--
-- CREATE OR REPLACE preserves existing privileges, so no GRANTs are repeated.


-- ============================================
-- 1. Join an institution by code
-- ============================================
CREATE OR REPLACE FUNCTION join_institution_by_code(p_code TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  type TEXT,
  faculty TEXT,
  department TEXT,
  city TEXT,
  country TEXT
) AS $$
DECLARE
  inst_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT i.id INTO inst_id
  FROM institutions i
  WHERE i.institution_code = upper(trim(p_code))
  LIMIT 1;

  IF inst_id IS NULL THEN
    RAISE EXCEPTION 'Invalid institution code';
  END IF;

  -- `p.` is the fix.
  UPDATE profiles p
  SET institution_id = inst_id
  WHERE p.id = auth.uid();

  RETURN QUERY
    SELECT i.id, i.name, i.type, i.faculty, i.department, i.city, i.country
    FROM institutions i
    WHERE i.id = inst_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================
-- 2. Join a department by code, enforcing the institution's domain rule
--    (the join-hardening version, with only the UPDATE changed)
-- ============================================
CREATE OR REPLACE FUNCTION join_department_by_code(p_code TEXT)
RETURNS TABLE (
  id              UUID,
  institution_id  UUID,
  name            TEXT,
  department_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dept_id         UUID;
  inst_id         UUID;
  allowed         TEXT[];
  caller_email    TEXT;
  caller_domain   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT d.id, d.institution_id
  INTO dept_id, inst_id
  FROM departments d
  WHERE d.department_code = upper(trim(p_code))
  LIMIT 1;

  IF dept_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CODE';
  END IF;

  SELECT i.allowed_email_domains INTO allowed
  FROM institutions i WHERE i.id = inst_id;

  -- An empty array means no restriction.
  IF allowed IS NOT NULL AND array_length(allowed, 1) > 0 THEN
    SELECT lower(p.email) INTO caller_email FROM profiles p WHERE p.id = auth.uid();

    -- Guard the shape before trusting split_part: an address with more than
    -- one '@' would otherwise let split_part return a fake "domain" that
    -- happens to match, fooling the check into passing an address whose
    -- real mailbox domain is something else entirely.
    IF caller_email IS NULL OR caller_email !~ '^[^@]+@[^@]+$' THEN
      RAISE EXCEPTION 'EMAIL_DOMAIN_BLOCKED:%', array_to_string(allowed, ',');
    END IF;

    caller_domain := split_part(caller_email, '@', 2);

    -- Compare against a lower-cased projection of the stored array so a
    -- writer who saves 'BTU.EDU.TR' doesn't lock out '@btu.edu.tr' users.
    -- The exception payload below still uses `allowed` as stored, so the
    -- message matches what the admin actually typed.
    IF caller_domain = '' OR NOT EXISTS (
      SELECT 1 FROM unnest(allowed) AS d WHERE lower(d) = caller_domain
    ) THEN
      RAISE EXCEPTION 'EMAIL_DOMAIN_BLOCKED:%', array_to_string(allowed, ',');
    END IF;
  END IF;

  -- `p.` is the fix. RETURNS TABLE declares an OUT parameter named `id`, so an
  -- unqualified `WHERE id = ...` is ambiguous against profiles.id and raises
  -- 42702. Only the accepting path reaches here, which is why the bug looked
  -- like "joining silently never works" rather than an obvious error.
  UPDATE profiles p
  SET institution_id = inst_id,
      department_id  = dept_id
  WHERE p.id = auth.uid();

  RETURN QUERY
    SELECT d.id, d.institution_id, d.name, d.department_code
    FROM departments d
    WHERE d.id = dept_id;
END;
$$;


-- Re-run Part C of docs/join-hardening-verification.sql afterwards. Rows 11
-- and 13 are the ones that were failing; 13 is also the case-insensitivity
-- regression test, which has therefore never actually been exercised yet.
