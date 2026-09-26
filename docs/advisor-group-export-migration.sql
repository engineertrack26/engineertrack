-- Detailed, read-only group export. Run after the group, assignment and
-- internship-days and internship-closure migrations. Archived groups remain
-- readable by their owner.
BEGIN;
CREATE OR REPLACE FUNCTION public.advisor_group_export(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_group record;
BEGIN
  SELECT id, name, term, is_archived INTO v_group
  FROM public.internship_groups WHERE id = p_group_id AND advisor_id = auth.uid();
  IF NOT FOUND OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'REPORT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'groupId', v_group.id, 'groupName', v_group.name,
    'term', v_group.term, 'archived', v_group.is_archived,
    'students', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'studentId', m.student_id, 'name', concat_ws(' ', p.first_name, p.last_name),
      'joinedAt', m.joined_at, 'leftAt', m.left_at
    ) ORDER BY p.first_name, p.last_name, m.student_id, m.joined_at), '[]'::jsonb)
      FROM public.group_memberships m JOIN public.profiles p ON p.id = m.student_id
      WHERE m.group_id = p_group_id),
    'competencies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'studentId', m.student_id, 'name', c.name,
      'targetLevel', gt.target_level,
      'reachedLevel', public.closure_reached_level(m.student_id, c.id)
    ) ORDER BY m.student_id, c.display_order), '[]'::jsonb)
      FROM (SELECT DISTINCT student_id FROM public.group_memberships WHERE group_id = p_group_id) m
      CROSS JOIN public.group_competency_targets gt
      JOIN public.competencies c ON c.id = gt.competency_id
      WHERE gt.group_id = p_group_id),
    'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'taskId', a.id, 'title', a.title, 'objective', a.objective,
      'criterion', a.criterion, 'description', a.description,
      'dueDate', a.due_date, 'publishedAt', a.published_at
    ) ORDER BY a.published_at, a.id), '[]'::jsonb)
      FROM public.group_assignments a
      WHERE a.group_id = p_group_id AND a.published_at IS NOT NULL),
    'submissions', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'taskId', a.id, 'studentId', m.student_id, 'status', coalesce(s.status, 'not_started'),
      'submittedAt', s.submitted_at, 'reviewedAt', s.reviewed_at,
      'studentNote', s.student_note, 'reflection', s.reflection,
      'reviewerNote', s.mentor_note, 'selfLevel', s.self_level,
      'reviewerLevel', s.mentor_level
    ) ORDER BY m.student_id, a.published_at, a.id), '[]'::jsonb)
      FROM (SELECT DISTINCT student_id FROM public.group_memberships WHERE group_id = p_group_id) m
      CROSS JOIN public.group_assignments a
      LEFT JOIN public.assignment_submissions s ON s.assignment_id = a.id AND s.student_id = m.student_id
      WHERE a.group_id = p_group_id AND a.published_at IS NOT NULL
    ),
    'attendanceTotals', (public.internship_group_attendance(p_group_id)->'students'),
    'days', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'studentId', d.student_id, 'date', d.day_date, 'company', pl.company_name,
      'attendance', d.attendance, 'checkInAt', d.check_in_at,
      'decidedAt', d.attendance_at, 'attendanceNote', d.attendance_note,
      'correctionRequested', d.correction_requested, 'logStatus', d.log_status,
      'taskTitle', CASE WHEN d.log_status = 'submitted' THEN d.task_title ELSE NULL END,
      'experience', CASE WHEN d.log_status = 'submitted' THEN d.experience ELSE NULL END,
      'learning', CASE WHEN d.log_status = 'submitted' THEN d.learning ELSE NULL END,
      'nextStep', CASE WHEN d.log_status = 'submitted' THEN d.next_step ELSE NULL END,
      'supportLevel', CASE WHEN d.log_status = 'submitted' THEN d.support_level ELSE NULL END
    ) ORDER BY d.student_id, d.day_date, d.id), '[]'::jsonb)
      FROM public.internship_days d
      JOIN public.internship_placements pl ON pl.id = d.placement_id
      WHERE pl.group_id = p_group_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.advisor_group_export(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advisor_group_export(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
