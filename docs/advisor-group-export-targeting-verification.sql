-- Run after re-applying advisor-group-export-migration.sql on a database with
-- assignment-targeting.sql. Read-only. The SQL Editor executes as an owner;
-- impersonating the advisor below tests report contents, not table RLS.

DO $$
DECLARE g record; report jsonb; expected_count integer; actual_count integer;
        missing_count integer; extra_count integer; group_count integer := 0;
        selected_count integer := 0;
BEGIN
  IF to_regprocedure('public.advisor_group_export(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: advisor_group_export missing';
  END IF;
  IF has_function_privilege('anon', 'public.advisor_group_export(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute advisor_group_export';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.advisor_group_export(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute advisor_group_export';
  END IF;

  FOR g IN SELECT id, advisor_id FROM public.internship_groups ORDER BY id LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', g.advisor_id, 'role', 'authenticated')::text, true);
    report := public.advisor_group_export(g.id);
    IF report->>'exportVersion' IS DISTINCT FROM '2' THEN
      RAISE EXCEPTION 'FAIL: outdated export for group %', g.id;
    END IF;
    IF jsonb_typeof(report->'submissions') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'FAIL: missing submissions array for group %', g.id;
    END IF;

    WITH expected AS (
      SELECT m.student_id, a.id AS task_id
      FROM (SELECT DISTINCT student_id FROM public.group_memberships WHERE group_id = g.id) m
      JOIN public.group_assignments a ON a.group_id = g.id AND a.published_at IS NOT NULL
      LEFT JOIN public.assignment_submissions s ON s.assignment_id = a.id AND s.student_id = m.student_id
      WHERE s.id IS NOT NULL OR (
        EXISTS (SELECT 1 FROM public.group_memberships gm WHERE gm.group_id = g.id
          AND gm.student_id = m.student_id AND (gm.left_at IS NULL OR a.published_at <= gm.left_at))
        AND (a.audience = 'group' OR (a.audience = 'selected' AND
          EXISTS (SELECT 1 FROM public.assignment_targets tg
                  WHERE tg.assignment_id = a.id AND tg.student_id = m.student_id)))
      )
    ), actual AS (
      SELECT (x.value->>'studentId')::uuid AS student_id,
             (x.value->>'taskId')::uuid AS task_id
      FROM jsonb_array_elements(report->'submissions') x
    )
    SELECT (SELECT count(*) FROM expected), (SELECT count(*) FROM actual),
      (SELECT count(*) FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) m),
      (SELECT count(*) FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) e)
      INTO expected_count, actual_count, missing_count, extra_count;
    IF expected_count <> actual_count OR missing_count <> 0 OR extra_count <> 0 THEN
      RAISE EXCEPTION 'FAIL: group % expected %, actual %, missing %, extra %',
        g.id, expected_count, actual_count, missing_count, extra_count;
    END IF;
    group_count := group_count + 1;
    SELECT count(*) INTO expected_count FROM public.group_assignments a
      WHERE a.group_id = g.id AND a.published_at IS NOT NULL AND a.audience = 'selected';
    selected_count := selected_count + expected_count;
  END LOOP;
  RAISE NOTICE 'PASS: % groups, % published selected-audience tasks checked', group_count, selected_count;
  IF selected_count = 0 THEN
    RAISE NOTICE 'SKIP: no selected-audience task exists yet; repeat after one is published';
  END IF;
END;
$$;
