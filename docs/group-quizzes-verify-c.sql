-- Quiz verification C: direct client table access is denied. Run after B.
-- SET LOCAL ROLE is reset when this transaction rolls back; no data persists.
BEGIN;
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
END;
$$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS C: client cannot read raw answers or write attempts directly' AS result;
