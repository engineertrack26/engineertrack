-- Combined verification retained for reference. For separately visible results,
-- run group-quizzes-verify-a.sql, -b.sql and -c.sql in that order instead.
-- Apply docs/group-quizzes.sql first. Run this complete file in SQL Editor.
-- Read-only outcome: Part B creates a quiz/attempt/notification then ROLLBACKs.
-- Part A: structure and grants. Part B: RPC behaviour with impersonated users.
-- Part C: direct client-table access under the authenticated role.
BEGIN;

DO $$
DECLARE v_name text; v_id uuid; v_bucket record;
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
  RAISE NOTICE 'PASS A: RLS, RPC grants and private images';
END;
$$;

DO $$
DECLARE v_group uuid; v_advisor uuid; v_student uuid; v_outsider uuid; v_quiz uuid;
        v_data jsonb; v_count integer;
BEGIN
  SELECT g.id, g.advisor_id, m.student_id INTO v_group, v_advisor, v_student
  FROM public.internship_groups g JOIN public.group_memberships m ON m.group_id = g.id
  WHERE NOT g.is_archived AND m.left_at IS NULL ORDER BY g.created_at LIMIT 1;
  IF v_group IS NULL THEN
    RAISE NOTICE 'SKIP B: no active group with a student'; RETURN;
  END IF;
  SELECT student_id INTO v_outsider FROM public.group_memberships
    WHERE group_id = v_group AND student_id <> v_student AND left_at IS NULL LIMIT 1;
  IF v_outsider IS NULL THEN
    SELECT id INTO v_outsider FROM public.profiles WHERE id NOT IN (v_advisor, v_student) LIMIT 1;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_advisor,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_advisor::text, true);
  v_quiz := public.quiz_init(v_group);
  BEGIN
    PERFORM public.quiz_save(v_quiz, 'Too many questions', '', NULL, 'selected', ARRAY[v_student],
      (SELECT jsonb_agg(jsonb_build_object('text','Q','options',jsonb_build_array('A','B'),'correct',0))
       FROM generate_series(1, 11)));
    RAISE EXCEPTION 'FAIL B: 11 questions accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'QUIZ_INVALID' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.quiz_save(v_quiz, 'Too many choices', '', NULL, 'selected', ARRAY[v_student],
      '[{"text":"Q","options":["A","B","C","D","E","F"],"correct":0}]'::jsonb);
    RAISE EXCEPTION 'FAIL B: 6 choices accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'QUIZ_INVALID' THEN RAISE; END IF;
  END;
  PERFORM public.quiz_save(v_quiz, 'Verification quiz', '', now() + interval '1 day', 'selected',
    ARRAY[v_student], '[{"text":"One plus one?","options":["2","3"],"correct":0}]'::jsonb);
  v_count := public.quiz_publish(v_quiz);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL B: target count %', v_count; END IF;
  IF (SELECT count(*) FROM public.notifications WHERE type = 'quiz_available'
    AND data->>'quizId' = v_quiz::text AND user_id = v_student) <> 1 THEN
    RAISE EXCEPTION 'FAIL B: targeted notification missing';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_student,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_student::text, true);
  v_data := public.quiz_detail(v_quiz);
  IF v_data->'questions'->0 ? 'correct' OR v_data->>'score' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL B: answer or score leaked before close';
  END IF;
  BEGIN
    PERFORM public.quiz_save_answers(v_quiz, '{}'::jsonb, true);
    RAISE EXCEPTION 'FAIL B: incomplete submission accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'QUIZ_INCOMPLETE' THEN RAISE; END IF;
  END;
  PERFORM public.quiz_save_answers(v_quiz, '{"0":0}'::jsonb, false);
  PERFORM public.quiz_save_answers(v_quiz, '{"0":0}'::jsonb, true);
  BEGIN
    PERFORM public.quiz_save_answers(v_quiz, '{"0":1}'::jsonb, true);
    RAISE EXCEPTION 'FAIL B: second attempt accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'QUIZ_ALREADY_SUBMITTED' THEN RAISE; END IF;
  END;
  IF v_outsider IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',v_outsider,'role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
    BEGIN
      PERFORM public.quiz_detail(v_quiz);
      RAISE EXCEPTION 'FAIL B: outsider read the quiz';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'QUIZ_FORBIDDEN' THEN RAISE; END IF;
    END;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_advisor,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_advisor::text, true);
  PERFORM public.quiz_close(v_quiz);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_student,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_student::text, true);
  v_data := public.quiz_detail(v_quiz);
  IF (v_data->>'score')::integer <> 1 OR (v_data->'questions'->0->>'correct')::integer <> 0 THEN
    RAISE EXCEPTION 'FAIL B: result not released correctly';
  END IF;
  RAISE NOTICE 'PASS B: 10/5 limits, selected delivery, hidden answer, complete single attempt, outsider refusal, closed result';
END;
$$;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.group_quizzes;
    RAISE EXCEPTION 'FAIL C: client read raw quiz answers';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.group_quiz_attempts(quiz_id, student_id) VALUES (gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'FAIL C: direct attempt insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS C: client cannot read answers or write attempts directly';
END;
$$;
RESET ROLE;
ROLLBACK;
