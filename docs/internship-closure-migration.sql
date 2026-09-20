-- ============================================
-- Internship closure: the advisor closes one student's internship in one
-- group; the record becomes read-only (see docs/internship-closure-guards.sql),
-- a Markdown report is built here and stored; reopening needs a reason.
-- Apply order: this file, then -guards.sql, then -verification.sql.
-- ============================================

CREATE TABLE IF NOT EXISTS internship_closures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  group_id       UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  closed_by      UUID NOT NULL REFERENCES profiles(id),
  closed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reopened_by    UUID REFERENCES profiles(id),
  reopened_at    TIMESTAMPTZ,
  reopen_reason  TEXT CHECK (reopen_reason IS NULL OR char_length(reopen_reason) <= 2000),
  report_md      TEXT NOT NULL,
  report_version INT NOT NULL DEFAULT 1,
  UNIQUE (student_id, group_id)
);
ALTER TABLE internship_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS internship_closures_select ON internship_closures;
CREATE POLICY internship_closures_select ON internship_closures FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR is_mentor_of(student_id) OR owns_group(group_id));
-- No INSERT/UPDATE/DELETE policy: every write goes through close_internship /
-- reopen_internship (SECURITY DEFINER), never a direct client write.

-- The lock. Internal: the client asks internship_closure_status instead.
CREATE OR REPLACE FUNCTION internship_closed(p_student_id UUID, p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM internship_closures c
                 WHERE c.student_id = p_student_id AND c.group_id = p_group_id AND c.reopened_at IS NULL);
$$;
REVOKE EXECUTE ON FUNCTION internship_closed(UUID, UUID) FROM PUBLIC, authenticated;

-- The four supervision-scale words, shared with the client copy.
CREATE OR REPLACE FUNCTION closure_level_word(p_level SMALLINT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_level WHEN 0 THEN 'observed' WHEN 1 THEN 'heavy support' WHEN 2 THEN 'partial support' WHEN 3 THEN 'independent' ELSE chr(8212) END;
$$;

-- The "reached level" rule, reproduced exactly from get_competency_progress
-- (docs/competency-rpcs.sql lines ~56-88), scoped to one competency instead of
-- computed for every competency a student's group targets. Two CTEs:
-- `demonstrated` = KPIs of this competency with >= 2 observations by someone
-- other than the student; `levels_done` = levels where BOTH KPIs of that
-- level are demonstrated. Reached = the highest L in 1..4 such that every
-- level 1..L is done, else 0 -- a gap at any level stops the ladder there.
-- Internal: not part of the client's vocabulary, same as internship_closed.
CREATE OR REPLACE FUNCTION closure_reached_level(p_student_id UUID, p_competency_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_level INT;
BEGIN
  WITH demonstrated AS (
    SELECT k.id AS kid, k.level AS lvl
    FROM competency_kpis k
    WHERE k.competency_id = p_competency_id
      AND (
        SELECT count(*) FROM kpi_observations o
        WHERE o.kpi_id = k.id AND o.student_id = p_student_id AND o.observed_by <> p_student_id
      ) >= 2
  ),
  levels_done AS (
    SELECT d.lvl FROM demonstrated d GROUP BY d.lvl HAVING count(*) = 2
  )
  SELECT coalesce((
    SELECT max(candidate.lvl)
    FROM generate_series(1, 4) AS candidate(lvl)
    WHERE NOT EXISTS (
      SELECT 1 FROM generate_series(1, candidate.lvl) AS needed(lvl)
      WHERE NOT EXISTS (SELECT 1 FROM levels_done ld WHERE ld.lvl = needed.lvl)
    )
  ), 0) INTO v_level;
  RETURN v_level;
END;
$$;
REVOKE EXECUTE ON FUNCTION closure_reached_level(UUID, UUID) FROM PUBLIC, authenticated;

-- The report. Counts and levels only -- never reflection, notes, journal or
-- message text. Read-only; close_internship stores what it returns.
-- NOTE 2026-09-20 (simulation finding #4): the deployed copy of this function
-- carried mojibake ("ÔÇö") because the Unicode dashes were pasted into the SQL
-- editor through a CP437 console. Every non-ASCII literal below is now built
-- with chr() so the file survives any paste. Re-apply this file.
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
       || '| Competency | Target level | Reached level | Observations | Self (avg) | Mentor (avg) | Gap |' || E'\n'
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
       || '| Task | Competency | Status | Self | Mentor | Approved on |' || E'\n' || '|---|---|---|---|---|---|' || E'\n';
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

-- ---- close_internship ----
CREATE OR REPLACE FUNCTION close_internship(p_student_id UUID, p_group_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pending INT; v_id UUID; v_version INT; v_md TEXT; v_mentor UUID; v_advisor TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT owns_group(p_group_id) THEN RAISE EXCEPTION 'NOT_GROUP_OWNER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM group_memberships m WHERE m.group_id = p_group_id AND m.student_id = p_student_id AND m.left_at IS NULL) THEN
    RAISE EXCEPTION 'STUDENT_NOT_IN_GROUP';
  END IF;
  IF internship_closed(p_student_id, p_group_id) THEN RAISE EXCEPTION 'ALREADY_CLOSED'; END IF;
  SELECT count(*) INTO v_pending FROM assignment_submissions s JOIN group_assignments a ON a.id = s.assignment_id
   WHERE a.group_id = p_group_id AND s.student_id = p_student_id AND s.status = 'submitted';
  IF v_pending > 0 THEN RAISE EXCEPTION 'PENDING_REVIEWS: %', v_pending; END IF;

  v_md := build_internship_report(p_student_id, p_group_id);
  INSERT INTO internship_closures (student_id, group_id, closed_by, report_md)
  VALUES (p_student_id, p_group_id, auth.uid(), v_md)
  ON CONFLICT (student_id, group_id) DO UPDATE
    SET closed_by = auth.uid(), closed_at = now(), reopened_by = NULL, reopened_at = NULL, reopen_reason = NULL,
        report_md = EXCLUDED.report_md, report_version = internship_closures.report_version + 1
  RETURNING id, report_version INTO v_id, v_version;

  SELECT sp.mentor_id INTO v_mentor FROM student_profiles sp WHERE sp.id = p_student_id;
  SELECT trim(coalesce(pp.first_name,'')||' '||coalesce(pp.last_name,'')) INTO v_advisor FROM profiles_public pp WHERE pp.id = auth.uid();
  INSERT INTO notifications (user_id, title, body, type, data)
  SELECT u, 'Internship closed', coalesce(nullif(v_advisor,''), 'The advisor') || ' closed the internship. Records are now read-only; the report is available.',
         'internship_closed', jsonb_build_object('studentId', p_student_id, 'groupId', p_group_id)
  FROM unnest(ARRAY[p_student_id, v_mentor]) AS u WHERE u IS NOT NULL;
  RETURN jsonb_build_object('closureId', v_id, 'reportVersion', v_version);
END;
$$;
GRANT EXECUTE ON FUNCTION close_internship(UUID, UUID) TO authenticated;

-- ---- reopen_internship ----
CREATE OR REPLACE FUNCTION reopen_internship(p_student_id UUID, p_group_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mentor UUID; v_advisor TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT owns_group(p_group_id) THEN RAISE EXCEPTION 'NOT_GROUP_OWNER'; END IF;
  IF NOT internship_closed(p_student_id, p_group_id) THEN RAISE EXCEPTION 'NOT_CLOSED'; END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  UPDATE internship_closures SET reopened_by = auth.uid(), reopened_at = now(), reopen_reason = left(btrim(p_reason), 2000)
   WHERE student_id = p_student_id AND group_id = p_group_id;
  SELECT sp.mentor_id INTO v_mentor FROM student_profiles sp WHERE sp.id = p_student_id;
  SELECT trim(coalesce(pp.first_name,'')||' '||coalesce(pp.last_name,'')) INTO v_advisor FROM profiles_public pp WHERE pp.id = auth.uid();
  INSERT INTO notifications (user_id, title, body, type, data)
  SELECT u, 'Internship reopened', coalesce(nullif(v_advisor,''), 'The advisor') || ' reopened the internship: ' || left(btrim(p_reason), 80),
         'internship_reopened', jsonb_build_object('studentId', p_student_id, 'groupId', p_group_id)
  FROM unnest(ARRAY[p_student_id, v_mentor]) AS u WHERE u IS NOT NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION reopen_internship(UUID, UUID, TEXT) TO authenticated;

-- ---- get_internship_report ----
CREATE OR REPLACE FUNCTION get_internship_report(p_student_id UUID, p_group_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_md TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (p_student_id = auth.uid() OR is_mentor_of(p_student_id) OR owns_group(p_group_id)) THEN RAISE EXCEPTION 'REPORT_FORBIDDEN'; END IF;
  SELECT report_md INTO v_md FROM internship_closures WHERE student_id = p_student_id AND group_id = p_group_id;
  IF v_md IS NULL THEN RAISE EXCEPTION 'NO_REPORT'; END IF;
  RETURN v_md;
END;
$$;
GRANT EXECUTE ON FUNCTION get_internship_report(UUID, UUID) TO authenticated;

-- ---- internship_closure_status ----
CREATE OR REPLACE FUNCTION internship_closure_status(p_student_id UUID, p_group_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE c internship_closures%ROWTYPE; v_pending INT; v_closed_by TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (p_student_id = auth.uid() OR is_mentor_of(p_student_id) OR owns_group(p_group_id)) THEN RAISE EXCEPTION 'REPORT_FORBIDDEN'; END IF;
  SELECT * INTO c FROM internship_closures WHERE student_id = p_student_id AND group_id = p_group_id;
  SELECT count(*) INTO v_pending FROM assignment_submissions s JOIN group_assignments a ON a.id = s.assignment_id
   WHERE a.group_id = p_group_id AND s.student_id = p_student_id AND s.status = 'submitted';
  SELECT trim(coalesce(pp.first_name,'')||' '||coalesce(pp.last_name,'')) INTO v_closed_by FROM profiles_public pp WHERE pp.id = c.closed_by;
  RETURN jsonb_build_object('closed', c.id IS NOT NULL AND c.reopened_at IS NULL, 'closedAt', c.closed_at, 'closedBy', v_closed_by,
    'reopenedAt', c.reopened_at, 'reopenReason', c.reopen_reason, 'reportVersion', c.report_version, 'pendingReviews', v_pending);
END;
$$;
GRANT EXECUTE ON FUNCTION internship_closure_status(UUID, UUID) TO authenticated;

-- A closure's notifications go with it if the row is ever deleted (cascade from profile/group).
CREATE OR REPLACE FUNCTION trg_closure_deleted_fn() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM notifications WHERE type IN ('internship_closed','internship_reopened')
    AND data->>'studentId' = OLD.student_id::text AND data->>'groupId' = OLD.group_id::text;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_closure_deleted ON internship_closures;
CREATE TRIGGER trg_closure_deleted AFTER DELETE ON internship_closures FOR EACH ROW EXECUTE FUNCTION trg_closure_deleted_fn();
