# Internship Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The advisor closes a student's internship (refused while the mentor still owes a decision), the student's record becomes read-only, a Markdown report is built on the server and stored, and the advisor can reopen with a reason.

**Architecture:** One table `internship_closures`; one internal predicate `internship_closed(student, group)` inserted as a one-line guard at the top of the ten write RPCs that make up a student's record; one SQL function `build_internship_report` that renders Markdown from the competency, task, attendance and journal tables (counts and levels only); four public RPCs (close / reopen / report / status); in-transaction notifications. Client: an advisor action on the student monitor, a shared Markdown viewer screen for the three roles, a lock banner on the student's writing screens.

**Tech Stack:** Expo SDK 57 / RN 0.86 / TS 6 / Supabase (Postgres, RLS, SECURITY DEFINER) / i18next / jest.

**Spec:** `docs/superpowers/specs/2026-09-16-internship-closure-design.md`

## Global Constraints

- SQL applied by the owner one file per submission: `docs/internship-closure-migration.sql` (table, predicate, report builder, the four RPCs, notification cleanup) → `docs/internship-closure-guards.sql` (the ten guarded RPCs, each `CREATE OR REPLACE` of the **current** body with one guard line added) → `docs/internship-closure-verification.sql` Parts A / B / C. Anonymous `$$`, even counts, idempotent.
- **Guard edits copy the CURRENT body of each RPC verbatim** and add exactly one `IF internship_closed(...) THEN RAISE EXCEPTION 'INTERNSHIP_CLOSED'; END IF;` after the authentication check and before any write. The current homes: `submit_assignment` + `review_assignment` → `docs/self-assessment-migration.sql`; `set_submission_sharing` → `docs/group-feed-rpcs.sql`; `internship_open_day`, `internship_save_log`, `internship_review`, `internship_note` → `docs/internship-days-migration.sql`; `open_conversation`, `open_case`, `send_message` → `docs/direct-messages-rpcs.sql`. Each source file gets a one-line header note "guarded copy lives in docs/internship-closure-guards.sql". Nothing else in those bodies changes — the observation rule, notifications, blocks all stay byte-identical.
- Codes: `INTERNSHIP_CLOSED`, `PENDING_REVIEWS`, `ALREADY_CLOSED`, `NOT_CLOSED`, `REASON_REQUIRED`, `REPORT_FORBIDDEN`, `NO_REPORT`, `STUDENT_NOT_IN_GROUP`, `NOT_GROUP_OWNER` (exists). `PENDING_REVIEWS` is raised as `'PENDING_REVIEWS: ' || n` — `mapRpcError` matches by prefix already (verify; if it matches whole-string, map the prefix).
- The report never contains `reflection`, `student_note`, `mentor_note`, `attendance_note`, journal `experience/learning/next_step`, or any message body — Part B asserts the reflection text is absent.
- `internship_closed` is REVOKEd from `authenticated`; `build_internship_report` too.
- Shared tree with Codex: stage by explicit path only; `git status --porcelain <file>` before editing; BLOCKED if dirty; never `git add -A`/`.`, stash, checkout, reset. Locale: `en.json` + `tr.json` only; `t(key,'Default')`.
- `noUnusedLocals/Parameters`; path aliases; `mapRpcError`; no bare catch; `LoadFailedBanner`; request counters where the screen has them.
- Gates per task: `npx tsc --noEmit` silent; `npx jest --silent` green (baseline 49 suites / 415 tests).
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

**SQL (create):** `docs/internship-closure-migration.sql`, `docs/internship-closure-guards.sql`, `docs/internship-closure-verification.sql`. **Modify (header line):** the five source files listed above.

**Client (create):** `src/types/closure.ts`, `src/services/closure.ts`, `src/utils/markdownBlocks.ts` (+ test), `src/utils/closure.ts` (+ test), `src/components/common/MarkdownView.tsx`, `src/components/common/ClosureBanner.tsx`, `src/components/screens/InternshipReportScreen.tsx`, `app/(student)/internship-report.tsx`, `app/(mentor)/internship-report.tsx`, `app/(advisor)/internship-report.tsx`.
**Client (modify):** `src/utils/rpcErrors.ts`, `src/types/notification.ts`, `src/utils/notificationRoutes.ts` (+ test), `src/components/screens/NotificationsScreen.tsx`, `src/i18n/locales/{en,tr}.json`, three `_layout.tsx` (hidden route), `app/(advisor)/student-monitor.tsx`, `app/(student)/my-tasks.tsx`, `app/(student)/task-detail.tsx`, `src/components/internship/InternshipDaysScreen.tsx`, `src/components/screens/MessagesScreen.tsx`, `app/(student)/achievements.tsx`, `src/components/mentor/StudentDetail.tsx`.

---

### Task 1: Migration — table, predicate, report builder, four RPCs

**Files:** create `docs/internship-closure-migration.sql`; create `docs/internship-closure-verification.sql` (Part A only).

**Produces:** `internship_closures`; `internship_closed(p_student_id, p_group_id) RETURNS BOOLEAN` (internal); `build_internship_report(p_student_id, p_group_id) RETURNS TEXT` (internal); `close_internship(p_student_id, p_group_id) RETURNS JSONB`; `reopen_internship(p_student_id, p_group_id, p_reason TEXT) RETURNS VOID`; `get_internship_report(p_student_id, p_group_id) RETURNS TEXT`; `internship_closure_status(p_student_id, p_group_id) RETURNS JSONB`.

- [ ] **Step 1: Migration**

```sql
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
  SELECT CASE p_level WHEN 0 THEN 'observed' WHEN 1 THEN 'heavy support' WHEN 2 THEN 'partial support' WHEN 3 THEN 'independent' ELSE '—' END;
$$;

-- The report. Counts and levels only -- never reflection, notes, journal or
-- message text. Read-only; close_internship stores what it returns.
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

  v_md := '# Internship report — ' || coalesce(v_student, '') || E'\n\n'
       || '| | |' || E'\n' || '|---|---|' || E'\n'
       || '| Workplace | ' || coalesce(v_company, '—') || ' |' || E'\n'
       || '| Mentor | ' || coalesce(nullif(v_mentor, ''), '—') || ' |' || E'\n'
       || '| Advisor | ' || coalesce(v_advisor, '—') || ' |' || E'\n'
       || '| Group | ' || coalesce(v_group, '—') || coalesce(' (' || nullif(v_term, '') || ')', '') || ' |' || E'\n'
       || '| Internship dates | ' || coalesce(v_start::text, '—') || ' – ' || coalesce(v_end::text, '—') || ' |' || E'\n'
       || '| Closed | ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC by ' || coalesce(v_advisor, '—') || ' |' || E'\n'
       || '| Report version | ' || v_version || ' |' || E'\n\n';

  -- Competencies: the group's targets, the student's level (same rule as
  -- get_competency_progress: two observations per KPI, in order), self/mentor averages.
  v_md := v_md || '## Competencies' || E'\n\n'
       || '| Competency | Target level | Reached level | Observations | Self (avg) | Mentor (avg) | Gap |' || E'\n'
       || '|---|---|---|---|---|---|---|' || E'\n';
  FOR r IN
    SELECT c.code, c.name, gt.target_level,
      (SELECT coalesce(max(k.level), 0) FROM competency_kpis k WHERE k.competency_id = c.id
         AND NOT EXISTS (SELECT 1 FROM competency_kpis k2 WHERE k2.competency_id = c.id AND k2.level <= k.level
                         AND (SELECT count(*) FROM kpi_observations o WHERE o.student_id = p_student_id AND o.kpi_id = k2.id AND o.observed_by <> p_student_id) < 2)) AS reached,
      (SELECT count(*) FROM kpi_observations o JOIN competency_kpis k ON k.id = o.kpi_id WHERE o.student_id = p_student_id AND k.competency_id = c.id AND o.observed_by <> p_student_id) AS observations,
      (SELECT round(avg(s.self_level)::numeric, 1) FROM assignment_submissions s JOIN group_assignments a ON a.id = s.assignment_id JOIN kpi_triplets t ON t.id = a.triplet_id JOIN competency_kpis k ON k.id = t.kpi_id
         WHERE s.student_id = p_student_id AND a.group_id = p_group_id AND k.competency_id = c.id AND s.status = 'approved' AND s.self_level IS NOT NULL AND s.mentor_level IS NOT NULL) AS avg_self,
      (SELECT round(avg(s.mentor_level)::numeric, 1) FROM assignment_submissions s JOIN group_assignments a ON a.id = s.assignment_id JOIN kpi_triplets t ON t.id = a.triplet_id JOIN competency_kpis k ON k.id = t.kpi_id
         WHERE s.student_id = p_student_id AND a.group_id = p_group_id AND k.competency_id = c.id AND s.status = 'approved' AND s.self_level IS NOT NULL AND s.mentor_level IS NOT NULL) AS avg_mentor
    FROM group_competency_targets gt JOIN competencies c ON c.id = gt.competency_id
    WHERE gt.group_id = p_group_id ORDER BY c.code
  LOOP
    v_md := v_md || '| ' || r.name || ' | ' || r.target_level || ' | ' || r.reached || ' | ' || r.observations || ' | '
         || coalesce(r.avg_self::text, '—') || ' | ' || coalesce(r.avg_mentor::text, '—') || ' | '
         || coalesce(round(r.avg_mentor - r.avg_self, 1)::text, '—') || ' |' || E'\n';
  END LOOP;

  -- Tasks: every published assignment of the group.
  v_md := v_md || E'\n' || '## Tasks' || E'\n\n'
       || '| Task | Competency | Status | Self | Mentor | Approved on |' || E'\n' || '|---|---|---|---|---|---|' || E'\n';
  FOR r IN
    SELECT a.title, c.name AS competency,
      CASE s.status WHEN 'approved' THEN 'approved' WHEN 'needs_revision' THEN 'sent back' WHEN 'submitted' THEN 'awaiting review' ELSE 'not started' END AS status,
      closure_level_word(s.self_level) AS self_word, closure_level_word(s.mentor_level) AS mentor_word,
      CASE WHEN s.status = 'approved' THEN to_char(s.reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') ELSE '—' END AS approved_on
    FROM group_assignments a
    JOIN kpi_triplets t ON t.id = a.triplet_id JOIN competency_kpis k ON k.id = t.kpi_id JOIN competencies c ON c.id = k.competency_id
    LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.student_id = p_student_id
    WHERE a.group_id = p_group_id AND a.published_at IS NOT NULL ORDER BY a.published_at, a.title
  LOOP
    v_md := v_md || '| ' || replace(r.title, '|', '/') || ' | ' || r.competency || ' | ' || r.status || ' | ' || r.self_word || ' | ' || r.mentor_word || ' | ' || r.approved_on || ' |' || E'\n';
  END LOOP;

  -- Attendance: only when the internship-days module has a placement for the pair.
  IF to_regclass('public.internship_placements') IS NOT NULL THEN
    SELECT (x->>'expectedSoFar')::int AS expected, (x->>'recorded')::int AS recorded, (x->>'present')::int AS present, (x->>'partial')::int AS partial,
           (x->>'excused')::int AS excused, (x->>'absent')::int AS absent, (x->>'pending')::int AS pending, (x->>'submittedLogs')::int AS journals
      INTO v_att
      FROM jsonb_array_elements(internship_group_attendance(p_group_id)->'students') x WHERE (x->>'id')::uuid = p_student_id;
    IF v_att.recorded IS NOT NULL THEN
      v_md := v_md || E'\n' || '## Attendance' || E'\n\n'
           || '| Working days so far | Recorded | Present | Partial | Excused | Absent | Awaiting decision | Journals submitted |' || E'\n'
           || '|---|---|---|---|---|---|---|---|' || E'\n'
           || '| ' || v_att.expected || ' | ' || v_att.recorded || ' | ' || v_att.present || ' | ' || v_att.partial || ' | ' || v_att.excused || ' | ' || v_att.absent || ' | ' || v_att.pending || ' | ' || v_att.journals || ' |' || E'\n';
      SELECT count(*) FILTER (WHERE log_status = 'submitted'),
             count(*) FILTER (WHERE log_status = 'submitted' AND support_level = 0), count(*) FILTER (WHERE log_status = 'submitted' AND support_level = 1),
             count(*) FILTER (WHERE log_status = 'submitted' AND support_level = 2), count(*) FILTER (WHERE log_status = 'submitted' AND support_level = 3)
        INTO v_j_total, v_j0, v_j1, v_j2, v_j3
        FROM internship_days d JOIN internship_placements p ON p.id = d.placement_id WHERE d.student_id = p_student_id AND p.group_id = p_group_id;
      v_md := v_md || E'\n' || '## Journal' || E'\n\n'
           || 'Submitted journals: ' || v_j_total || ' · Support levels: observed ' || v_j0 || ' · heavy ' || v_j1 || ' · partial ' || v_j2 || ' · independent ' || v_j3 || E'\n';
    END IF;
  END IF;

  v_md := v_md || E'\n' || '_Generated by EngineerTrack on ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '. Counts and levels only; reflections, notes and journal text are not part of this report._' || E'\n';
  RETURN v_md;
END;
$$;
REVOKE EXECUTE ON FUNCTION build_internship_report(UUID, UUID) FROM PUBLIC, authenticated;
```
Note: `internship_group_attendance` is SECURITY DEFINER and checks `g.advisor_id = auth.uid()` — called from `build_internship_report` during `close_internship` the caller IS the advisor, so it passes. `get_internship_report` only reads the stored text, so no re-evaluation. If `to_regclass` finds the table but the function is missing, wrap the attendance block in a nested `BEGIN … EXCEPTION WHEN undefined_function THEN NULL; END;`.

Then the RPCs:

```sql
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
```
The "reached level" subquery must match `get_competency_progress` in `docs/competency-rpcs.sql` — read it and, if the rule there differs (e.g. it uses a helper), call the same helper instead of re-deriving. The implementer states in the report which it did.

- [ ] **Step 2: Part A** — table + RLS + no write policy; `internship_closed` and `build_internship_report` not executable by `authenticated`; the four public RPCs granted; `closure_level_word` exists.

- [ ] **Step 3: Lint, commit** `feat(closure): internship_closures, the lock predicate, the Markdown report builder, four RPCs`.

---

### Task 2: Guards — the ten write RPCs, plus Parts B / C

**Files:** create `docs/internship-closure-guards.sql`; modify `docs/internship-closure-verification.sql` (Parts B, C); header line in the five source files.

- [ ] **Step 1: Guards file** — for each of the ten RPCs, copy the CURRENT body verbatim from its home and add the single guard. Where the group id is not a parameter, derive it first:
  - `submit_assignment`: after the `SELF_LEVEL_REQUIRED` guard and the `target_group` SELECT: `IF internship_closed(auth.uid(), target_group) THEN RAISE EXCEPTION 'INTERNSHIP_CLOSED'; END IF;`
  - `review_assignment`: after `SUBMISSION_NOT_FOUND`: `IF internship_closed(the_student, the_group) THEN …`
  - `set_submission_sharing`: after it resolves the submission (read the body; it knows the student and, via the assignment, the group).
  - `internship_open_day`: after the single-active-group check resolves `g`: `IF internship_closed(sp.id, g.id) THEN …`
  - `internship_save_log`, `internship_note`: after the day row `d` is loaded, group via `internship_placements`: `IF internship_closed(d.student_id, (SELECT group_id FROM internship_placements WHERE id = d.placement_id)) THEN …`
  - `internship_review`: inside the loop after `d` is loaded, same derivation.
  - `open_conversation`: after `CANNOT_MESSAGE`: `IF internship_closed(auth.uid(), p_group_id) OR internship_closed(p_other_id, p_group_id) THEN …`
  - `open_case`: after the mentor check: `IF internship_closed(p_student_id, p_group_id) THEN …`
  - `send_message`: after `CONVERSATION_NOT_FOUND`: `IF internship_closed(auth.uid(), v_c.group_id) OR (v_c.subject_id IS NOT NULL AND internship_closed(v_c.subject_id, v_c.group_id)) OR EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = v_c.id AND internship_closed(cp.user_id, v_c.group_id)) THEN …`
  Each function is followed by its existing GRANT line (same signature). Header of the guards file lists the ten and says "this file is the current home of these bodies; edit here, not in the originals".
- [ ] **Step 2: Header notes** — first line of each of the five source files: `-- NOTE 2026-09-16: <fn list> now live in docs/internship-closure-guards.sql (closure guard added); the bodies below are history.`
- [ ] **Step 3: Part B** (fixture as `docs/self-assessment-verification.sql` Part B: group, targets via trigger, published task, student linked to mentor; plus, when `internship_placements` exists, one internship day via `internship_open_day`): B1 close with a `submitted` row → `PENDING_REVIEWS: 1`; mentor approves (level 3); B2 close → `closed = true`, `reportVersion = 1`, 2 notifications, report text contains the student's first name and the task title, does NOT contain the reflection text (`'PRIVATE_REFLECTION_MARKER'` used as the reflection in the fixture); B3 submit another task → `INTERNSHIP_CLOSED`; B4 `internship_open_day` → `INTERNSHIP_CLOSED` (SKIP when the module is absent); B5 `send_message` in a group conversation → `INTERNSHIP_CLOSED`; B6 mentor `review_assignment` on a fixture row → `INTERNSHIP_CLOSED`; B7 stream comment on the task's post still works (`add` via the feed comment path used in group-feed-verification); B8 close again → `ALREADY_CLOSED`; B9 reopen without reason → `REASON_REQUIRED`; B10 reopen → `closed = false`, 2 more notifications, submit works; B11 close again → `reportVersion = 2`; B12 `get_internship_report` as the student and as the mentor → text starts with `# Internship report`; B13 a second advisor (SKIP if none) → `REPORT_FORBIDDEN`.
- [ ] **Step 4: Part C** (`SET LOCAL ROLE authenticated`): C1 student direct SELECT on `internship_closures` → 1 row; C2 mentor → 1 row; C3 a second student → 0 rows (SKIP); C4 `internship_closure_status` as the student → `closed = true`.
- [ ] **Step 5: Lint, commit** `feat(closure): closure guard in the ten write RPCs; verification Parts B / C`.

---

### Task 3: Client core — types, service, errors, notifications, Markdown viewer, banner

**Files:** create `src/types/closure.ts`, `src/services/closure.ts`, `src/utils/markdownBlocks.ts` + `__tests__/markdownBlocks.test.ts`, `src/utils/closure.ts` + `__tests__/closure.test.ts`, `src/components/common/MarkdownView.tsx`, `src/components/common/ClosureBanner.tsx`, `src/components/screens/InternshipReportScreen.tsx`, the three `app/(role)/internship-report.tsx`; modify `src/utils/rpcErrors.ts`, `src/types/notification.ts`, `src/utils/notificationRoutes.ts` (+ test), `src/components/screens/NotificationsScreen.tsx`, the three `_layout.tsx` (hidden route `internship-report`), `src/components/common/index.ts`, `en.json`, `tr.json`.

- [ ] **Step 1: Markdown blocks (TDD)** — `parseMarkdownBlocks(md): Block[]` where `Block = { type: 'h1'|'h2'|'p'|'table'|'note'; text?: string; rows?: string[][] }`: `# ` → h1, `## ` → h2, a run of `|`-lines → table (rows split on `|`, trimmed, the `|---|` separator row dropped), a paragraph wrapped in `_…_` → note, other non-empty lines → p. Tests: a heading + a 3-row table (header, separator, one row) → `[h1, table{rows: 2}]`; the trailing `_Generated…_` line → note; blank lines ignored; a cell containing "—" preserved.
- [ ] **Step 2: closure helpers (TDD)** — `closureLabel(status, t)`: closed → "Closed on <date>", reopened → "Reopened", none → null; `pendingReviewsMessage(n, t)`.
- [ ] **Step 3: Service/types/errors** — `ClosureStatus { closed, closedAt, closedBy, reopenedAt, reopenReason, reportVersion, pendingReviews }`; `closureService.status(studentId, groupId)`, `.close(studentId, groupId) → {closureId, reportVersion}`, `.reopen(studentId, groupId, reason)`, `.report(studentId, groupId) → string`. `ERROR_KEYS`: `INTERNSHIP_CLOSED → errors.internshipClosed`, `PENDING_REVIEWS → errors.pendingReviews`, `ALREADY_CLOSED`, `NOT_CLOSED`, `REASON_REQUIRED`, `REPORT_FORBIDDEN`, `NO_REPORT`, `STUDENT_NOT_IN_GROUP` (check how `mapRpcError` matches — `PENDING_REVIEWS: 3` must map by prefix; extend the matcher with `startsWith` on the code + ':' if needed, with a test).
- [ ] **Step 4: Notifications** — types `internship_closed`, `internship_reopened`; icons (`lock-closed-outline`, `lock-open-outline`); routes: student → `/(student)/internship-report?studentId&groupId`, mentor → `/(mentor)/internship-report?…`, advisor → `/(advisor)/student-monitor` (fallback); tests.
- [ ] **Step 5: `MarkdownView`** — renders blocks: h1/h2 as `ui.title`/`ui.section`, p as `ui.body`, note as `ui.secondary` italic, table as a horizontally scrollable grid (header row bold, `borderColor: colors.divider`, min column width 96). **`ClosureBanner`** — `{ status: ClosureStatus | null; onReport: () => void }` renders nothing when not closed; otherwise a `colors.warning`-tinted bar: lock icon, `t('closure.banner','Your internship is closed — records are read-only')`, a link `t('closure.myReport','My report')`.
- [ ] **Step 6: `InternshipReportScreen({ role })`** — reads `studentId`, `groupId` params; loads `closureService.status` + `.report`; header: `t('closure.reportTitle','Internship report')` + `version N · <date>`; `LoadFailedBanner` on failure; `NO_REPORT` → `t('closure.noReport','No report yet.')`; **Share** button → `Share.share({ message: md, title })`; `MarkdownView`. Three route files + `href: null` in the three layouts.
- [ ] **Step 7: i18n** — `closure.*` (banner, myReport, reportTitle, noReport, share, close, closeConfirmTitle, closeConfirmBody "Records become read-only and the report is generated. You can reopen with a reason.", pendingReviews "{{count}} awaiting the mentor", closedOn "Closed on {{date}}", reopened "Reopened", reopen, reopenReason "Why are you reopening?", reopenConfirm, viewReport, badge "Closed") and `errors.*` for the eight codes, en + tr.
- [ ] **Step 8: Gates, commit** `feat(closure): client core — service, errors, notifications, Markdown viewer, banner, report screen`.

---

### Task 4: Advisor — close / reopen / report on the student monitor

**Files:** modify `app/(advisor)/student-monitor.tsx` (Codex-owned — BLOCKED if dirty), `app/(advisor)/reports.tsx` (Students tab link).

- [ ] **Step 1** — per row, `closureService.status(member.id, groupId)` fetched with the monitor's existing load (batched with `Promise.allSettled`, failure → null). Not closed: **Close internship** button (disabled with `pendingReviewsMessage` when `pendingReviews > 0`; confirm `closeConfirmTitle/Body`; on success reload + `Alert`); closed: `badge` + `closedOn`, **View report** → `router.push('/(advisor)/internship-report', { studentId, groupId })`, **Reopen** → a sheet with a `TextInput` for the reason (`REASON_REQUIRED` locally when blank) → `closureService.reopen`. Errors via `mapRpcError`. The remove-member confirm from Task 6 of the messages plan stays as is.
- [ ] **Step 2** — Reports → Students tab: when closed (status batch-fetched as in `getReportsData`? no — keep the report untouched; instead the Students tab card gets a small "Closed" badge only if the row has `closed` which `getReportsData` can add cheaply via one query on `internship_closures WHERE group_id = …`): add `closedStudentIds: string[]` to `GroupReportData` from a single `SELECT student_id FROM internship_closures WHERE group_id = $1 AND reopened_at IS NULL` (RLS allows the owner), render the badge.
- [ ] **Step 3** — Gates, commit `feat(closure): advisor closes, reopens and reads the report from the student monitor`.

---

### Task 5: Student and mentor — banner, links, disabled actions

**Files:** modify `app/(student)/my-tasks.tsx`, `app/(student)/task-detail.tsx`, `src/components/internship/InternshipDaysScreen.tsx` (student branch), `src/components/screens/MessagesScreen.tsx` (student role), `app/(student)/achievements.tsx`, `src/components/mentor/StudentDetail.tsx`.

- [ ] **Step 1 — student** — a tiny hook `useClosureStatus(studentId, groupId | null)` in `src/hooks/useClosureStatus.ts` (loads on focus; null when no group). `my-tasks`: `ClosureBanner` at the top; `task-detail`: banner, and the submit form hidden (`actionable` also requires `!status?.closed`); `InternshipDaysScreen` (student): banner, "Today I'm at the internship" and journal editing disabled; `MessagesScreen` (student): banner, New message hidden; `achievements`: a "My report" link when closed.
- [ ] **Step 2 — mentor** — `StudentDetail`: `closureService.status(student.id, groupId)` (the mentor knows the student's group from the existing data — find where the group id is available; if not, add `groupId` to what `mentorStudentsService` returns); Closed badge + "View report" link; review CTA hidden when closed.
- [ ] **Step 3** — Gates, commit `feat(closure): student lock banner and report links; mentor badge`.

---

### Task 6: Device walk

1. Advisor → Student monitor: with a pending submission the Close button is disabled and says "1 awaiting the mentor"; mentor approves; Close → confirm → Closed badge; View report shows the tables; Share exports the Markdown.
2. Student: banner on My tasks / task / days / messages; submit form gone; "My report" opens the report; notification "Internship closed" routes there.
3. Mentor: student detail shows Closed + report; review actions gone; attendance decisions refused.
4. Stream: like/comment on the student's task post still work.
5. Advisor → Reopen with a reason → banner gone, submit works; close again → report version 2.

## Risks
- **Ten RPC bodies copied again** (submit/review were copied once already for self-assessment). The guards file becomes their home; the header notes prevent edits landing in the wrong file. A drift check in Part A (`pg_get_functiondef` of each contains `internship_closed(`) catches a later re-apply of an old file.
- `student-monitor.tsx` and `StudentDetail.tsx` are the parallel session's; BLOCKED → written change request.
- `build_internship_report` calls `internship_group_attendance`, which requires the caller to be the advisor — true inside `close_internship`; if a later caller is added, that assumption breaks (documented in the function comment).
