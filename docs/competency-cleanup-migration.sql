-- docs/competency-cleanup-migration.sql
-- Run LAST, after the app no longer reads these columns.
--
-- The eight-competency JSONB scoring is replaced by kpi_observations. Both
-- tables survive: self_assessments and mentor_feedbacks still carry
-- reflection_notes, rating, comments and is_approved. Only the scoring goes.

-- Nothing else reads these columns, so no policy, view or function depends on
-- them today — but check before assuming. A policy's qual, a view's
-- definition, or a function's body all hold a hard dependency on every column
-- they name, and dropping one out from under any of those fails 2BP01. On the
-- previous subsystem this project hit 2BP01 three times; one of those was a
-- function dependency, not a column one — a policy that called a function
-- which read the doomed column. A pg_policies-only scan cannot see that.
DO $$
DECLARE
  blocking TEXT;
BEGIN
  SELECT string_agg(src, ', ') INTO blocking FROM (
    SELECT policyname || ' (policy on ' || tablename || ')' AS src
    FROM pg_policies
    WHERE qual LIKE '%competency_ratings%' OR with_check LIKE '%competency_ratings%'
    UNION ALL
    SELECT viewname || ' (view)' FROM pg_views
    WHERE schemaname = 'public' AND definition LIKE '%competency_ratings%'
    UNION ALL
    SELECT p.proname || ' (function)' FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc LIKE '%competency_ratings%'
  ) AS deps;

  IF blocking IS NOT NULL THEN
    RAISE EXCEPTION 'objects still read competency_ratings: %', blocking;
  END IF;
END $$;

ALTER TABLE self_assessments DROP COLUMN IF EXISTS competency_ratings;
ALTER TABLE mentor_feedbacks DROP COLUMN IF EXISTS competency_ratings;
