-- docs/join-hardening-migration.sql
-- Slice 2 of partner feedback package A: composite student codes,
-- per-institution e-mail domain rules, and join issue reporting.

-- ============================================
-- 1. Per-institution allowed e-mail domains
-- ============================================
-- An empty array means NO restriction, so every existing institution
-- keeps working untouched.
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS allowed_email_domains TEXT[] NOT NULL DEFAULT '{}';

-- ============================================
-- 2. Join issue reports (append-only audit log)
-- ============================================
CREATE TABLE IF NOT EXISTS join_issue_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  attempted_code  TEXT NOT NULL,
  reason_code     TEXT NOT NULL,
  note            TEXT,
  institution_id  UUID REFERENCES institutions(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE join_issue_reports ENABLE ROW LEVEL SECURITY;

-- No INSERT policy: report_join_issue is the only write path. It is
-- SECURITY DEFINER and runs as the table owner, so it bypasses RLS. Handing
-- clients a direct INSERT would let them skip the RPC's rate limit and note
-- cap and flood the table straight through PostgREST.
DROP POLICY IF EXISTS "own reports insert" ON join_issue_reports;

DROP POLICY IF EXISTS "own reports select" ON join_issue_reports;
CREATE POLICY "own reports select" ON join_issue_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "institution admin select" ON join_issue_reports;
CREATE POLICY "institution admin select" ON join_issue_reports
  FOR SELECT TO authenticated
  USING (
    institution_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM institutions i
      WHERE i.id = join_issue_reports.institution_id
        AND i.admin_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policy: the table is append-only by design.

-- ============================================
-- 3. Student code with its composite parts
-- ============================================
CREATE OR REPLACE FUNCTION get_my_student_code()
RETURNS TABLE (
  code             TEXT,
  institution_code TEXT,
  department_code  TEXT,
  institution_name TEXT,
  department_name  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  RETURN QUERY
  SELECT
    sc.code,
    i.institution_code,
    d.department_code,
    i.name,
    d.name
  FROM student_codes sc
  LEFT JOIN profiles p     ON p.id = sc.student_id
  LEFT JOIN institutions i ON i.id = p.institution_id
  LEFT JOIN departments d  ON d.id = p.department_id
  WHERE sc.student_id = auth.uid()
    AND sc.is_active = true
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_student_code() TO authenticated;

-- ============================================
-- 4. Link a student, accepting short or composite codes
-- ============================================
CREATE OR REPLACE FUNCTION link_student_by_code(p_code TEXT, p_role TEXT)
RETURNS TABLE (student_id UUID, student_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_code            TEXT;
  segments            TEXT[];
  seg_institution     TEXT;
  seg_department      TEXT;
  seg_student         TEXT;
  student_uuid        UUID;
  code_active         BOOLEAN;
  caller_role         TEXT;
  caller_institution  UUID;
  student_institution UUID;
  actual_institution  TEXT;
  actual_department   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT role, institution_id INTO caller_role, caller_institution
  FROM profiles WHERE id = auth.uid();

  IF caller_role NOT IN ('mentor', 'advisor') THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  raw_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));

  IF raw_code = '' THEN
    RAISE EXCEPTION 'INVALID_CODE_FORMAT';
  END IF;

  IF position('_' IN raw_code) > 0 THEN
    segments := string_to_array(raw_code, '_');
    IF array_length(segments, 1) <> 3 THEN
      RAISE EXCEPTION 'INVALID_CODE_FORMAT';
    END IF;
    seg_institution := segments[1];
    seg_department  := segments[2];
    seg_student     := segments[3];
    IF length(seg_institution) <> 8
       OR length(seg_department) <> 6
       OR length(seg_student) <> 6 THEN
      RAISE EXCEPTION 'INVALID_CODE_FORMAT';
    END IF;
  ELSE
    IF length(raw_code) <> 6 THEN
      RAISE EXCEPTION 'INVALID_CODE_FORMAT';
    END IF;
    seg_student := raw_code;
  END IF;

  -- Resolve the student code, distinguishing "never existed" from "deactivated".
  SELECT sc.student_id, sc.is_active
  INTO student_uuid, code_active
  FROM student_codes sc
  WHERE sc.code = seg_student
  ORDER BY sc.is_active DESC, sc.created_at DESC
  LIMIT 1;

  IF student_uuid IS NULL THEN
    RAISE EXCEPTION 'INVALID_CODE';
  END IF;

  IF code_active IS NOT TRUE THEN
    RAISE EXCEPTION 'EXPIRED_CODE';
  END IF;

  -- Composite codes must be internally consistent: segments 1 and 2 have to
  -- match the student's real institution and department. This checks the CODE,
  -- not the caller — mentors are usually from a different (company) institution.
  IF seg_institution IS NOT NULL THEN
    SELECT i.institution_code, d.department_code
    INTO actual_institution, actual_department
    FROM profiles p
    LEFT JOIN institutions i ON i.id = p.institution_id
    LEFT JOIN departments d  ON d.id = p.department_id
    WHERE p.id = student_uuid;

    IF actual_institution IS DISTINCT FROM seg_institution
       OR actual_department IS DISTINCT FROM seg_department THEN
      RAISE EXCEPTION 'CODE_SEGMENT_MISMATCH';
    END IF;
  END IF;

  -- Advisors must share the student's institution; mentors are exempt.
  IF caller_role = 'advisor' THEN
    SELECT institution_id INTO student_institution
    FROM profiles WHERE id = student_uuid;

    IF caller_institution IS NULL
       OR student_institution IS NULL
       OR caller_institution <> student_institution THEN
      RAISE EXCEPTION 'INSTITUTION_MISMATCH';
    END IF;
  END IF;

  IF caller_role = 'mentor' THEN
    UPDATE student_profiles SET mentor_id = auth.uid() WHERE id = student_uuid;
  ELSE
    UPDATE student_profiles SET advisor_id = auth.uid() WHERE id = student_uuid;
  END IF;

  RETURN QUERY
    SELECT p.id, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    FROM profiles p WHERE p.id = student_uuid;
END;
$$;

-- ============================================
-- 5. Join a department, enforcing the institution's domain rule
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

  -- `p.` is load-bearing. RETURNS TABLE declares an OUT parameter named `id`,
  -- so an unqualified `WHERE id = ...` is ambiguous between that variable and
  -- profiles.id, and PostgreSQL raises 42702 rather than picking one. Only the
  -- accepting path reaches this statement, so an unqualified version fails
  -- exactly when a join should have succeeded and never when one is rejected.
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

-- ============================================
-- 6. Report a join or link failure
-- ============================================
-- Returns TRUE when the report reached an institution admin, FALSE when it
-- could only be stored (a wholly invalid code names no institution).
CREATE OR REPLACE FUNCTION report_join_issue(
  p_code   TEXT,
  p_reason TEXT,
  p_note   TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_code     TEXT;
  segments     TEXT[];
  inst_id      UUID;
  admin_uuid   UUID;
  reporter_name TEXT;
  recent_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_reason NOT IN ('INVALID_CODE', 'EMAIL_DOMAIN_BLOCKED', 'CODE_SEGMENT_MISMATCH') THEN
    RAISE EXCEPTION 'INVALID_REASON';
  END IF;

  -- Abuse protection. This RPC writes an append-only row AND pushes a
  -- notification to a named institution admin, so an unbounded caller can
  -- spam a real person. Three reports per five minutes sits far above honest
  -- use (a confused student retries a code two or three times) and far below
  -- anything useful as a flood. The RAISE aborts the transaction, so the
  -- rejected attempt leaves no row behind.
  SELECT count(*) INTO recent_count
  FROM join_issue_reports r
  WHERE r.reporter_id = auth.uid()
    AND r.created_at > now() - interval '5 minutes';

  IF recent_count >= 3 THEN
    RAISE EXCEPTION 'REPORT_RATE_LIMITED';
  END IF;

  IF char_length(trim(coalesce(p_note, ''))) > 500 THEN
    RAISE EXCEPTION 'NOTE_TOO_LONG';
  END IF;

  raw_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));

  -- Resolve the institution, most specific source first.
  IF position('_' IN raw_code) > 0 THEN
    segments := string_to_array(raw_code, '_');
    IF array_length(segments, 1) = 3 THEN
      SELECT i.id INTO inst_id FROM institutions i
      WHERE i.institution_code = segments[1];
    END IF;
  END IF;

  IF inst_id IS NULL THEN
    SELECT d.institution_id INTO inst_id FROM departments d
    WHERE d.department_code = raw_code;
  END IF;

  IF inst_id IS NULL THEN
    SELECT p.institution_id INTO inst_id FROM profiles p WHERE p.id = auth.uid();
  END IF;

  INSERT INTO join_issue_reports (reporter_id, attempted_code, reason_code, note, institution_id)
  VALUES (auth.uid(), raw_code, p_reason, nullif(trim(coalesce(p_note, '')), ''), inst_id);

  IF inst_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT i.admin_id INTO admin_uuid FROM institutions i WHERE i.id = inst_id;
  IF admin_uuid IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
  INTO reporter_name FROM profiles p WHERE p.id = auth.uid();

  INSERT INTO notifications (user_id, title, body, type, data)
  VALUES (
    admin_uuid,
    'Join problem reported',
    coalesce(nullif(reporter_name, ''), 'A user') || ' could not join with code ' || raw_code,
    'general',
    jsonb_build_object('reason', p_reason, 'code', raw_code, 'note', p_note)
  );

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION report_join_issue(TEXT, TEXT, TEXT) TO authenticated;
