# Subsystem D1 — data layer for retiring the daily log

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move evidence, reflection and the gamification the daily log carried onto the task submission, in SQL, so D2 can rebuild the screens on top of it.

**Architecture:** `log_photos` and `log_documents` gain a second possible owner (`submission_id`) under a one-owner CHECK, reusing both storage buckets untouched. `submit_assignment` gets a new signature that takes the reflection and the evidence, writes the evidence itself, and then awards the submit-side XP, the `first_task` badge and a weekly streak — all after the evidence rows exist, because a trigger would run before them and always count zero photos. A verification script proves the parts that a green catalog lookup cannot.

**Tech Stack:** PostgreSQL 15 (Supabase), `plpgsql` and `sql` functions, RLS policies, TypeScript constants for the badge catalogue, i18next (`en.json` only).

**Spec:** `docs/superpowers/specs/2026-08-23-daily-log-retirement-design.md`

## Global Constraints

- **Do not run any migration and do not connect to a database.** Every task writes SQL to a file; the user applies it.
- **The SQL in this plan must NOT be applied until D2 is complete.** Task 2 drops the live `submit_assignment(UUID, TEXT, UUID)` signature that the shipped `my-tasks.tsx` still calls. Applying D1 alone breaks every submission on the user's test device. D1's own verification script therefore runs at the end of D2, not at the end of D1.
- All SQL is **idempotent and safe to re-apply**. `ADD CONSTRAINT` has no `IF NOT EXISTS` in Postgres — always `DROP CONSTRAINT IF EXISTS` first. Same for policies.
- **No `CASCADE` on any `DROP`.**
- `npx tsc --noEmit` silent; `npx jest --silent` green at 4 suites / 23 tests.
- Only `src/i18n/locales/en.json` among the seven locale files. Translation is paused project-wide.
- Server-written user-facing strings are **plain English**: the database has no access to i18n, and `award_xp_internal`, `award_badge_internal`, `report_join_issue` and `submit_assignment` are all English already.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

- **Create** `docs/daily-log-retirement-migration.sql` — schema and policies (Task 1).
- **Create** `docs/daily-log-retirement-rpcs.sql` — the new `submit_assignment` (Tasks 2 and 3).
- **Create** `docs/daily-log-retirement-verification.sql` — Parts A, B and C (Tasks 1, 2, 3, 5).
- **Modify** `src/types/gamification.ts` — the `first_task` badge entry (Task 4).
- **Modify** `src/i18n/locales/en.json` — badge copy (Task 4).

The three SQL files mirror the naming and split of `docs/task-assignment-{migration,rpcs,verification}.sql`, which is the convention on this branch. Read those three before starting; this plan assumes their patterns.

---

### Task 1: Evidence tables get a second owner

**Files:**
- Create: `docs/daily-log-retirement-migration.sql`
- Create: `docs/daily-log-retirement-verification.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `log_photos.submission_id UUID NULL`, `log_documents.submission_id UUID NULL`, constraints `log_photos_one_owner` / `log_documents_one_owner`, `assignment_submissions.reflection TEXT NULL`. Task 2's RPC writes all four.

- [ ] **Step 1: Write the verification cases first**

Create `docs/daily-log-retirement-verification.sql` with the header and Part A. Copy the tone and the caveats from `docs/task-assignment-verification.sql` — in particular the warning that Part A is structural because the SQL editor runs as table owner and an owner bypasses RLS.

```sql
-- ============================================================
-- Subsystem D1 verification
--
-- Run in the Supabase SQL editor. Anonymous $$ only: a named dollar tag
-- fails with 42601 in that editor.
--
-- PART A is STRUCTURAL. The editor connects as the table owner and an owner
-- bypasses RLS, so these assertions prove a column, a constraint or a policy
-- EXISTS. They never prove a policy can be EVALUATED. On 2026-08-20 that
-- blind spot let a 42P17 recursion through two green verification runs.
-- Part C is where the policies are actually evaluated.
-- ============================================================

-- ============================================================
-- PART A — schema assertions
-- Expected: one row, "PASS: schema assertions held".
-- ============================================================

DO $$
DECLARE
  n INT;
BEGIN
  -- The dual-owner columns.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'log_photos' AND column_name = 'submission_id') THEN
    RAISE EXCEPTION 'FAIL: log_photos.submission_id is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'log_documents' AND column_name = 'submission_id') THEN
    RAISE EXCEPTION 'FAIL: log_documents.submission_id is missing';
  END IF;

  -- log_id must have become nullable, or a task-owned row cannot exist at all.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name IN ('log_photos','log_documents')
               AND column_name = 'log_id' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'FAIL: log_id is still NOT NULL; no row can be owned by a submission';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'assignment_submissions' AND column_name = 'reflection') THEN
    RAISE EXCEPTION 'FAIL: assignment_submissions.reflection is missing';
  END IF;

  -- Both one-owner constraints.
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conname IN ('log_photos_one_owner','log_documents_one_owner');
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: % of 2 one-owner constraints present', n;
  END IF;

  SELECT count(*) INTO n FROM pg_indexes
  WHERE indexname IN ('idx_log_photos_submission','idx_log_documents_submission');
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: % of 2 submission indexes present', n;
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS part_a;
```

- [ ] **Step 2: Write the CHECK constraint's two cases**

Append Part B to the same file. **Two separate cases.** Writing only the both-set case leaves the neither-set half of `num_nonnulls(...) = 1` untried, and a constraint written as `<= 1` would pass it.

```sql
-- ============================================================
-- PART B — behaviour, as owner. Submit BEGIN..ROLLBACK in one go.
--
--   B1 both owners set     refused (23514)
--   B2 neither owner set   refused (23514)
-- ============================================================

BEGIN;

DO $$
DECLARE
  log TEXT := '';
  a_log UUID;
BEGIN
  -- Any existing log id will do; B1 only needs a value that satisfies the FK.
  SELECT id INTO a_log FROM daily_logs ORDER BY created_at LIMIT 1;

  -- B1. Both owners set. num_nonnulls = 2, so the CHECK must refuse.
  BEGIN
    INSERT INTO log_photos (log_id, submission_id, uri)
    VALUES (a_log, gen_random_uuid(), 'probe://both');
    log := log || 'B1 both owners set' || E'\t'
        || 'FAIL: accepted -- a row can belong to a log and a submission at once' || E'\n';
  EXCEPTION WHEN check_violation THEN
    log := log || 'B1 both owners set' || E'\t' || 'refused (23514)' || E'\n';
  WHEN foreign_key_violation THEN
    -- The random submission id has no row. That refusal is the FK, not the
    -- CHECK, so it proves nothing about the constraint under test.
    log := log || 'B1 both owners set' || E'\t'
        || 'INCONCLUSIVE: refused by the FK before the CHECK was reached' || E'\n';
  WHEN OTHERS THEN
    log := log || 'B1 both owners set' || E'\t'
        || 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B2. Neither owner set. num_nonnulls = 0. An orphan row belongs to nobody
  --     and no policy can reach it, so it would be invisible and undeletable.
  BEGIN
    INSERT INTO log_photos (log_id, submission_id, uri)
    VALUES (NULL, NULL, 'probe://neither');
    log := log || 'B2 neither owner set' || E'\t'
        || 'FAIL: accepted -- an orphan row no policy can reach' || E'\n';
  EXCEPTION WHEN check_violation THEN
    log := log || 'B2 neither owner set' || E'\t' || 'refused (23514)' || E'\n';
  WHEN OTHERS THEN
    log := log || 'B2 neither owner set' || E'\t'
        || 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;
```

B1 uses a random submission id on purpose and reports `INCONCLUSIVE` if the FK fires first, rather than counting an FK refusal as a CHECK pass. Postgres does not guarantee the order in which a CHECK and an FK are evaluated, so the case says which one answered.

- [ ] **Step 3: Write the migration**

Create `docs/daily-log-retirement-migration.sql`.

```sql
-- ============================================
-- Subsystem D: the daily log retires
--
-- Evidence moves onto the task submission by giving log_photos and
-- log_documents a second possible owner. The upload service, the picker
-- components and BOTH STORAGE BUCKETS are reused unchanged -- the bucket
-- policies key on (storage.foldername(name))[1] = auth.uid()::text and never
-- mention logs, so nothing there needs touching.
--
-- Idempotent and safe to re-apply.
-- ============================================

-- ---- assignment_submissions.reflection ----
--
-- Nullable on purpose. Existing submissions genuinely have no reflection, and
-- a NOT NULL DEFAULT '' would satisfy the constraint while meaning nothing.
-- The requirement is enforced in submit_assignment, where btrim can be
-- applied and a blank can be refused with a name.
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS reflection TEXT;

-- ---- log_photos ----
ALTER TABLE log_photos ALTER COLUMN log_id DROP NOT NULL;

ALTER TABLE log_photos ADD COLUMN IF NOT EXISTS submission_id UUID
  REFERENCES assignment_submissions(id) ON DELETE CASCADE;

-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so re-applying this file
-- would fail with 42710 without the drop.
ALTER TABLE log_photos DROP CONSTRAINT IF EXISTS log_photos_one_owner;
ALTER TABLE log_photos ADD CONSTRAINT log_photos_one_owner
  CHECK (num_nonnulls(log_id, submission_id) = 1);

CREATE INDEX IF NOT EXISTS idx_log_photos_submission
  ON log_photos(submission_id);

-- ---- log_documents ----
ALTER TABLE log_documents ALTER COLUMN log_id DROP NOT NULL;

ALTER TABLE log_documents ADD COLUMN IF NOT EXISTS submission_id UUID
  REFERENCES assignment_submissions(id) ON DELETE CASCADE;

ALTER TABLE log_documents DROP CONSTRAINT IF EXISTS log_documents_one_owner;
ALTER TABLE log_documents ADD CONSTRAINT log_documents_one_owner
  CHECK (num_nonnulls(log_id, submission_id) = 1);

CREATE INDEX IF NOT EXISTS idx_log_documents_submission
  ON log_documents(submission_id);
```

Existing rows have `log_id` set and `submission_id` null, so they already satisfy both CHECKs. There is no backfill.

- [ ] **Step 4: Rewrite the six policies**

Append to the same migration file. Each policy gains a second branch. Read the originals at `docs/database-schema.sql:518-558` first and keep the log branch exactly as it is.

```sql
-- ---- Policies: a second owner means a second branch ----
--
-- The submission branch is deliberately just
--   EXISTS (SELECT 1 FROM assignment_submissions s WHERE s.id = submission_id)
-- with no role logic of its own. A policy subquery is evaluated under the
-- REFERENCED table's RLS -- the behaviour that produced 42P17 on this branch
-- in August. Here it works for us: the rule reads "you can see the evidence if
-- you can see the submission", and assignment_submissions' own SELECT policy
-- already resolves student, mentor and advisor. There is no recursion, because
-- that policy never looks at log_photos or log_documents.

DROP POLICY IF EXISTS "log_photos_select" ON log_photos;
CREATE POLICY "log_photos_select" ON log_photos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND (daily_logs.student_id = auth.uid()
        OR is_mentor_of(daily_logs.student_id)
        OR is_advisor_of(daily_logs.student_id)))
    OR EXISTS (SELECT 1 FROM assignment_submissions s WHERE s.id = submission_id)
  );

DROP POLICY IF EXISTS "log_photos_insert" ON log_photos;
CREATE POLICY "log_photos_insert" ON log_photos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid())
    OR EXISTS (SELECT 1 FROM assignment_submissions s
      WHERE s.id = submission_id
        AND s.student_id = auth.uid()
        AND s.status <> 'approved')
  );

DROP POLICY IF EXISTS "log_photos_delete" ON log_photos;
CREATE POLICY "log_photos_delete" ON log_photos
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid()
      AND daily_logs.status IN ('draft', 'needs_revision'))
    OR EXISTS (SELECT 1 FROM assignment_submissions s
      WHERE s.id = submission_id
        AND s.student_id = auth.uid()
        AND s.status <> 'approved')
  );
```

Repeat all three for `log_documents`, substituting the table name. Do not abbreviate with a comment saying "same as above" — the file is applied as written.

The INSERT and DELETE policies exist for correctness, not because the app relies on them: `submit_assignment` is `SECURITY DEFINER` and bypasses them. They are what stops a client writing evidence onto somebody else's submission, or onto an approved one.

- [ ] **Step 5: Commit**

```bash
git add docs/daily-log-retirement-migration.sql docs/daily-log-retirement-verification.sql
git commit -m "feat(d1): evidence tables get a second owner

log_photos and log_documents can now belong to a task submission instead
of a daily log, under a one-owner CHECK. Both storage buckets are reused
unchanged -- their policies key on the uid path segment and never mention
logs.

Part B tests both halves of the CHECK. Testing only the both-set case
would pass a constraint written as <= 1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `submit_assignment` takes the reflection and the evidence

**Files:**
- Create: `docs/daily-log-retirement-rpcs.sql`
- Modify: `docs/daily-log-retirement-verification.sql` (append Part B cases)

**Interfaces:**
- Consumes: `assignment_submissions.reflection`, `log_photos.submission_id`, `log_documents.submission_id` from Task 1.
- Produces: `submit_assignment(p_assignment_id UUID, p_note TEXT, p_reflection TEXT, p_photos JSONB, p_documents JSONB) RETURNS UUID`. Task 3 appends to this same function. D2's `assignments.ts` calls it.

- [ ] **Step 1: Write the verification cases first**

Append to Part B in `docs/daily-log-retirement-verification.sql`, inside the same `BEGIN;` block and the same `log` variable, before `PERFORM set_config('probe.results', ...)`.

```sql
  -- B3. A blank reflection is refused. The whole reason the daily log was
  --     removed is that reflection moved onto the task record; an optional
  --     field would go empty and take the reason with it. Whitespace is not
  --     a reflection, so the guard is btrim, not IS NULL.
  BEGIN
    PERFORM submit_assignment(a_assign, 'did the thing', '   ', '[]'::jsonb, '[]'::jsonb);
    log := log || 'B3 blank reflection' || E'\t'
        || 'FAIL: accepted -- whitespace passed as a reflection' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B3 blank reflection' || E'\t'
        || CASE WHEN SQLERRM LIKE '%REFLECTION_REQUIRED%' THEN 'refused (REFLECTION_REQUIRED)'
                ELSE 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- B4. Resubmitting rewrites the evidence rather than appending to it. The
  --     client holds the full list, so a student who removes a photo and
  --     resubmits must end with one photo, not two.
  PERFORM submit_assignment(a_assign, 'first go', 'learned one thing',
    '[{"uri":"probe://p1","caption":"one"},{"uri":"probe://p2","caption":"two"}]'::jsonb,
    '[]'::jsonb);
  PERFORM submit_assignment(a_assign, 'second go', 'learned one thing',
    '[{"uri":"probe://p1","caption":"one"}]'::jsonb,
    '[]'::jsonb);

  SELECT count(*) INTO n FROM log_photos p
  WHERE p.submission_id = (SELECT s.id FROM assignment_submissions s
                           WHERE s.assignment_id = a_assign AND s.student_id = the_student);
  log := log || 'B4 resubmit rewrites evidence' || E'\t'
      || CASE WHEN n = 1 THEN '1 photo after removing one'
              WHEN n = 2 THEN 'FAIL: 2 photos -- evidence appended instead of rewritten'
              ELSE 'FAIL: ' || n || ' photos, expected 1' END || E'\n';
```

Part B's `DO $$` block now needs a fuller DECLARE and a fixture. Replace the header Task 1 wrote with this, and put the fixture at the top of the block, before B1:

```sql
DO $$
DECLARE
  log TEXT := '';
  a_log UUID; adv UUID; the_student UUID; grp UUID; kpi UUID;
  a_assign UUID; a_assign2 UUID;
  n INT; n2 INT;
BEGIN
  SELECT id INTO a_log FROM daily_logs ORDER BY created_at LIMIT 1;

  SELECT id INTO adv         FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO the_student FROM profiles WHERE role = 'student'  ORDER BY created_at LIMIT 1;

  IF adv IS NULL OR the_student IS NULL THEN
    PERFORM set_config('probe.results',
      'B1-B7 behaviour' || E'\t' || 'SKIP: needs one advisor and one student profile' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name)
  VALUES (adv, 'Probe D1') RETURNING id INTO grp;

  -- tr_seed_group_competency_targets seeds every competency as a target on
  -- that INSERT, so any triplet is in scope and trg_assignment_within_scope
  -- lets both assignments through.
  SELECT k.id INTO kpi
  FROM competency_kpis k
  JOIN competencies c ON c.id = k.competency_id
  WHERE k.level = 1 AND k.kpi_index = 1
  ORDER BY c.display_order LIMIT 1;

  -- Two assignments, not one. B5 needs a SECOND submission in the same week;
  -- a second call against a_assign would be a resubmission and would take the
  -- guarded path instead of the streak branch under test.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe one', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 0 LIMIT 1
  RETURNING id INTO a_assign;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe two', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 1 LIMIT 1
  RETURNING id INTO a_assign2;

  -- submit_assignment refuses a non-member with ROLE_NOT_ALLOWED, so the
  -- membership is load-bearing, not scenery. The table is group_memberships;
  -- there is no internship_group_members despite what one fix brief called it.
  INSERT INTO group_memberships (group_id, student_id)
  VALUES (grp, the_student);

  -- submit_assignment reads auth.uid(). Without this every call below would
  -- raise NOT_AUTHENTICATED and B3 would "pass" for the wrong reason.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', the_student)::text, true);
```

One trap in the fixture: `a_log` is NULL on a database with no daily logs. B1 would then insert a NULL `log_id` beside a set `submission_id`, which is `num_nonnulls = 1` and *legitimately* passes the CHECK — so the case would be testing nothing while looking like it ran. Guard it explicitly:

```sql
  IF a_log IS NULL THEN
    log := log || 'B1 both owners set' || E'\t'
        || 'SKIP: no daily_logs row to borrow a log_id from' || E'\n';
  ELSE
    -- ... B1 as written
  END IF;
```

B2 needs no such guard: it sets both columns to NULL explicitly.

- [ ] **Step 2: Write the new function**

Create `docs/daily-log-retirement-rpcs.sql`. Start from the live body in `docs/task-assignment-rpcs.sql` — **copy it, including every comment**. Those comments record the ALREADY_APPROVED race, the atomic `WHERE`, and why the mentor notification lives in a subtransaction; losing them loses the reasoning behind three fix rounds.

The drop comes first and is not optional:

```sql
-- ============================================
-- submit_assignment: new signature, carrying the reflection and the evidence
-- ============================================
--
-- The old signature MUST be dropped, not merely replaced. CREATE OR REPLACE
-- with a different argument list creates an OVERLOAD, and PostgREST resolves
-- overloads by the argument names a caller sends -- so both would live in the
-- catalog and a client sending the old three would silently keep hitting the
-- old body. That surfaces as an intermittent wrong-behaviour bug, not as an
-- error at deploy time.
DROP FUNCTION IF EXISTS submit_assignment(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION submit_assignment(
  p_assignment_id UUID,
  p_note          TEXT  DEFAULT NULL,
  p_reflection    TEXT  DEFAULT NULL,
  p_photos        JSONB DEFAULT '[]'::jsonb,
  p_documents     JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_group     UUID;
  submission       UUID;
  assignment_title TEXT;
  the_mentor       UUID;
  student_name     TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- Refuse before any write. A blank reflection is the one new precondition
  -- this signature adds, and it is checked here so the student gets a named
  -- refusal instead of a half-written submission.
  IF btrim(coalesce(p_reflection, '')) = '' THEN
    RAISE EXCEPTION 'REFLECTION_REQUIRED';
  END IF;

  -- ... everything from the live body, unchanged, down to and including the
  -- `IF submission IS NULL THEN RAISE EXCEPTION 'ALREADY_APPROVED'; END IF;`
```

The INSERT changes in two places — `reflection` joins the column list, and `log_id` leaves it:

```sql
  INSERT INTO assignment_submissions
    (assignment_id, student_id, status, student_note, reflection, submitted_at)
  VALUES (p_assignment_id, auth.uid(), 'submitted', p_note, p_reflection, now())
  ON CONFLICT (assignment_id, student_id) DO UPDATE
    SET status = 'submitted',
        student_note = EXCLUDED.student_note,
        reflection = EXCLUDED.reflection,
        submitted_at = now(),
        reviewed_at = NULL,
        reviewed_by = NULL
    WHERE assignment_submissions.status <> 'approved'
  RETURNING id INTO submission;
```

`log_id` stays on the table and stops being written. Do not drop the column: `docs/database-schema.sql` and the archive screens still reference it, and a dropped column is not idempotent to re-add.

- [ ] **Step 3: Write the evidence block**

Immediately after the `IF submission IS NULL` guard and before the notification block:

```sql
  -- Evidence, written here rather than by the client.
  --
  -- assignment_submissions has no draft state -- this function inserts
  -- straight to 'submitted' -- so there is no row for a client to attach
  -- photos to beforehand, and attaching them afterwards would leave a window
  -- where the mentor sees an evidence-less submission. The files are already
  -- in the bucket by the time this runs; only the rows are written here.
  --
  -- Delete-then-rewrite, not append: the client sends the full list, so a
  -- student who removes a photo and resubmits must end up without it. The
  -- pattern is the one record_kpi_observations uses.
  DELETE FROM log_photos    WHERE submission_id = submission;
  DELETE FROM log_documents WHERE submission_id = submission;

  INSERT INTO log_photos (submission_id, uri, caption)
  SELECT submission, e.uri, e.caption
  FROM jsonb_to_recordset(coalesce(p_photos, '[]'::jsonb))
       AS e(uri TEXT, caption TEXT)
  WHERE e.uri IS NOT NULL;

  INSERT INTO log_documents (submission_id, uri, file_name, file_type, file_size)
  SELECT submission, e.uri, e.file_name, e.file_type, coalesce(e.file_size, 0)
  FROM jsonb_to_recordset(coalesce(p_documents, '[]'::jsonb))
       AS e(uri TEXT, file_name TEXT, file_type TEXT, file_size INTEGER)
  WHERE e.uri IS NOT NULL;
```

`jsonb_to_recordset` matches keys to column names case-sensitively, so the JSON the client sends uses `file_name`, `file_type`, `file_size` — snake_case, not the camelCase the TypeScript layer uses elsewhere. D2's service is responsible for that mapping; record it in the file as a comment so the two halves cannot drift.

The `WHERE e.uri IS NOT NULL` drops malformed elements rather than inserting a row with a null `uri` into a `NOT NULL` column, which would abort the whole submission.

- [ ] **Step 4: Re-grant**

The old GRANT died with the old signature.

```sql
GRANT EXECUTE ON FUNCTION submit_assignment(UUID, TEXT, TEXT, JSONB, JSONB) TO authenticated;
```

- [ ] **Step 5: Commit**

```bash
git add docs/daily-log-retirement-rpcs.sql docs/daily-log-retirement-verification.sql
git commit -m "feat(d1): submit_assignment carries the reflection and the evidence

New signature. The old one is DROPped, not replaced: a differing argument
list makes an overload, and PostgREST picks by argument names, so the old
body would keep answering old callers with no error anywhere.

Evidence is delete-then-rewrite because the client sends the full list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Gamification moves inside the RPC

**Files:**
- Modify: `docs/daily-log-retirement-rpcs.sql`
- Modify: `docs/daily-log-retirement-verification.sql` (append Part B cases)

**Interfaces:**
- Consumes: `submit_assignment` from Task 2; `award_xp_internal(UUID, INTEGER, TEXT, UUID)` and `award_badge_internal(UUID, TEXT)` from `docs/gamification-server-side-migration.sql`.
- Produces: XP reasons `assignment_submitted:<submission_id>` and `assignment_photo:<submission_id>`; badge key `first_task`; `student_profiles.current_streak` counted in weeks.

- [ ] **Step 1: Write the failable streak case first**

This is the assertion the spec singles out. Under the daily version `UNIQUE(student_id, date)` made a same-period double-count impossible by construction; here nothing does, so it has to be written. Append to Part B:

```sql
  -- B5. Two submissions in the same week must not move the streak twice.
  --     The daily version got this for free from UNIQUE(student_id, date).
  --     Here it is a branch that can be deleted without any other case
  --     noticing, which is exactly why it gets a case of its own.
  SELECT current_streak INTO n FROM student_profiles WHERE id = the_student;

  PERFORM submit_assignment(a_assign2, 'same week', 'learned another thing',
    '[]'::jsonb, '[]'::jsonb);

  SELECT current_streak INTO n2 FROM student_profiles WHERE id = the_student;
  log := log || 'B5 same-week streak' || E'\t'
      || CASE WHEN n2 = n THEN 'unchanged at ' || n
              ELSE 'FAIL: moved ' || n || ' -> ' || n2
                   || ' for a second task in the same week' END || E'\n';

  -- B6. Submit XP is paid once per submission, not once per submit call.
  --     B4 already called submit_assignment twice on a_assign.
  SELECT count(*) INTO n FROM xp_transactions x
  WHERE x.student_id = the_student
    AND x.reason = 'assignment_submitted:' || (
      SELECT s.id FROM assignment_submissions s
      WHERE s.assignment_id = a_assign AND s.student_id = the_student)::text;
  log := log || 'B6 submit XP once' || E'\t'
      || CASE WHEN n = 1 THEN '1 transaction after two submits'
              ELSE 'FAIL: ' || n || ' transactions' END || E'\n';

  -- B7. The photo bonus counts the evidence this function just wrote. A
  --     trigger on assignment_submissions would fire before those rows exist
  --     and always read zero -- the reason the awards live in the RPC.
  SELECT coalesce(sum(x.amount), 0) INTO n FROM xp_transactions x
  WHERE x.student_id = the_student
    AND x.reason = 'assignment_photo:' || (
      SELECT s.id FROM assignment_submissions s
      WHERE s.assignment_id = a_assign AND s.student_id = the_student)::text;
  log := log || 'B7 photo bonus sees evidence' || E'\t'
      || CASE WHEN n = 6 THEN '6 XP for the two photos at first submit'
              WHEN n = 0 THEN 'FAIL: 0 XP -- the count ran before the evidence was written'
              ELSE 'FAIL: ' || n || ' XP, expected 6' END || E'\n';
```

B5 needs a second assignment, `a_assign2`, in the same group. Add it to the fixture alongside `a_assign`, from the same KPI's second triplet — `ORDER BY tr.triplet_index OFFSET 1 LIMIT 1`. A second submission against `a_assign` would be a resubmission and would not exercise the branch at all.

B7 expects 6 because B4's first call sends two photos at 3 XP each, and the bonus is first-submission-only.

- [ ] **Step 2: Write the gamification block**

In `docs/daily-log-retirement-rpcs.sql`, after the evidence block and before the notification block. Add `v_photos INTEGER; v_week DATE; v_prev_week DATE; v_streak INTEGER;` to the DECLARE list.

```sql
  -- Gamification, first submission only.
  --
  -- All of it lives here rather than in a trigger, and that is not a style
  -- choice. A trigger on assignment_submissions fires when the submission row
  -- is written, which is BEFORE the evidence block above -- a photo count read
  -- from a trigger is always zero. Approval XP stays in the
  -- award_assignment_xp trigger, where no such ordering exists.
  --
  -- Doing it here is safe because this function is the only way a submission
  -- row can exist: assignment_submissions has no write policy at all, so RLS
  -- forbids direct inserts and only SECURITY DEFINER can write.
  --
  -- The guard is the submission id inside `reason`. That id is stable across
  -- resubmissions because the statement above upserts, so a resubmit cannot
  -- earn submit XP, the photo bonus or a streak step a second time. It is also
  -- what stops a student resubmitting an old task in a quiet week to keep a
  -- streak alive without doing new work.
  IF NOT EXISTS (
    SELECT 1 FROM xp_transactions x
    WHERE x.student_id = auth.uid()
      AND x.reason = 'assignment_submitted:' || submission::text
  ) THEN
    PERFORM award_xp_internal(auth.uid(), 10,
      'assignment_submitted:' || submission::text, NULL);

    -- Mirrors POINT_VALUES.photoAttached (3) and the daily log's cap of 5.
    SELECT count(*) INTO v_photos FROM log_photos WHERE submission_id = submission;
    IF v_photos > 0 THEN
      PERFORM award_xp_internal(auth.uid(), 3 * LEAST(v_photos, 5),
        'assignment_photo:' || submission::text, NULL);
    END IF;

    PERFORM award_badge_internal(auth.uid(), 'first_task');

    -- Weekly streak: consecutive ISO weeks containing at least one submission.
    -- date_trunc('week', ...) returns the Monday, so `- 7` is the week before.
    v_week := date_trunc('week', now())::date;

    SELECT MAX(date_trunc('week', s.submitted_at)::date) INTO v_prev_week
    FROM assignment_submissions s
    WHERE s.student_id = auth.uid() AND s.id <> submission;

    -- IS DISTINCT FROM, not <>: a first-ever submission has a NULL prev_week,
    -- and `NULL <> v_week` is NULL, which would skip the whole block and leave
    -- the streak at 0 forever.
    IF v_prev_week IS DISTINCT FROM v_week THEN
      IF v_prev_week = v_week - 7 THEN
        SELECT current_streak + 1 INTO v_streak
        FROM student_profiles WHERE id = auth.uid();
      ELSE
        v_streak := 1;
      END IF;

      UPDATE student_profiles
      SET current_streak = v_streak,
          longest_streak = GREATEST(longest_streak, v_streak)
      WHERE id = auth.uid();

      -- 4 and 8 weeks, down from 7 and 30 days. The badge ids are kept so
      -- rows students already hold are not orphaned; only the copy in
      -- en.json changes.
      IF v_streak >= 8 THEN
        PERFORM award_badge_internal(auth.uid(), 'streak_30');
      ELSIF v_streak >= 4 THEN
        PERFORM award_badge_internal(auth.uid(), 'streak_7');
      END IF;
    END IF;
  END IF;
```

The equality branch of `IS DISTINCT FROM` is the one B5 tests: a second submission in the same week falls through and touches nothing.

- [ ] **Step 3: Commit**

```bash
git add docs/daily-log-retirement-rpcs.sql docs/daily-log-retirement-verification.sql
git commit -m "feat(d1): submit-side gamification moves into the RPC

Submit XP, the photo bonus, first_task and a weekly streak, all after the
evidence rows exist. A trigger fires before them and would always count
zero photos; approval XP stays in the trigger, where no ordering exists.

The streak counts ISO weeks. A second task in the same week must not move
it -- free under UNIQUE(student_id, date), a deletable branch here, so B5
tests it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The badge catalogue and its copy

**Files:**
- Modify: `src/types/gamification.ts`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: badge key `first_task` from Task 3.
- Produces: a `BADGES` entry keyed `first_task`; `badges.firstTask.{name,description}` and revised `badges.streak7.description` / `badges.streak30.description`.

Badges are **not** seeded in the database. `earned_badges` stores a free-text `badge_key` with no foreign key, and the catalogue is the `BADGES` array in `src/types/gamification.ts`. So `first_task` needs no schema change — but without an array entry the badge is earned and renders as nothing.

- [ ] **Step 1: Add the badge entry**

In `src/types/gamification.ts`, immediately after the `first_log` entry so the milestone badges stay together:

```typescript
  {
    id: 'first_task',
    key: 'first_task',
    nameKey: 'badges.firstTask.name',
    descriptionKey: 'badges.firstTask.description',
    icon: 'pencil',
    tier: 'bronze',
    requirement: 1,
    category: 'milestone',
  },
```

Leave `first_log` in place. It describes what its existing holders actually did, and removing it would blank the badge on their profile.

- [ ] **Step 2: Update the copy**

In `src/i18n/locales/en.json`, inside `badges`:

```json
    "firstTask": { "name": "First Step", "description": "Submit your first task" },
```

and change two existing descriptions:

```json
    "streak7":  { "name": "Week Warrior",   "description": "Submit a task 4 weeks running" },
    "streak30": { "name": "Monthly Master", "description": "Submit a task 8 weeks running" },
```

The names are kept. Renaming them would churn the copy for no gain, and both still read sensibly against the new thresholds. `badges.firstLog` is left exactly as it is.

- [ ] **Step 3: Verify the build**

```bash
npx tsc --noEmit && npx jest --silent
```

Expected: tsc silent, jest green at 4 suites / 23 tests.

- [ ] **Step 4: Commit**

```bash
git add src/types/gamification.ts src/i18n/locales/en.json
git commit -m "feat(d1): first_task badge and week-based streak copy

Badges live in the BADGES array, not the database -- earned_badges holds a
free-text key with no FK -- so first_task needs an entry here or it is
earned and renders as nothing.

streak_7 and streak_30 keep their ids so existing rows are not orphaned;
only their descriptions move from days to weeks.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Part C — the evidence policy, actually evaluated

**Files:**
- Modify: `docs/daily-log-retirement-verification.sql`

**Interfaces:**
- Consumes: the policies from Task 1, `submit_assignment` from Tasks 2 and 3.
- Produces: nothing downstream. This is the last task in D1.

Parts A and B run as the table owner, and an owner bypasses RLS. Every assertion so far proves a policy *exists*. Part C is the only place in D1 that proves one can be *evaluated* — the lesson of the `42P17` recursion that two green verification runs missed in August.

- [ ] **Step 1: Write Part C**

Append to `docs/daily-log-retirement-verification.sql`. Mirror `docs/task-assignment-verification.sql`'s Part C exactly: owner-built fixtures, ids handed over in transaction-local GUCs, `SET LOCAL ROLE authenticated`, `RESET ROLE` before the results are read, `ROLLBACK` at the end.

```sql
-- ============================================================
-- PART C — the evidence policy, actually evaluated.
-- Submit BEGIN..ROLLBACK in one go.
--
--   C1 owner student reads   1 photo        (positive control)
--   C2 unrelated student     0 photos
--   C3 evidence on approved  refused by RLS (42501)
--
-- C1 is the positive control and is not optional. Without it, C2 returning
-- zero is indistinguishable from the policy refusing everyone, or from the
-- new branch never being reached at all.
-- ============================================================

BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; other UUID; grp UUID; kpi UUID;
  a_open UUID; a_done UUID; s_open UUID; s_done UUID;
BEGIN
  SELECT id INTO adv   FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu   FROM profiles WHERE role = 'student'  ORDER BY created_at LIMIT 1;
  SELECT id INTO other FROM profiles WHERE role = 'student' AND id <> stu
                                     ORDER BY created_at LIMIT 1;

  IF adv IS NULL OR stu IS NULL OR other IS NULL THEN
    PERFORM set_config('probe.ready', 'no', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name)
  VALUES (adv, 'Probe D1 policies') RETURNING id INTO grp;

  SELECT k.id INTO kpi
  FROM competency_kpis k
  JOIN competencies c ON c.id = k.competency_id
  WHERE k.level = 1 AND k.kpi_index = 1
  ORDER BY c.display_order LIMIT 1;

  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe open', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 0 LIMIT 1
  RETURNING id INTO a_open;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe done', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 1 LIMIT 1
  RETURNING id INTO a_done;

  -- Written directly rather than through submit_assignment: this is the owner
  -- session, and the point of the fixture is a known starting state, not an
  -- exercise of the RPC. Direct writes are only possible here BECAUSE the
  -- session is the owner -- which is exactly what C3 proves a client cannot do.
  INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection)
  VALUES (a_open, stu, 'submitted', 'probe') RETURNING id INTO s_open;

  INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection)
  VALUES (a_done, stu, 'approved', 'probe') RETURNING id INTO s_done;

  INSERT INTO log_photos (submission_id, uri) VALUES (s_open, 'probe://open');
  INSERT INTO log_photos (submission_id, uri) VALUES (s_done, 'probe://done');

  PERFORM set_config('probe.ready',  'yes',        true);
  PERFORM set_config('probe.stu',    stu::text,    true);
  PERFORM set_config('probe.other',  other::text,  true);
  PERFORM set_config('probe.s_open', s_open::text, true);
  PERFORM set_config('probe.s_done', s_done::text, true);
END $$;

-- If this raises 42501 in your editor, STOP. Do not replace the cases below
-- with catalog lookups: a structural check here would assert what Part A
-- already asserts while reading as though it had proved more. Report Part C
-- as unrunnable instead.
SET LOCAL ROLE authenticated;
```

The three cases, in the second `DO $$` block after the role change. PL/pgSQL variables do not outlive their block, so the ids come back out of the GUCs:

```sql
DO $$
DECLARE
  stu UUID; other UUID; s_open UUID; s_done UUID;
  n INT; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results',
      'C1-C3 policies' || E'\t'
      || 'SKIP: needs one advisor and two student profiles' || E'\n', true);
    RETURN;
  END IF;

  stu    := current_setting('probe.stu')::UUID;
  other  := current_setting('probe.other')::UUID;
  s_open := current_setting('probe.s_open')::UUID;
  s_done := current_setting('probe.s_done')::UUID;

  -- C1. The owning student reads their own evidence. POSITIVE CONTROL.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  SELECT count(*) INTO n FROM log_photos p WHERE p.submission_id = s_open;
  log := log || 'C1 owner student reads' || E'\t'
      || CASE WHEN n = 1 THEN '1 photo'
              WHEN n = 0 THEN 'FAIL: 0 photos -- the submission branch is unreachable'
              ELSE 'FAIL: ' || n || ' photos' END || E'\n';

  -- C2. An unrelated student. The branch delegates to
  --     assignment_submissions' own SELECT policy, which does not admit them.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other)::text, true);
  SELECT count(*) INTO n FROM log_photos p WHERE p.submission_id = s_open;
  log := log || 'C2 unrelated student' || E'\t'
      || CASE WHEN n = 0 THEN '0 photos'
              ELSE 'FAIL: ' || n || ' photos leaked' END || E'\n';

  -- C3. Attaching evidence to an APPROVED submission. The insert policy's
  --     status <> 'approved' clause must refuse: an approved submission has
  --     produced a KPI observation, and changing the evidence under it means
  --     a level standing on something the mentor never saw.
  --
  --     This one asserts an ERROR, unlike C2's row count, because INSERT is
  --     the one command where a failed WITH CHECK raises 42501 instead of
  --     silently filtering.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  BEGIN
    INSERT INTO log_photos (submission_id, uri) VALUES (s_done, 'probe://late');
    log := log || 'C3 evidence on approved' || E'\t'
        || 'FAIL: accepted -- evidence changed under a written observation' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN
    log := log || 'C3 evidence on approved' || E'\t' || 'refused by RLS (42501)' || E'\n';
  WHEN OTHERS THEN
    log := log || 'C3 evidence on approved' || E'\t'
        || 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;
```

Close with the same tail as `docs/task-assignment-verification.sql`: `PERFORM set_config('probe.results', log, true);`, `END $$;`, `RESET ROLE;`, the `split_part` SELECT over `string_to_array(current_setting('probe.results'), E'\n')`, then `ROLLBACK;`.

- [ ] **Step 2: Write the run instructions**

Append a short closing section to the verification file recording, for the person who runs it:

- The three parts are submitted **separately**, and Parts B and C each go in as one block from `BEGIN;` to `ROLLBACK;` — the editor gives each submission its own connection, so a transaction split across submissions loses its state (`42P01`).
- Expected output: Part A one row reading `PASS`; Part B seven rows; Part C three rows. Any cell beginning `FAIL` or `INCONCLUSIVE` is a real result, not noise.
- **This script requires the D1 SQL to be applied, which must not happen until D2 is complete** — Task 2 drops the signature the shipped client calls. Run this at the end of D2.

- [ ] **Step 3: Commit**

```bash
git add docs/daily-log-retirement-verification.sql
git commit -m "test(d1): Part C evaluates the evidence policy under RLS

Parts A and B run as table owner and prove only that a policy exists. Part
C sets LOCAL ROLE authenticated so a policy that cannot be evaluated fails
here rather than on a device.

C1 is a positive control: without it, C2's zero rows would be
indistinguishable from the branch never being reached.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Deferred to D2

Named here so they are not mistaken for gaps:

- `src/services/assignments.ts` — `submitAssignment` still sends the old three arguments. Changing it in D1 would break `my-tasks.tsx` and `npx tsc --noEmit` with no screen to replace it.
- The camelCase → snake_case mapping for the evidence JSON (`fileName` → `file_name`).
- Everything in the spec's section 5: the task form, three tab bars, two dashboards, `student-list`, `feedback`, the advisor's reports, and the deletion of `create-log.tsx`, `review-log.tsx` and `validation.tsx` — along with `KpiChecklist` and `competencyService.recordObservations`, which lose their last callers with those screens.
