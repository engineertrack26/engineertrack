-- Personal, read-only internship book. Apply after internship-days,
-- task-assignment, competency and group migrations. No table or policy changes.
-- The caller can only retrieve their own history, including archived groups.
BEGIN;
CREATE OR REPLACE FUNCTION public.my_internship_book()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_student uuid := auth.uid();
BEGIN
  IF v_student IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_student AND p.role = 'student'
  ) THEN
    RAISE EXCEPTION 'BOOK_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'student', (SELECT jsonb_build_object(
      'id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name),
      'studentNumber', sp.student_id, 'university', sp.university,
      'department', sp.department, 'company', sp.company_name,
      'startDate', sp.internship_start_date, 'endDate', sp.internship_end_date
    ) FROM public.profiles p JOIN public.student_profiles sp ON sp.id = p.id
      WHERE p.id = v_student),
    'groups', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name, 'term', g.term,
      'joinedAt', m.joined_at, 'leftAt', m.left_at,
      'advisor', concat_ws(' ', ap.first_name, ap.last_name)
    ) ORDER BY m.joined_at, m.id), '[]'::jsonb)
      FROM public.group_memberships m
      JOIN public.internship_groups g ON g.id = m.group_id
      LEFT JOIN public.profiles ap ON ap.id = g.advisor_id
      WHERE m.student_id = v_student),
    'placements', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', pl.id, 'groupId', pl.group_id, 'company', pl.company_name,
      'mentor', concat_ws(' ', mp.first_name, mp.last_name),
      'startDate', pl.start_date, 'endDate', pl.end_date
    ) ORDER BY pl.start_date, pl.id), '[]'::jsonb)
      FROM public.internship_placements pl
      LEFT JOIN public.profiles mp ON mp.id = pl.mentor_id
      WHERE pl.student_id = v_student),
    'days', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'date', d.day_date, 'company', pl.company_name,
      'attendance', d.attendance, 'checkInAt', d.check_in_at,
      'decidedAt', d.attendance_at,
      'decidedBy', concat_ws(' ', ap.first_name, ap.last_name),
      'attendanceNote', d.attendance_note,
      'correctionRequested', d.correction_requested,
      'logStatus', d.log_status, 'submittedAt', d.submitted_at,
      'taskTitle', CASE WHEN d.log_status = 'submitted' THEN d.task_title END,
      'competencyName', CASE WHEN d.log_status = 'submitted' THEN d.competency_name END,
      'experience', CASE WHEN d.log_status = 'submitted' THEN d.experience END,
      'learning', CASE WHEN d.log_status = 'submitted' THEN d.learning END,
      'nextStep', CASE WHEN d.log_status = 'submitted' THEN d.next_step END,
      'supportLevel', CASE WHEN d.log_status = 'submitted' THEN d.support_level END,
      'attachmentName', CASE WHEN d.log_status = 'submitted' THEN d.attachment->>'name' END
    ) ORDER BY d.day_date, d.id), '[]'::jsonb)
      FROM public.internship_days d
      JOIN public.internship_placements pl ON pl.id = d.placement_id
      LEFT JOIN public.profiles ap ON ap.id = d.attendance_by
      WHERE d.student_id = v_student AND pl.student_id = v_student),
    'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'groupId', a.group_id, 'groupName', g.name,
      'title', a.title, 'objective', a.objective, 'criterion', a.criterion,
      'description', a.description, 'status', s.status,
      'submittedAt', s.submitted_at, 'reviewedAt', s.reviewed_at,
      'studentNote', s.student_note, 'reflection', s.reflection,
      'reviewerNote', s.mentor_note, 'reviewedBy', concat_ws(' ', rp.first_name, rp.last_name),
      'selfLevel', s.self_level,
      'reviewerLevel', s.mentor_level
    ) ORDER BY s.submitted_at, s.id), '[]'::jsonb)
      FROM public.assignment_submissions s
      JOIN public.group_assignments a ON a.id = s.assignment_id
      JOIN public.internship_groups g ON g.id = a.group_id
      LEFT JOIN public.profiles rp ON rp.id = s.reviewed_by
      WHERE s.student_id = v_student AND a.published_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.group_memberships m
                    WHERE m.group_id = a.group_id AND m.student_id = v_student)),
    'competencies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'groupId', gt.group_id, 'groupName', g.name, 'name', c.name,
      'targetLevel', gt.target_level,
      'reachedLevel', public.closure_reached_level(v_student, c.id)
    ) ORDER BY g.name, c.display_order), '[]'::jsonb)
      FROM public.group_competency_targets gt
      JOIN public.internship_groups g ON g.id = gt.group_id
      JOIN public.competencies c ON c.id = gt.competency_id
      WHERE EXISTS (SELECT 1 FROM public.group_memberships m
                    WHERE m.group_id = gt.group_id AND m.student_id = v_student))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.my_internship_book() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_internship_book() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
