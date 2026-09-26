-- Run after student-internship-book-migration.sql in the Supabase SQL editor.
-- Read-only; uses existing test accounts and makes no row changes.
-- Part A checks the RPC grant and definer configuration. Part B impersonates
-- a student and, when present, an advisor. It does not prove table RLS, which
-- this migration does not change.

-- Part A: expected one PASS notice.
DO $$
DECLARE f oid;
BEGIN
  f := to_regprocedure('public.my_internship_book()');
  IF f IS NULL THEN RAISE EXCEPTION 'FAIL: my_internship_book missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f AND prosecdef
    AND 'search_path=public' = ANY(proconfig)) THEN
    RAISE EXCEPTION 'FAIL: expected SECURITY DEFINER with fixed search_path';
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute';
  END IF;
  IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute';
  END IF;
  RAISE NOTICE 'PASS: function configuration and grants';
END;
$$;

-- Part B: expected PASS notice; SKIP when no student profile exists.
DO $$
DECLARE v_student uuid; v_advisor uuid; v_result jsonb; v_rejected boolean;
BEGIN
  SELECT p.id INTO v_student FROM public.profiles p
    JOIN public.student_profiles sp ON sp.id = p.id
    WHERE p.role = 'student' ORDER BY p.id LIMIT 1;
  IF v_student IS NULL THEN
    RAISE NOTICE 'SKIP: no student profile to test'; RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
  v_result := public.my_internship_book();
  IF v_result->'student'->>'id' IS DISTINCT FROM v_student::text OR
     jsonb_typeof(v_result->'days') IS DISTINCT FROM 'array' OR
     jsonb_typeof(v_result->'tasks') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'FAIL: student book shape or owner identity';
  END IF;

  SELECT p.id INTO v_advisor FROM public.profiles p WHERE p.role = 'advisor' ORDER BY p.id LIMIT 1;
  IF v_advisor IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_advisor, 'role', 'authenticated')::text, true);
    v_rejected := false;
    BEGIN
      PERFORM public.my_internship_book();
    EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'FAIL: advisor received student book'; END IF;
  END IF;
  RAISE NOTICE 'PASS: student-only book behavior';
END;
$$;
