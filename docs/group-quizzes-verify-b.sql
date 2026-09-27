-- Quiz verification B: advisor/student RPC workflow. Run after A.
-- This creates a temporary quiz, attempt and notification, then rolls them back.
-- Requires an active group with a student; otherwise raises SKIP B, not PASS.
BEGIN;
DO $$
DECLARE v_group uuid; v_advisor uuid; v_student uuid; v_outsider uuid; v_quiz uuid;
        v_data jsonb; v_count integer;
BEGIN
  SELECT g.id, g.advisor_id, m.student_id INTO v_group, v_advisor, v_student
  FROM public.internship_groups g JOIN public.group_memberships m ON m.group_id = g.id
  WHERE NOT g.is_archived AND m.left_at IS NULL ORDER BY g.created_at LIMIT 1;
  IF v_group IS NULL THEN RAISE EXCEPTION 'SKIP B: no active group with a student'; END IF;
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
END;
$$;
ROLLBACK;
SELECT 'PASS B: limits, targeted delivery, hidden answers, one attempt and result release' AS result;
