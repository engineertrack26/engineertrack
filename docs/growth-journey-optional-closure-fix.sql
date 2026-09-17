-- Narrow repair: closure is optional. No records, triggers or XP are changed.
BEGIN;
CREATE OR REPLACE FUNCTION public.my_growth_journey()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE student uuid := auth.uid(); grp uuid; groups_count int; approved int; available int;
  improved int; journals int; weeks int; reached int; targets int; planned_days int := 0;
  planned_weeks int := 0; ready boolean := false; closed boolean; sp public.student_profiles%ROWTYPE;
BEGIN
  IF student IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=student AND role='student') THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN';
  END IF;
  SELECT count(*), (array_agg(m.group_id))[1] INTO groups_count, grp
    FROM public.group_memberships m WHERE m.student_id=student AND m.left_at IS NULL;
  IF groups_count > 1 THEN RAISE EXCEPTION 'GROWTH_MULTIPLE_GROUPS'; END IF;
  IF groups_count = 0 THEN RETURN jsonb_build_object('groupId', NULL); END IF;
  SELECT * INTO sp FROM public.student_profiles WHERE id=student;
  ready := sp.mentor_id IS NOT NULL AND nullif(btrim(sp.company_name),'') IS NOT NULL
    AND sp.internship_start_date IS NOT NULL AND sp.internship_end_date >= sp.internship_start_date;
  IF sp.internship_end_date >= sp.internship_start_date THEN
    -- Calendar envelope, not an attendance obligation. Holidays are not assumed.
    planned_weeks := LEAST(104, (sp.internship_end_date-sp.internship_start_date)/7 + 1);
    planned_days := LEAST(730, sp.internship_end_date-sp.internship_start_date + 1);
  END IF;
  SELECT count(*) INTO available FROM public.group_assignments WHERE group_id=grp AND published_at IS NOT NULL;
  SELECT count(DISTINCT a.id), count(DISTINCT a.id) FILTER(WHERE coalesce(p.improved,false)) INTO approved, improved
    FROM public.assignment_submissions s JOIN public.group_assignments a ON a.id=s.assignment_id
    LEFT JOIN public.growth_submission_path p ON p.submission_id=s.id
    WHERE s.student_id=student AND a.group_id=grp AND a.published_at IS NOT NULL AND s.status='approved';
  SELECT count(DISTINCT d.day_date) INTO journals
    FROM public.internship_days d JOIN public.internship_placements p ON p.id=d.placement_id
    WHERE d.student_id=student AND p.group_id=grp AND d.attendance IN ('present','partial')
      AND NOT d.correction_requested AND d.log_status='submitted'
      AND nullif(btrim(d.experience),'') IS NOT NULL AND nullif(btrim(d.learning),'') IS NOT NULL
      AND d.support_level BETWEEN 0 AND 3;
  -- Stable first-submit timestamps come from XP transactions, not mutable
  -- submitted_at. Count only currently approved tasks and verified journals.
  -- UTC ISO weeks for tasks; placement-local day dates for journals, explicit UI rule.
  SELECT count(*) INTO weeks FROM (
    SELECT date_trunc('week', x.created_at AT TIME ZONE 'UTC')::date AS week
      FROM public.assignment_submissions s JOIN public.group_assignments a ON a.id=s.assignment_id
      JOIN public.xp_transactions x ON x.student_id=s.student_id AND x.reason='assignment_submitted:' || s.id::text
      WHERE s.student_id=student AND a.group_id=grp AND a.published_at IS NOT NULL AND s.status='approved'
    UNION
    SELECT date_trunc('week', d.day_date::timestamp)::date
      FROM public.internship_days d JOIN public.internship_placements p ON p.id=d.placement_id
      WHERE d.student_id=student AND p.group_id=grp AND d.attendance IN ('present','partial')
        AND NOT d.correction_requested AND d.log_status='submitted'
        AND nullif(btrim(d.experience),'') IS NOT NULL AND nullif(btrim(d.learning),'') IS NOT NULL
        AND d.support_level BETWEEN 0 AND 3
  ) active_weeks;
  -- Reuse the official authority; no self-rating based promotion.
  SELECT count(*), count(*) FILTER(WHERE current_level >= target_level AND target_level > 0)
    INTO targets, reached FROM public.get_competency_progress(student);
  -- Closure can be deployed separately. NULL means unavailable, not unfinished.
  -- Dynamic SQL avoids resolving a relation that is absent in older projects.
  IF to_regclass('public.internship_closures') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.internship_closures c
      WHERE c.student_id=$1 AND c.group_id=$2 AND c.reopened_at IS NULL AND c.report_version > 0)'
      INTO closed USING student, grp;
  ELSE
    closed := NULL;
  END IF;
  RETURN jsonb_build_object('groupId',grp,'approvedTasks',approved,'availableTasks',available,
    'improvedTasks',improved,'reflectiveDays',journals,'activeWeeks',weeks,
    'competenciesReached',reached,'competenciesTotal',targets,'plannedDays',planned_days,
    'plannedWeeks',planned_weeks,'prepared',coalesce(ready,false),'closed',closed);
END;
$$;
REVOKE ALL ON FUNCTION public.my_growth_journey() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_growth_journey() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
