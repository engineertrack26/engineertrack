-- Quiz verification A: schema, permissions and private image storage.
-- Run after docs/group-quizzes.sql. Read-only; returns one visible result row.
DO $$
DECLARE v_name text; v_bucket record;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['group_quizzes','group_quiz_targets','group_quiz_attempts'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = ('public.' || v_name)::regclass AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'FAIL A: RLS disabled on %', v_name;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || v_name, 'SELECT,INSERT,UPDATE,DELETE') OR
       has_table_privilege('anon', 'public.' || v_name, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'FAIL A: direct table access on %', v_name;
    END IF;
  END LOOP;
  FOREACH v_name IN ARRAY ARRAY['quiz_init(uuid)', 'quiz_save(uuid,text,text,timestamp with time zone,text,uuid[],jsonb)',
    'quiz_publish(uuid)', 'quiz_close(uuid)', 'quiz_delete_draft(uuid)', 'quiz_list_advisor(uuid)',
    'quiz_list_student()', 'quiz_detail(uuid)', 'quiz_save_answers(uuid,jsonb,boolean)',
    'quiz_results(uuid)', 'quiz_can_read(uuid)', 'quiz_image_allowed(text,boolean)'] LOOP
    IF to_regprocedure('public.' || v_name) IS NULL THEN RAISE EXCEPTION 'FAIL A: missing %', v_name; END IF;
    IF has_function_privilege('anon', 'public.' || v_name, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL A: anon can execute %', v_name;
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.' || v_name, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL A: authenticated cannot execute %', v_name;
    END IF;
  END LOOP;
  SELECT * INTO v_bucket FROM storage.buckets WHERE id = 'quiz-images';
  IF NOT FOUND OR v_bucket.public OR v_bucket.file_size_limit <> 5242880 THEN
    RAISE EXCEPTION 'FAIL A: quiz image bucket privacy or size limit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'quiz_images_read') OR NOT EXISTS
    (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'quiz_images_upload') THEN
    RAISE EXCEPTION 'FAIL A: quiz image policies';
  END IF;
END;
$$;
SELECT 'PASS A: schema, RPC grants, RLS and private images' AS result;
