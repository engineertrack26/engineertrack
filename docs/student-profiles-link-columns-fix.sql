-- ============================================
-- student_profiles.mentor_id / advisor_id are relationship columns written
-- only by SECURITY DEFINER RPCs (link_student_by_code, join_group_by_code).
-- The v1 column grant let a student set them directly from the client, which
-- would let them pull anyone into their case thread (conversations v2) and
-- bind themselves to any mentor. Column REVOKE cannot narrow a column grant
-- list, so the grants are re-issued without the two columns. Idempotent.
-- Apply once, after docs/gamification-server-side-migration.sql.
-- ============================================
REVOKE INSERT, UPDATE ON student_profiles FROM anon, authenticated;
GRANT INSERT (
  id, university, faculty, department, department_branch, student_id,
  internship_start_date, internship_end_date,
  company_name, company_address, company_sector
) ON student_profiles TO authenticated;
GRANT UPDATE (
  university, faculty, department, department_branch, student_id,
  internship_start_date, internship_end_date,
  company_name, company_address, company_sector
) ON student_profiles TO authenticated;

-- Verification: expected one row PASS.
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'student_profiles', 'mentor_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'student_profiles', 'advisor_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'student_profiles', 'mentor_id', 'INSERT')
     OR has_column_privilege('authenticated', 'student_profiles', 'advisor_id', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: authenticated can still write mentor_id / advisor_id';
  END IF;
  IF NOT has_column_privilege('authenticated', 'student_profiles', 'company_name', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: the internship form columns lost their grant';
  END IF;
END $$;
SELECT 'PASS: link columns are RPC-only' AS result;
