-- Read-only avatar display for advisors' active group members.
-- Requires student-avatar-migration.sql. Does not grant table access or write XP.
BEGIN;
CREATE OR REPLACE FUNCTION public.advisor_student_avatars(p_group_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'advisor'
  ) THEN RAISE EXCEPTION 'AVATAR_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.internship_groups WHERE id = p_group_id AND advisor_id = auth.uid()
  ) THEN RAISE EXCEPTION 'AVATAR_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'studentId', p.id, 'avatarId', a.avatar_id,
      'level', public.calculate_level(coalesce(s.total_xp, 0))
    )), '[]'::jsonb)
    FROM public.profiles p
    JOIN public.student_avatar_preferences a ON a.student_id = p.id
    LEFT JOIN public.student_profiles s ON s.id = p.id
    WHERE p.role = 'student' AND EXISTS (
      SELECT 1 FROM public.group_memberships m
      JOIN public.internship_groups g ON g.id = m.group_id
      WHERE m.student_id = p.id AND m.left_at IS NULL
        AND g.advisor_id = auth.uid()
        AND (p_group_id IS NULL OR g.id = p_group_id)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.advisor_student_avatars(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advisor_student_avatars(uuid) TO authenticated;
COMMIT;
