-- docs/closure-report-reviewer-column.sql — idempotent. Apply after
-- docs/review-by-advisor.sql.
--
-- NEW HOME of build_internship_report, which lived in
-- docs/internship-closure-migration.sql. That file now carries a note
-- pointing here. RE-RUNNING internship-closure-migration.sql RESTORES THE
-- OLD "Mentor (avg)" / "Mentor" HEADERS.
--
-- Change: assignment_submissions.mentor_level is written by
-- review_assignment, which docs/review-by-advisor.sql moved to the group's
-- ADVISOR. The report already prints '| Mentor | <workplace mentor> |' from
-- student_profiles.mentor_id (a different person), so a column also called
-- "Mentor" fed from an advisor's rating misattributes the judgement. Do not
-- rename the column to "Advisor" either -- reports built before this change
-- legitimately hold a workplace mentor's ratings. Use the writer-neutral
-- "Reviewer (avg)" / "Reviewer" instead, copied verbatim from the current
-- build_internship_report with only those two header strings changed.
--
-- The dashes and separators below are built with chr() calls because a
-- console paste once corrupted the Unicode literals -- every chr() call is
-- preserved unchanged from the original.
CREATE OR REPLACE FUNCTION build_internship_report(p_student_id UUID, p_group_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_student TEXT; v_mentor TEXT; v_advisor TEXT; v_group TEXT; v_term TEXT; v_company TEXT;
  v_start DATE; v_end DATE; v_version INT; v_att RECORD; v_md TEXT := ''; r RECORD;
  v_j_total INT; v_j0 INT; v_j1 INT; v_j2 INT; v_j3 INT;
BEGIN
  SELECT trim(coalesce(pp.first_name,'')||' '||coalesce(pp.last_name,'')) INTO v_student FROM profiles_public pp WHERE pp.id = p_student_id;
  SELECT trim(coalesce(pp.first_name,'')||' '||coalesce(pp.last_name,'')), sp.company_name, sp.internship_start_date, sp.internship_end_date
    INTO v_mentor, v_company, v_start, v_end
    FROM student_profiles sp LEFT JOIN profiles_public pp ON pp.id = sp.mentor_id WHERE sp.id = p_student_id;
  SELECT g.name, g.term, trim(coalesce(pp.first_name,'')||' '||coalesce(pp.last_name,'')) INTO v_group, v_term, v_advisor
    FROM internship_groups g JOIN profiles_public pp ON pp.id = g.advisor_id WHERE g.id = p_group_id;
  SELECT coalesce(max(report_version), 0) + 1 INTO v_version FROM internship_closures WHERE student_id = p_student_id AND group_id = p_group_id;

  -- Free text (names, company, group, term) can legally contain "|" and would
  -- otherwise break the Markdown table it sits in -- replace, same as r.title
  -- below, never strip, so a stray pipe reads as a slash instead of vanishing.
  v_md := '# Internship report ' || chr(8212) || ' ' || replace(coalesce(v_student, ''), '|', '/') || E'\n\n'
       || '| | |' || E'\n' || '|---|---|' || E'\n'
       || '| Workplace | ' || replace(coalesce(v_company, chr(8212)), '|', '/') || ' |' || E'\n'
       || '| Mentor | ' || replace(coalesce(nullif(v_mentor, ''), chr(8212)), '|', '/') || ' |' || E'\n'
       || '| Advisor | ' || replace(coalesce(v_advisor, chr(8212)), '|', '/') || ' |' || E'\n'
       || '| Group | ' || replace(coalesce(v_group, chr(8212)), '|', '/') || coalesce(' (' || replace(nullif(v_term, ''), '|', '/') || ')', '') || ' |' || E'\n'
       || '| Internship dates | ' || coalesce(v_start::text, chr(8212)) || ' ' || chr(8211) || ' ' || coalesce(v_end::text, chr(8212)) || ' |' || E'\n'
       || '| Closed | ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC by ' || replace(coalesce(v_advisor, chr(8212)), '|', '/') || ' |' || E'\n'
       || '| Report version | ' || v_version || ' |' || E'\n\n';

  -- Competencies: the group's targets, the student's level (closure_reached_level,
  -- the same rule as get_competency_progress: two non-self observations per
  -- KPI, both KPIs of a level, levels climbed in order), self/mentor averages.
  v_md := v_md || '## Competencies' || E'\n\n'
       || '| Competency | Target level | Reached level | Observations | Self (avg) | Reviewer (avg) | Gap |' || E'\n'
       || '|---|---|---|---|---|---|---|' || E'\n';
  FOR r IN
    SELECT c.code, c.name, gt.target_level,
      closure_reached_level(p_student_id, c.id) AS reached,
      (SELECT count(*) FROM kpi_observations o JOIN competency_kpis k ON k.id = o.kpi_id WHERE o.student_id = p_student_id AND k.competency_id = c.id AND o.observed_by <> p_student_id) AS observations,
      (SELECT round(avg(s.self_level)::numeric, 1) FROM assignment_submissions s JOIN group_assignments a ON a.id = s.assignment_id JOIN kpi_triplets t ON t.id = a.triplet_id JOIN competency_kpis k ON k.id = t.kpi_id
         WHERE s.student_id = p_student_id AND a.group_id = p_group_id AND k.competency_id = c.id AND s.status = 'approved' AND s.self_level IS NOT NULL AND s.mentor_level IS NOT NULL) AS avg_self,
      (SELECT round(avg(s.mentor_level)::numeric, 1) FROM assignment_submissions s JOIN group_assignments a ON a.id = s.assignment_id JOIN kpi_triplets t ON t.id = a.triplet_id JOIN competency_kpis k ON k.id = t.kpi_id
         WHERE s.student_id = p_student_id AND a.group_id = p_group_id AND k.competency_id = c.id AND s.status = 'approved' AND s.self_level IS NOT NULL AND s.mentor_level IS NOT NULL) AS avg_mentor
    FROM group_competency_targets gt JOIN competencies c ON c.id = gt.competency_id
    WHERE gt.group_id = p_group_id ORDER BY c.display_order
  LOOP
    v_md := v_md || '| ' || r.name || ' | ' || r.target_level || ' | ' || r.reached || ' | ' || r.observations || ' | '
         || coalesce(r.avg_self::text, chr(8212)) || ' | ' || coalesce(r.avg_mentor::text, chr(8212)) || ' | '
         || coalesce(round(r.avg_mentor - r.avg_self, 1)::text, chr(8212)) || ' |' || E'\n';
  END LOOP;

  -- Tasks: every published assignment of the group.
  v_md := v_md || E'\n' || '## Tasks' || E'\n\n'
       || '| Task | Competency | Status | Self | Reviewer | Approved on |' || E'\n' || '|---|---|---|---|---|---|' || E'\n';
  FOR r IN
    SELECT a.title, c.name AS competency,
      CASE s.status WHEN 'approved' THEN 'approved' WHEN 'needs_revision' THEN 'sent back' WHEN 'submitted' THEN 'awaiting review' ELSE 'not started' END AS status,
      closure_level_word(s.self_level) AS self_word, closure_level_word(s.mentor_level) AS mentor_word,
      -- reviewed_at is set together with status='approved' in review_assignment,
      -- but the column itself is nullable (the schema allows an approved row
      -- with a NULL reviewed_at, and fixtures create such rows) -- coalesce
      -- so that case can never NULL the whole report and fail the INSERT.
      CASE WHEN s.status = 'approved' THEN coalesce(to_char(s.reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), chr(8212)) ELSE chr(8212) END AS approved_on
    FROM group_assignments a
    JOIN kpi_triplets t ON t.id = a.triplet_id JOIN competency_kpis k ON k.id = t.kpi_id JOIN competencies c ON c.id = k.competency_id
    LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.student_id = p_student_id
    WHERE a.group_id = p_group_id AND a.published_at IS NOT NULL ORDER BY a.published_at, a.title
  LOOP
    v_md := v_md || '| ' || replace(r.title, '|', '/') || ' | ' || r.competency || ' | ' || r.status || ' | ' || r.self_word || ' | ' || r.mentor_word || ' | ' || r.approved_on || ' |' || E'\n';
  END LOOP;

  -- Attendance: only when the internship-days module has a placement for the
  -- pair. Wrapped in its own sub-block: a database that never applied that
  -- module (table AND function both missing), or applied only part of it
  -- (table present, function missing), still produces the rest of the report.
  BEGIN
    IF to_regclass('public.internship_placements') IS NOT NULL THEN
      SELECT (x->>'expectedSoFar')::int AS expected, (x->>'recorded')::int AS recorded, (x->>'present')::int AS present, (x->>'partial')::int AS partial,
             (x->>'excused')::int AS excused, (x->>'absent')::int AS absent, (x->>'pending')::int AS pending, (x->>'submittedLogs')::int AS journals
        INTO v_att
        FROM jsonb_array_elements(internship_group_attendance(p_group_id)->'students') x WHERE (x->>'id')::uuid = p_student_id;
      -- Gate on whether a row for this student's id was found at all (FOUND),
      -- not on any one field being non-NULL. Gating on e.g. v_att.recorded
      -- would silently skip this whole section if that key were ever renamed
      -- upstream; gating on FOUND means a key drift shows up as a wrong/zero
      -- number inside a section that is still rendered, not a section that
      -- quietly disappears.
      IF FOUND THEN
        v_md := v_md || E'\n' || '## Attendance' || E'\n\n'
             || '| Working days so far | Recorded | Present | Partial | Excused | Absent | Awaiting decision | Journals submitted |' || E'\n'
             || '|---|---|---|---|---|---|---|---|' || E'\n'
             || '| ' || coalesce(v_att.expected, 0) || ' | ' || coalesce(v_att.recorded, 0) || ' | ' || coalesce(v_att.present, 0) || ' | ' || coalesce(v_att.partial, 0)
             || ' | ' || coalesce(v_att.excused, 0) || ' | ' || coalesce(v_att.absent, 0) || ' | ' || coalesce(v_att.pending, 0) || ' | ' || coalesce(v_att.journals, 0) || ' |' || E'\n';
        SELECT count(*) FILTER (WHERE log_status = 'submitted'),
               count(*) FILTER (WHERE log_status = 'submitted' AND support_level = 0), count(*) FILTER (WHERE log_status = 'submitted' AND support_level = 1),
               count(*) FILTER (WHERE log_status = 'submitted' AND support_level = 2), count(*) FILTER (WHERE log_status = 'submitted' AND support_level = 3)
          INTO v_j_total, v_j0, v_j1, v_j2, v_j3
          FROM internship_days d JOIN internship_placements p ON p.id = d.placement_id WHERE d.student_id = p_student_id AND p.group_id = p_group_id;
        v_md := v_md || E'\n' || '## Journal' || E'\n\n'
             || 'Submitted journals: ' || coalesce(v_j_total, 0) || ' ' || chr(183) || ' Support levels: observed ' || coalesce(v_j0, 0) || ' ' || chr(183) || ' heavy ' || coalesce(v_j1, 0)
             || ' ' || chr(183) || ' partial ' || coalesce(v_j2, 0) || ' ' || chr(183) || ' independent ' || coalesce(v_j3, 0) || E'\n';
      END IF;
    END IF;
  -- internship_group_attendance requires the caller to be the group's
  -- advisor; close_internship already requires owns_group (the same
  -- predicate), so ID_FORBIDDEN is unreachable here. The guard only covers a
  -- database without the internship-days module; any other error must
  -- surface, never be stored as a report missing its section.
  EXCEPTION WHEN undefined_function OR undefined_table THEN
    NULL;
  END;

  v_md := v_md || E'\n' || '_Generated by EngineerTrack on ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '. Counts and levels only; reflections, notes and journal text are not part of this report._' || E'\n';
  RETURN v_md;
END;
$$;
REVOKE EXECUTE ON FUNCTION build_internship_report(UUID, UUID) FROM PUBLIC, authenticated;
