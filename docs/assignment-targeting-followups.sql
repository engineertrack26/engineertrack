-- docs/assignment-targeting-followups.sql
-- Follow-ups to docs/assignment-targeting.sql, from the whole-branch review of
-- 2026-09-26. Spec: docs/superpowers/specs/2026-09-26-assignment-targeting-design.md
--
-- APPLY AFTER docs/assignment-targeting.sql. Idempotent, anonymous $$ only
-- (a named dollar tag fails in the Supabase SQL editor).
--
-- What it fixes:
--   1. C1 -- the assignment-docs storage read policy learned nothing about
--      audience, so any active member could list <groupId>/ and sign the brief
--      of a task they were never given.
--   2. C2 -- build_internship_report listed every published task of the group
--      on every student's report, so a task given to two students appeared on
--      the other five students' permanent, stored report as "not started".
--   3. I2 (server half) -- HAS_SUBMISSION counted a submitter who has since
--      LEFT the group, which made a task with such a submission impossible to
--      re-target ever again.
--   4. M1 -- target_count counted all target rows for a 'selected' audience
--      but only ACTIVE members for a 'group' one, so the card's denominator
--      meant two different things.
--   5. M7 -- nothing stopped a direct UPDATE from setting audience='group'
--      while target rows still existed.
--
-- WHAT THIS FILE TAKES OVER (each old home now carries a NOTE saying so):
--   * the "assignment_docs_read" policy on storage.objects
--       (was docs/assignment-drafts-migration.sql)
--   * build_internship_report
--       (was docs/closure-report-reviewer-column.sql, which had taken it from
--        docs/internship-closure-migration.sql)
--   * set_assignment_targets and group_assignment_counts
--       (were docs/assignment-targeting.sql)
-- Re-running any of those three files reverts the fix it used to hold; if you
-- do, re-apply THIS file afterwards.
--
-- Verification: docs/assignment-targeting-verification.sql, PART D.
-- ============================================================


-- ============================================================
-- 1. C1 -- a targeted task's brief is not readable by the whole group
-- ============================================================
-- The row policy on group_assignments learned about audience in
-- docs/assignment-targeting.sql; this policy did not. A brief lives at
-- <groupId>/<assignmentId>/<ts>_<name> and this SELECT policy governs both
-- list() and createSignedUrl(), so an untargeted member could enumerate the
-- assignment-id folders under their own group and sign a brief for a task
-- whose whole point is that it encodes a judgement about another student's
-- level.
--
-- The replacement routes through the SAME predicates the row policy uses
-- rather than restating the rule a third time. Two clauses of the old body
-- are deliberately gone:
--   * the EXISTS (... published_at IS NOT NULL) guard that kept a DRAFT's
--     brief hidden -- both can_see_assignment and mentor_sees_assignment
--     already require published_at, so it is subsumed, not dropped;
--   * is_member_of_group / mentors_a_member_of_group on path segment 1 --
--     can_see_assignment requires an ACTIVE membership of the assignment's
--     own group, and mentor_sees_assignment requires
--     mentors_a_member_of_group of that same group. Keying off the
--     assignment's group_id instead of the path's first segment is strictly
--     tighter: a path whose two segments disagree now answers "no" instead of
--     answering from the group segment alone.
-- The advisor's branch is unchanged and stays first: an advisor previewing an
-- attachment on a task they have not sent yet is not a leak.
--
-- A malformed path whose segment is not a UUID still makes the ::uuid cast
-- raise rather than return false -- the read is refused, which is the safe
-- direction, and the only writer is our own uploader, which always leads with
-- a real group id and a real assignment id.
DROP POLICY IF EXISTS "assignment_docs_read" ON storage.objects;
CREATE POLICY "assignment_docs_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'assignment-docs'
    AND auth.role() = 'authenticated'
    AND (
      owns_group((storage.foldername(name))[1]::uuid)
      OR can_see_assignment((storage.foldername(name))[2]::uuid)
      OR mentor_sees_assignment((storage.foldername(name))[2]::uuid)
    )
  );

-- assignment_docs_upload and assignment_docs_delete are untouched: both are
-- advisor-only (owns_group on segment 1) and neither can leak a brief.


-- ============================================================
-- 2. C2 -- a student's closure report lists only the tasks they were given
-- ============================================================
-- Body copied verbatim from docs/closure-report-reviewer-column.sql (which is
-- where it lived, having taken it from docs/internship-closure-migration.sql
-- when "Mentor (avg)" became "Reviewer (avg)"). The ONLY change is the two
-- added lines in the Tasks loop's WHERE, marked below.
--
-- Why it matters more than an edge case: under this feature's purpose each
-- student's task list is EXPECTED to diverge over a term, so without this a
-- task given to the two students who were ready reads as work the other five
-- failed to do -- in a document that is stored permanently in
-- internship_closures.report_md, versioned, and shown to the student, the
-- mentor and the university.
--
-- Reports already stored are frozen text and stay exactly as they are. That is
-- correct: they describe a pre-targeting world.
--
-- The CLOSURE GATE is genuinely unaffected and is not touched here:
-- close_internship counts submissions per student, not assignments per group.
--
-- Every non-ASCII literal is built with chr() -- preserved unchanged, because
-- a console paste once corrupted the Unicode dashes in the deployed copy.
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

  -- Tasks: every published assignment of the group THIS STUDENT WAS GIVEN.
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
    WHERE a.group_id = p_group_id AND a.published_at IS NOT NULL
      -- THE ONE CHANGE (2026-09-27). Without it a task given to the two
      -- students who were ready reads as "not started" on the other five
      -- students' reports. Deliberately audience-first and not a bare EXISTS
      -- on assignment_targets: a 'group' assignment has no target rows at
      -- all, so a targets-only test would empty every report.
      -- Membership is NOT re-checked here: a target row can only have been
      -- written for an active member, and a student closing out of a group
      -- they have since left must still see the task they were given.
      AND (a.audience = 'group'
           OR EXISTS (SELECT 1 FROM assignment_targets tg
                      WHERE tg.assignment_id = a.id AND tg.student_id = p_student_id))
    ORDER BY a.published_at, a.title
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


-- ============================================================
-- 3. I2 (server half) -- a departed submitter cannot deadlock re-targeting
-- ============================================================
-- Body copied verbatim from docs/assignment-targeting.sql. The ONLY change is
-- the added membership test inside the HAS_SUBMISSION guard, marked below.
--
-- The deadlock: a group task has a submission from A; A leaves the group.
-- Narrowing it is then impossible forever -- name A and the guard above raises
-- STUDENT_NOT_IN_GROUP (targets must be ACTIVE members); leave A out and this
-- guard raises HAS_SUBMISSION.
CREATE OR REPLACE FUNCTION set_assignment_targets(p_assignment_id UUID, p_student_ids UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group     UUID;
  v_published TIMESTAMPTZ;
  v_ids       UUID[];
  v_bad       UUID;
  n           INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT a.group_id, a.published_at INTO v_group, v_published
  FROM group_assignments a WHERE a.id = p_assignment_id;

  IF v_group IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  -- SECURITY DEFINER has no RLS of its own, so ownership is checked here or
  -- not at all.
  IF NOT owns_group(v_group) THEN
    RAISE EXCEPTION 'NOT_GROUP_OWNER';
  END IF;

  -- Duplicates would hit the composite primary key. Naming the same student
  -- twice means the same thing as naming them once, so it is not an error.
  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::UUID[]) INTO v_ids
  FROM unnest(COALESCE(p_student_ids, ARRAY[]::UUID[])) AS x;

  -- A NULL element must be refused, not filtered: stripping it in the dedupe
  -- above would turn ARRAY[NULL] into an empty array, which this function
  -- reads as "send it to the whole group" -- silently widening on malformed
  -- input is the dangerous direction for this feature. Checked with an
  -- explicit IS NULL, not folded into the membership scan below, because
  -- `x = ANY(...)` and `NOT EXISTS (... x ...)` involve x in a comparison,
  -- and three-valued logic would make a NULL either vanish from both sides or
  -- report as "not a member" -- either way it would reach the INSERT and die
  -- on assignment_targets.student_id's NOT NULL constraint as a raw 23502
  -- instead of a stable code.
  IF EXISTS (SELECT 1 FROM unnest(v_ids) AS x WHERE x IS NULL) THEN
    RAISE EXCEPTION 'STUDENT_NOT_IN_GROUP';
  END IF;

  -- Every named student must be an active member of THIS group.
  SELECT x INTO v_bad
  FROM unnest(v_ids) AS x
  WHERE NOT EXISTS (
    SELECT 1 FROM group_memberships m
    WHERE m.group_id = v_group AND m.student_id = x AND m.left_at IS NULL
  )
  LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'STUDENT_NOT_IN_GROUP';
  END IF;

  -- Nothing already worked on may be taken away, and the check runs before any
  -- write so a refusal leaves the targets exactly as they were. Widening to the
  -- whole group removes nobody, so it is never refused -- an advisor whose
  -- targeted student has submitted must still be able to open the task up.
  --
  -- Keyed off assignment_submissions, not assignment_targets: a published
  -- GROUP-audience assignment has submissions but no target rows at all, so a
  -- check that joined through assignment_targets was always vacuously false
  -- for that case -- an advisor narrowing a published group task could remove
  -- a student who had already submitted, silently, and the read policy would
  -- then hide that student's own work from their history. A submission can
  -- only exist from someone who had access when they submitted (can_see_
  -- assignment or the pre-targeting group-wide policy), which is what makes
  -- this check correct for both audiences without consulting audience at all.
  --
  -- 2026-09-27: a submitter who is NO LONGER AN ACTIVE MEMBER is exempt. They
  -- cannot be orphaned by a change to an audience they can no longer see --
  -- can_see_assignment already requires an active membership, so the task
  -- left their list the day they left the group, whatever the targets say.
  -- Without the exemption a departed submitter deadlocks the assignment: the
  -- guard above refuses to name them (they are not active) and this one
  -- refuses to leave them out, so the advisor can never re-target it again.
  IF array_length(v_ids, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM assignment_submissions s
    WHERE s.assignment_id = p_assignment_id
      AND NOT (s.student_id = ANY(v_ids))
      AND EXISTS (
        SELECT 1 FROM group_memberships m
        WHERE m.group_id = v_group AND m.student_id = s.student_id AND m.left_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'HAS_SUBMISSION';
  END IF;

  IF array_length(v_ids, 1) IS NULL THEN
    DELETE FROM assignment_targets WHERE assignment_id = p_assignment_id;
    UPDATE group_assignments SET audience = 'group' WHERE id = p_assignment_id;
    -- A published task that widens to the group gets the stream card it never
    -- had. feed_publish_assignment is idempotent and returns NULL for a draft;
    -- the IF is here so the intent is readable, not because it is needed.
    IF v_published IS NOT NULL THEN
      PERFORM feed_publish_assignment(p_assignment_id);
    END IF;
    RETURN 0;
  END IF;

  -- Audience first: trg_target_requires_selected refuses a row whose
  -- assignment still reads 'group'.
  UPDATE group_assignments SET audience = 'selected' WHERE id = p_assignment_id;

  DELETE FROM assignment_targets
  WHERE assignment_id = p_assignment_id AND NOT (student_id = ANY(v_ids));

  INSERT INTO assignment_targets (assignment_id, student_id)
  SELECT p_assignment_id, x FROM unnest(v_ids) AS x
  ON CONFLICT DO NOTHING;

  -- Narrowing a published task takes its stream card down with it: the card
  -- announces the task to the whole group, which is precisely what targeting
  -- exists to avoid.
  DELETE FROM feed_posts WHERE assignment_id = p_assignment_id;

  SELECT count(*)::INT INTO n
  FROM assignment_targets WHERE assignment_id = p_assignment_id;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION set_assignment_targets(UUID, UUID[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION set_assignment_targets(UUID, UUID[]) FROM PUBLIC, anon;


-- ============================================================
-- 4. M1 -- target_count means the same thing on both branches
-- ============================================================
-- The group branch has always counted ACTIVE members; the selected branch
-- counted every target row, including students who have since left. The card
-- then read "3 students" and "1 / 3" when only two were still in the group.
-- Joining group_memberships on the selected branch makes both bases "people
-- who are actually still here and actually have this task".
--
-- Body copied verbatim from docs/assignment-targeting.sql apart from that
-- join. DROP first for the same reason that file does: CREATE OR REPLACE
-- cannot change a RETURNS TABLE, and this function has already changed shape
-- once.
DROP FUNCTION IF EXISTS group_assignment_counts(UUID);
CREATE OR REPLACE FUNCTION group_assignment_counts(p_group_id UUID)
RETURNS TABLE (assignment_id UUID, submitted INT, approved INT,
               needs_revision INT, target_count INT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id,
         count(s.id)::INT,
         count(s.id) FILTER (WHERE s.status = 'approved')::INT,
         count(s.id) FILTER (WHERE s.status = 'needs_revision')::INT,
         CASE WHEN a.audience = 'selected'
              THEN (SELECT count(*)::INT FROM assignment_targets tg
                    JOIN group_memberships m ON m.student_id = tg.student_id
                                            AND m.group_id = a.group_id
                                            AND m.left_at IS NULL
                    WHERE tg.assignment_id = a.id)
              ELSE (SELECT count(*)::INT FROM group_memberships m
                    WHERE m.group_id = a.group_id AND m.left_at IS NULL)
         END
  FROM group_assignments a
  LEFT JOIN assignment_submissions s ON s.assignment_id = a.id
  WHERE a.group_id = p_group_id
    AND owns_group(p_group_id)
  GROUP BY a.id, a.audience, a.group_id;
$$;

GRANT EXECUTE ON FUNCTION group_assignment_counts(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION group_assignment_counts(UUID) FROM PUBLIC, anon;


-- ============================================================
-- 5. M7 -- the audience column cannot be desynced by a direct UPDATE
-- ============================================================
-- trg_target_requires_selected guards writes to assignment_targets; nothing
-- guarded the other side, so an owning advisor could
-- `UPDATE group_assignments SET audience='group'` through PostgREST and leave
-- the target rows behind. Owner-scoped and self-inflicted, but the resulting
-- row is the one state the whole data model was shaped to make impossible:
-- target rows that no longer narrow anything.
--
-- SECURITY DEFINER with a fixed search_path, exactly like
-- trg_target_requires_selected_fn, so the check reads assignment_targets
-- without re-entering that table's read policy.
CREATE OR REPLACE FUNCTION trg_audience_group_has_no_targets_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM assignment_targets tg WHERE tg.assignment_id = NEW.id) THEN
    RAISE EXCEPTION 'TARGETS_EXIST';
  END IF;
  RETURN NEW;
END;
$$;

-- The WHEN clause is what keeps set_assignment_targets' own empty-array path
-- passing, and it is worth being precise about why: that path DELETEs every
-- target row FIRST and only then sets audience='group', so by the time this
-- trigger fires there is nothing left to find. (Verified against the body
-- above, section 3: DELETE ... ; UPDATE ... SET audience = 'group'.)
--
-- OLD.audience IS DISTINCT FROM 'group' narrows it to the transition itself.
-- Without that, every unrelated UPDATE on a group-audience row -- publishing
-- it, attaching a document, editing its title -- would pay for the EXISTS,
-- and, worse, a row that is ALREADY desynced could never be edited or
-- repaired at all.
DROP TRIGGER IF EXISTS trg_audience_group_has_no_targets ON group_assignments;
CREATE TRIGGER trg_audience_group_has_no_targets
  BEFORE UPDATE ON group_assignments
  FOR EACH ROW
  WHEN (NEW.audience = 'group' AND OLD.audience IS DISTINCT FROM 'group')
  EXECUTE FUNCTION trg_audience_group_has_no_targets_fn();
