-- docs/message-contact-labels.sql — idempotent. Apply after
-- docs/direct-messages-rpcs.sql.
--
-- NEW HOME of list_message_contacts. It was defined in
-- docs/direct-messages-rpcs.sql; that file now carries a note pointing here,
-- the same way open_conversation / send_message moved to
-- docs/internship-closure-guards.sql. Re-running the old file would put the
-- label-less version back, so this one goes last.
--
-- Why: the picker showed a mentor as nothing but "Mentor". An advisor knows
-- their students by name but has no reason to remember which workplace mentor
-- belongs to which student, so the row now carries the pairing: a mentor is
-- listed with the students they mentor IN THIS GROUP, a student with their
-- mentor. `pairs` is an array because a mentor may have more than one student
-- in the same group; it is empty for the advisor and for a student who has
-- not linked a mentor yet.

CREATE OR REPLACE FUNCTION list_message_contacts(p_group_id UUID)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', pp.id,
    'name', trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')),
    'role', pp.role,
    'pairs', coalesce((
      SELECT jsonb_agg(trim(coalesce(other.first_name, '') || ' ' || coalesce(other.last_name, ''))
                       ORDER BY other.first_name, other.last_name)
      FROM group_memberships m2
      JOIN student_profiles sp2 ON sp2.id = m2.student_id
      -- For a mentor row: the students of this group they mentor.
      -- For a student row: the mentor of that student.
      JOIN profiles_public other
        ON other.id = CASE WHEN pp.role = 'mentor' THEN sp2.id ELSE sp2.mentor_id END
      WHERE m2.group_id = p_group_id AND m2.left_at IS NULL
        AND ((pp.role = 'mentor'  AND sp2.mentor_id = pp.id)
          OR (pp.role = 'student' AND sp2.id = pp.id AND sp2.mentor_id IS NOT NULL))
    ), '[]'::jsonb)
  )
  FROM (
    SELECT g.advisor_id AS id FROM internship_groups g WHERE g.id = p_group_id
    UNION SELECT m.student_id FROM group_memberships m WHERE m.group_id = p_group_id AND m.left_at IS NULL
    UNION SELECT sp.mentor_id FROM group_memberships m JOIN student_profiles sp ON sp.id = m.student_id
          WHERE m.group_id = p_group_id AND m.left_at IS NULL AND sp.mentor_id IS NOT NULL
  ) cand
  JOIN profiles_public pp ON pp.id = cand.id
  WHERE cand.id <> auth.uid() AND can_message(p_group_id, auth.uid(), cand.id) IS NOT NULL
  ORDER BY pp.role, pp.first_name, pp.last_name;
END;
$$;
GRANT EXECUTE ON FUNCTION list_message_contacts(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION list_message_contacts(UUID) FROM PUBLIC, anon;

-- Verification (expected: one NOTICE, no exception)
DO $$
BEGIN
  IF to_regprocedure('public.list_message_contacts(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: list_message_contacts missing'; END IF;
  IF NOT has_function_privilege('authenticated', 'list_message_contacts(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot call list_message_contacts'; END IF;
  IF has_function_privilege('anon', 'list_message_contacts(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can call list_message_contacts'; END IF;
  RAISE NOTICE 'PASS: contact rows now carry their pairing';
END $$;
NOTIFY pgrst, 'reload schema';
