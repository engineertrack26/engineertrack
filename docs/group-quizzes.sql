-- Advisor-authored, single-answer group quizzes. Apply after internship groups.
-- This is separate from the retired polls* tables and one-question feed polls.
-- The SQL editor must run this whole file as one submission. Re-runnable.
BEGIN;

CREATE TABLE IF NOT EXISTS public.group_quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.internship_groups(id) ON DELETE CASCADE,
  advisor_id uuid NOT NULL REFERENCES public.profiles(id),
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT 'group' CHECK (audience IN ('group', 'selected')),
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ends_at timestamptz,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(questions) = 'array')
);
CREATE INDEX IF NOT EXISTS group_quizzes_group_idx ON public.group_quizzes(group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.group_quiz_targets (
  quiz_id uuid NOT NULL REFERENCES public.group_quizzes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (quiz_id, student_id)
);
CREATE INDEX IF NOT EXISTS group_quiz_targets_student_idx ON public.group_quiz_targets(student_id);

CREATE TABLE IF NOT EXISTS public.group_quiz_attempts (
  quiz_id uuid NOT NULL REFERENCES public.group_quizzes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  score integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quiz_id, student_id),
  CHECK (jsonb_typeof(answers) = 'object'),
  CHECK (score IS NULL OR score BETWEEN 0 AND 10),
  CHECK ((submitted_at IS NULL) = (score IS NULL))
);

ALTER TABLE public.group_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_quiz_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_quiz_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_quizzes, public.group_quiz_targets, public.group_quiz_attempts FROM PUBLIC, anon, authenticated;

-- Only the owner and an eligible active student may read. A student with an
-- existing attempt retains read access after leaving the group, for their record.
CREATE OR REPLACE FUNCTION public.quiz_can_read(p_quiz_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_quizzes q
    WHERE q.id = p_quiz_id AND (
      q.advisor_id = auth.uid() OR
      (q.published_at IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.group_quiz_attempts a
                WHERE a.quiz_id = q.id AND a.student_id = auth.uid()) OR
        (EXISTS (SELECT 1 FROM public.group_memberships m
                 WHERE m.group_id = q.group_id AND m.student_id = auth.uid() AND m.left_at IS NULL)
         AND (q.audience = 'group' OR EXISTS
           (SELECT 1 FROM public.group_quiz_targets t WHERE t.quiz_id = q.id AND t.student_id = auth.uid())))
      ))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.quiz_init(p_group_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.internship_groups
                 WHERE id = p_group_id AND advisor_id = auth.uid() AND NOT is_archived) THEN
    RAISE EXCEPTION 'QUIZ_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.group_quizzes(group_id, advisor_id) VALUES (p_group_id, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.quiz_save(
  p_id uuid, p_title text, p_description text, p_ends_at timestamptz,
  p_audience text, p_target_ids uuid[], p_questions jsonb
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_quiz public.group_quizzes%ROWTYPE; v_question jsonb; v_option jsonb; v_path text;
        v_clean jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_quiz FROM public.group_quizzes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_quiz.advisor_id <> auth.uid() OR v_quiz.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'QUIZ_NOT_EDITABLE' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.internship_groups WHERE id = v_quiz.group_id AND NOT is_archived) THEN
    RAISE EXCEPTION 'QUIZ_GROUP_ARCHIVED';
  END IF;
  IF length(btrim(coalesce(p_title, ''))) > 120 OR
     length(coalesce(p_description, '')) > 1000 OR
     p_audience NOT IN ('group', 'selected') OR p_audience IS NULL OR
     p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RAISE EXCEPTION 'QUIZ_INVALID';
  END IF;
  IF jsonb_array_length(p_questions) > 10 THEN RAISE EXCEPTION 'QUIZ_INVALID'; END IF;
  IF p_target_ids IS NULL OR array_position(p_target_ids, NULL) IS NOT NULL OR
     cardinality(p_target_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_target_ids) x) OR
     (p_audience = 'group' AND cardinality(p_target_ids) <> 0) THEN
    RAISE EXCEPTION 'QUIZ_TARGETS_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_target_ids) x WHERE NOT EXISTS (
    SELECT 1 FROM public.group_memberships m WHERE m.group_id = v_quiz.group_id
      AND m.student_id = x AND m.left_at IS NULL)) THEN
    RAISE EXCEPTION 'QUIZ_TARGETS_INVALID';
  END IF;
  FOR v_question IN SELECT value FROM jsonb_array_elements(p_questions) LOOP
    IF jsonb_typeof(v_question) <> 'object' OR
       length(coalesce(v_question->>'text', '')) > 500 OR
       jsonb_typeof(v_question->'options') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'QUIZ_INVALID';
    END IF;
    IF jsonb_array_length(v_question->'options') NOT BETWEEN 2 AND 5 THEN
      RAISE EXCEPTION 'QUIZ_INVALID';
    END IF;
    IF v_question ? 'correct' THEN
      IF jsonb_typeof(v_question->'correct') IS DISTINCT FROM 'number' OR
         (v_question->>'correct') !~ '^[0-4]$' THEN RAISE EXCEPTION 'QUIZ_INVALID'; END IF;
      IF (v_question->>'correct')::integer >= jsonb_array_length(v_question->'options') THEN
        RAISE EXCEPTION 'QUIZ_INVALID';
      END IF;
    END IF;
    FOR v_option IN SELECT value FROM jsonb_array_elements(v_question->'options') LOOP
      IF jsonb_typeof(v_option) <> 'string' OR length(v_option #>> '{}') > 200 THEN
        RAISE EXCEPTION 'QUIZ_INVALID';
      END IF;
    END LOOP;
    v_path := nullif(v_question->>'imagePath', '');
    IF v_path IS NOT NULL AND (v_path NOT LIKE p_id::text || '/%' OR
       NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'quiz-images' AND name = v_path)) THEN
      RAISE EXCEPTION 'QUIZ_IMAGE_INVALID';
    END IF;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'text', coalesce(v_question->>'text', ''), 'options', v_question->'options',
      'imagePath', v_path) || CASE WHEN v_question ? 'correct' THEN
      jsonb_build_object('correct', (v_question->>'correct')::integer) ELSE '{}'::jsonb END);
  END LOOP;
  UPDATE public.group_quizzes SET title = btrim(p_title), description = btrim(coalesce(p_description, '')),
    ends_at = p_ends_at, audience = p_audience, questions = v_clean, updated_at = now()
    WHERE id = p_id;
  DELETE FROM public.group_quiz_targets WHERE quiz_id = p_id;
  IF p_audience = 'selected' THEN
    INSERT INTO public.group_quiz_targets(quiz_id, student_id)
      SELECT p_id, x FROM unnest(p_target_ids) x;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.quiz_publish(p_id uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_quiz public.group_quizzes%ROWTYPE; v_count integer; v_question jsonb; v_option text;
BEGIN
  SELECT * INTO v_quiz FROM public.group_quizzes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_quiz.advisor_id <> auth.uid() OR v_quiz.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'QUIZ_NOT_EDITABLE' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.internship_groups WHERE id = v_quiz.group_id AND NOT is_archived) THEN
    RAISE EXCEPTION 'QUIZ_GROUP_ARCHIVED';
  END IF;
  IF v_quiz.title = '' OR jsonb_array_length(v_quiz.questions) NOT BETWEEN 1 AND 10 OR
     (v_quiz.ends_at IS NOT NULL AND v_quiz.ends_at <= now()) THEN
    RAISE EXCEPTION 'QUIZ_INVALID';
  END IF;
  FOR v_question IN SELECT value FROM jsonb_array_elements(v_quiz.questions) LOOP
    IF btrim(coalesce(v_question->>'text', '')) = '' OR NOT (v_question ? 'correct') THEN
      RAISE EXCEPTION 'QUIZ_INVALID';
    END IF;
    IF v_question->>'imagePath' IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM storage.objects WHERE bucket_id = 'quiz-images'
        AND name = v_question->>'imagePath') THEN RAISE EXCEPTION 'QUIZ_IMAGE_INVALID'; END IF;
    FOR v_option IN SELECT value FROM jsonb_array_elements_text(v_question->'options') LOOP
      IF btrim(v_option) = '' THEN RAISE EXCEPTION 'QUIZ_INVALID'; END IF;
    END LOOP;
  END LOOP;
  IF v_quiz.audience = 'selected' AND NOT EXISTS
     (SELECT 1 FROM public.group_quiz_targets WHERE quiz_id = p_id) THEN
    RAISE EXCEPTION 'QUIZ_TARGETS_REQUIRED';
  END IF;
  IF v_quiz.audience = 'selected' AND EXISTS (
    SELECT 1 FROM public.group_quiz_targets t WHERE t.quiz_id = p_id AND NOT EXISTS
      (SELECT 1 FROM public.group_memberships m WHERE m.group_id = v_quiz.group_id
        AND m.student_id = t.student_id AND m.left_at IS NULL)) THEN
    RAISE EXCEPTION 'QUIZ_TARGETS_INVALID';
  END IF;
  UPDATE public.group_quizzes SET published_at = now(), updated_at = now() WHERE id = p_id;
  INSERT INTO public.notifications(user_id, title, body, type, data)
  SELECT DISTINCT m.student_id, 'New quiz', 'Your advisor sent a quiz: ' || left(v_quiz.title, 120),
    'quiz_available', jsonb_build_object('quizId', p_id, 'groupId', v_quiz.group_id)
  FROM public.group_memberships m
  WHERE m.group_id = v_quiz.group_id AND m.left_at IS NULL AND
    (v_quiz.audience = 'group' OR EXISTS
      (SELECT 1 FROM public.group_quiz_targets t WHERE t.quiz_id = p_id AND t.student_id = m.student_id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN RAISE EXCEPTION 'QUIZ_TARGETS_REQUIRED'; END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.quiz_close(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.group_quizzes SET closed_at = now(), updated_at = now()
    WHERE id = p_id AND advisor_id = auth.uid() AND published_at IS NOT NULL AND closed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUIZ_NOT_CLOSABLE' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.quiz_delete_draft(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.group_quizzes WHERE id = p_id AND advisor_id = auth.uid() AND published_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUIZ_NOT_EDITABLE' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.quiz_list_advisor(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.internship_groups WHERE id = p_group_id AND advisor_id = auth.uid()) THEN
    RAISE EXCEPTION 'QUIZ_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'title', q.title, 'description', q.description, 'questionCount', jsonb_array_length(q.questions),
    'audience', q.audience, 'targetCount', (SELECT count(*) FROM public.group_quiz_targets t WHERE t.quiz_id = q.id),
    'submittedCount', (SELECT count(*) FROM public.group_quiz_attempts a WHERE a.quiz_id = q.id AND a.submitted_at IS NOT NULL),
    'endsAt', q.ends_at, 'publishedAt', q.published_at, 'closedAt', q.closed_at
  ) ORDER BY q.created_at DESC), '[]'::jsonb) FROM public.group_quizzes q WHERE q.group_id = p_group_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.quiz_list_student()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'title', q.title, 'description', q.description,
    'questionCount', jsonb_array_length(q.questions), 'endsAt', q.ends_at,
    'submittedAt', a.submitted_at, 'closed', g.is_archived OR q.closed_at IS NOT NULL OR (q.ends_at IS NOT NULL AND q.ends_at <= now()),
    'score', CASE WHEN g.is_archived OR q.closed_at IS NOT NULL OR (q.ends_at IS NOT NULL AND q.ends_at <= now()) THEN a.score ELSE NULL END
  ) ORDER BY q.published_at DESC), '[]'::jsonb)
  FROM public.group_quizzes q
  JOIN public.internship_groups g ON g.id = q.group_id
  LEFT JOIN public.group_quiz_attempts a ON a.quiz_id = q.id AND a.student_id = auth.uid()
  WHERE q.published_at IS NOT NULL AND (
    a.quiz_id IS NOT NULL OR (EXISTS (SELECT 1 FROM public.group_memberships m
      WHERE m.group_id = q.group_id AND m.student_id = auth.uid() AND m.left_at IS NULL)
      AND (q.audience = 'group' OR EXISTS (SELECT 1 FROM public.group_quiz_targets t
        WHERE t.quiz_id = q.id AND t.student_id = auth.uid())))
  );
$$;

CREATE OR REPLACE FUNCTION public.quiz_detail(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.group_quizzes%ROWTYPE; a public.group_quiz_attempts%ROWTYPE;
        v_advisor boolean; v_reveal boolean; v_questions jsonb; v_archived boolean;
BEGIN
  SELECT * INTO q FROM public.group_quizzes WHERE id = p_id;
  IF NOT FOUND OR NOT public.quiz_can_read(p_id) THEN RAISE EXCEPTION 'QUIZ_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  v_advisor := q.advisor_id = auth.uid();
  SELECT is_archived INTO v_archived FROM public.internship_groups WHERE id = q.group_id;
  v_reveal := v_advisor OR v_archived OR q.closed_at IS NOT NULL OR (q.ends_at IS NOT NULL AND q.ends_at <= now());
  IF NOT v_advisor THEN
    SELECT * INTO a FROM public.group_quiz_attempts WHERE quiz_id = p_id AND student_id = auth.uid();
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'text', v.value->>'text', 'options', v.value->'options', 'imagePath', v.value->'imagePath') ||
    CASE WHEN v_reveal AND v.value ? 'correct' THEN
      jsonb_build_object('correct', v.value->'correct') ELSE '{}'::jsonb END
    ORDER BY v.ordinality), '[]'::jsonb)
    INTO v_questions FROM jsonb_array_elements(q.questions) WITH ORDINALITY v;
  RETURN jsonb_build_object('id', q.id, 'groupId', q.group_id, 'title', q.title,
    'description', q.description, 'audience', q.audience, 'endsAt', q.ends_at,
    'publishedAt', q.published_at, 'closedAt', q.closed_at, 'closed',
    v_archived OR q.closed_at IS NOT NULL OR (q.ends_at IS NOT NULL AND q.ends_at <= now()),
    'questions', v_questions, 'answers', CASE WHEN v_advisor THEN '{}'::jsonb ELSE coalesce(a.answers, '{}'::jsonb) END,
    'submittedAt', CASE WHEN v_advisor THEN NULL ELSE a.submitted_at END,
    'score', CASE WHEN v_reveal AND NOT v_advisor THEN a.score ELSE NULL END,
    'targets', CASE WHEN v_advisor THEN (SELECT coalesce(jsonb_agg(t.student_id), '[]'::jsonb)
      FROM public.group_quiz_targets t WHERE t.quiz_id = p_id) ELSE '[]'::jsonb END);
END;
$$;

CREATE OR REPLACE FUNCTION public.quiz_save_answers(p_id uuid, p_answers jsonb, p_submit boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.group_quizzes%ROWTYPE; v_key text; v_value jsonb; v_index integer;
        v_score integer := 0; v_count integer := 0; v_submitted timestamptz;
BEGIN
  SELECT * INTO q FROM public.group_quizzes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR q.published_at IS NULL OR q.closed_at IS NOT NULL OR
     (q.ends_at IS NOT NULL AND q.ends_at <= now()) OR NOT EXISTS (
       SELECT 1 FROM public.group_memberships m JOIN public.internship_groups g ON g.id = m.group_id
         WHERE m.group_id = q.group_id AND m.student_id = auth.uid() AND m.left_at IS NULL AND NOT g.is_archived) OR
     (q.audience = 'selected' AND NOT EXISTS (
       SELECT 1 FROM public.group_quiz_targets t WHERE t.quiz_id = p_id AND t.student_id = auth.uid())) THEN
    RAISE EXCEPTION 'QUIZ_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.group_quiz_attempts
             WHERE quiz_id = p_id AND student_id = auth.uid() AND submitted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'QUIZ_ALREADY_SUBMITTED';
  END IF;
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN RAISE EXCEPTION 'QUIZ_ANSWERS_INVALID'; END IF;
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_answers) LOOP
    IF v_key !~ '^(0|[1-9][0-9]?)$' OR
       jsonb_typeof(v_value) <> 'number' OR v_value::text !~ '^[0-4]$' THEN
      RAISE EXCEPTION 'QUIZ_ANSWERS_INVALID';
    END IF;
    v_index := v_key::integer;
    IF v_index >= jsonb_array_length(q.questions) THEN RAISE EXCEPTION 'QUIZ_ANSWERS_INVALID'; END IF;
    IF (v_value::text)::integer >= jsonb_array_length(q.questions->v_index->'options') THEN
      RAISE EXCEPTION 'QUIZ_ANSWERS_INVALID';
    END IF;
    v_count := v_count + 1;
    IF (v_value::text)::integer = (q.questions->v_index->>'correct')::integer THEN
      v_score := v_score + 1;
    END IF;
  END LOOP;
  IF p_submit AND v_count <> jsonb_array_length(q.questions) THEN
    RAISE EXCEPTION 'QUIZ_INCOMPLETE';
  END IF;
  v_submitted := CASE WHEN p_submit THEN now() ELSE NULL END;
  INSERT INTO public.group_quiz_attempts(quiz_id, student_id, answers, submitted_at, score)
    VALUES (p_id, auth.uid(), p_answers, v_submitted, CASE WHEN p_submit THEN v_score ELSE NULL END)
  ON CONFLICT (quiz_id, student_id) DO UPDATE SET answers = excluded.answers,
    submitted_at = excluded.submitted_at, score = excluded.score, updated_at = now();
  RETURN jsonb_build_object('submittedAt', v_submitted, 'saved', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.quiz_results(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.group_quizzes%ROWTYPE;
BEGIN
  SELECT * INTO q FROM public.group_quizzes WHERE id = p_id;
  IF NOT FOUND OR q.advisor_id <> auth.uid() THEN RAISE EXCEPTION 'QUIZ_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'studentId', m.student_id, 'name', concat_ws(' ', p.first_name, p.last_name),
    'submittedAt', a.submitted_at, 'score', a.score, 'answers', CASE WHEN a.submitted_at IS NOT NULL THEN a.answers ELSE NULL END
  ) ORDER BY p.first_name, p.last_name), '[]'::jsonb)
  FROM (SELECT DISTINCT gm.student_id FROM public.group_memberships gm
    WHERE gm.group_id = q.group_id AND (gm.left_at IS NULL OR q.published_at <= gm.left_at)) m
  JOIN public.profiles p ON p.id = m.student_id
  LEFT JOIN public.group_quiz_attempts a ON a.quiz_id = p_id AND a.student_id = m.student_id
  WHERE q.audience = 'group' OR EXISTS (SELECT 1 FROM public.group_quiz_targets t
    WHERE t.quiz_id = p_id AND t.student_id = m.student_id) OR a.quiz_id IS NOT NULL);
END;
$$;

-- Private images. The exact object path is <quiz UUID>/<random filename>.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('quiz-images', 'quiz-images', false, 5242880,
          ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

CREATE OR REPLACE FUNCTION public.quiz_image_allowed(p_path text, p_write boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_quiz public.group_quizzes%ROWTYPE;
BEGIN
  IF split_part(p_path, '/', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR split_part(p_path, '/', 2) = '' OR split_part(p_path, '/', 3) <> '' THEN RETURN false; END IF;
  v_id := split_part(p_path, '/', 1)::uuid;
  SELECT * INTO v_quiz FROM public.group_quizzes WHERE id = v_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_write THEN RETURN v_quiz.advisor_id = auth.uid() AND v_quiz.published_at IS NULL; END IF;
  RETURN public.quiz_can_read(v_id) AND (
    v_quiz.advisor_id = auth.uid() OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_quiz.questions) x WHERE x->>'imagePath' = p_path));
END;
$$;
DROP POLICY IF EXISTS quiz_images_read ON storage.objects;
CREATE POLICY quiz_images_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'quiz-images' AND public.quiz_image_allowed(name, false));
DROP POLICY IF EXISTS quiz_images_upload ON storage.objects;
CREATE POLICY quiz_images_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quiz-images' AND public.quiz_image_allowed(name, true));
DROP POLICY IF EXISTS quiz_images_delete ON storage.objects;
CREATE POLICY quiz_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'quiz-images' AND public.quiz_image_allowed(name, true));

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN
      ('quiz_can_read','quiz_init','quiz_save','quiz_publish','quiz_close','quiz_delete_draft',
       'quiz_list_advisor','quiz_list_student','quiz_detail','quiz_save_answers',
       'quiz_results','quiz_image_allowed') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.signature);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
