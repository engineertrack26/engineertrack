# Assignment scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An advisor can schedule a prepared task to go out at a chosen moment —
"tomorrow at 15:00, to these two students" — instead of only when they tap send.

**Architecture:** A new `scheduled_for` column makes a third state between draft
and published; a scheduled assignment stays a draft to every rule that already
exists, so no visibility predicate is rewritten. Publishing is split into an
internal function that a human tap and a `pg_cron` job both call, and
notification writing moves out of the client into that function so one home
serves both.

**Tech Stack:** PostgreSQL / Supabase (RLS, `SECURITY DEFINER` RPCs, `pg_cron`;
SQL applied by hand in the SQL editor), Expo Router, React Native, TypeScript,
i18next, Jest.

**Spec:** `docs/superpowers/specs/2026-10-10-assignment-scheduling-design.md`

## Global Constraints

- **SQL files are idempotent** and use **anonymous `$$` only** — a named dollar
  tag fails in the Supabase SQL editor.
- **One SQL file per message** to the owner, who applies it by hand. Every
  verification part must **end in a `SELECT` that returns a result set**: the
  editor hides `NOTICE` and shows only the last statement's result.
- **Single-home rule:** a function body lives in exactly one file. When a
  function moves, the old file gets a `NOTE` saying that re-running it reverts
  the change. This plan moves `publish_assignments` out of
  `docs/assignment-targeting.sql`.
- **Every RPC refusal is a stable code** (`SCHEDULE_IN_PAST`,
  `ALREADY_PUBLISHED`, `NOT_IN_SCOPE`, `TARGETS_REQUIRED`, `ROLE_NOT_ALLOWED`)
  mapped by `mapRpcError` → `errors.*`. Never show a raw `err.message`.
- **Notification text written in SQL must be byte-identical to the English
  templates `src/utils/notificationContent.ts` already matches**, or the Turkish
  rendering silently stops working:
  - title `New Task Assigned`
  - body `A new task has been assigned: "<title>".`
  - body `<N> new tasks have been assigned.`
- **Never a bare `catch {}`.** A failed load shows `LoadFailedBanner`.
- **A function-form `style` prop on `Pressable` renders nothing on this
  runtime.** Static arrays, or `TouchableOpacity`.
- **Path aliases (`@/…`)**; a new import goes on its own line after a
  single-line import, or appended at the **end** of an existing braced list —
  never spliced into the middle of a multi-line braced import.
- **`taskFlow` is parity-tested**: a key added there must exist in all seven
  locales (en, tr, de, it, ro, sr, el) with real translations, or
  `src/i18n/__tests__/locales.test.ts` fails. `errors` and `advisor` are en + tr.
- Gates after every task: `npx tsc --noEmit` silent, `npx jest --silent` green,
  `npx eslint .` 0 errors and no more than the pre-existing warning count.
- Commits stage explicit paths only; never `git add -A`, `git add .`,
  `git stash`, `git checkout --`, `git reset`. Every commit message ends with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Never re-run anything under `sim/phases/`.**

## Review Focus

Five things the spec implies that no happy-path test would reach. Each one's
test is written into the task that owns the code.

1. **The cron fires while the advisor taps "Send now".** Both call the same
   internal function for the same rows; the second must publish nothing *and*
   notify nobody. Notifications must be derived from the rows the call actually
   moved, never from `p_ids`. (Task 1, Part B.)
2. **Two cron runs overlap.** A slow run still going when the next minute fires
   would claim the same due rows twice. The job takes an advisory lock and
   returns immediately if it cannot get it. (Task 1, Part B.)
3. **The group is archived between scheduling and the hour.** Nothing in
   `publish_assignments` checks archive today, so a scheduled task would publish
   into an archived group. It must fail and tell the advisor. (Task 1, Part B.)
4. **A batch where one row is already published.** `schedule_assignments` must
   refuse the whole batch with `ALREADY_PUBLISHED` rather than scheduling the
   rest. (Task 1, Part B.)
5. **The chosen wall-clock time crosses a DST change.** `timestamptz` stores an
   instant, so the task fires at the instant the advisor picked, which may be an
   hour off the wall clock they had in mind. That is the behaviour we want and
   the one we pin, so nobody "fixes" it later. (Task 3, Jest.)

---

## File Structure

**SQL (new):**
- `docs/assignment-scheduling.sql` — the columns, the index, the publish split,
  `schedule_assignments`, `publish_due_assignments`, the cron registration.
- `docs/assignment-scheduling-verification.sql` — Parts A / B / C.

**SQL (modified):** `docs/assignment-targeting.sql` — a `NOTE` only;
`publish_assignments` moves out of it.

**Client (new):**
- `src/utils/assignmentSchedule.ts` — pure helpers (state derivation, the
  send-before-due rule).
- `src/utils/__tests__/assignmentSchedule.test.ts`

**Client (modified):** `src/types/assignment.ts`, `src/types/notification.ts`,
`src/services/assignments.ts`, `src/utils/rpcErrors.ts`,
`src/utils/notificationRoutes.ts`, `src/utils/notificationContent.ts`,
`src/components/advisor/AssignmentReview.tsx`,
`app/(advisor)/group-assignments.tsx`, `src/components/cards/AssignmentCard.tsx`,
`src/i18n/locales/*.json`.

**Docs:** `CLAUDE.md`, the two amended specs' pointers, `PROGRESS.md`.

---

### Task 1: The server — the third state, the publish split, and the timer

**Files:**
- Create: `docs/assignment-scheduling.sql`
- Modify: `docs/assignment-targeting.sql` (header NOTE only)

**Interfaces produced** (Tasks 2–5 consume these):
- `group_assignments.scheduled_for TIMESTAMPTZ`, `group_assignments.schedule_error TEXT`
- `schedule_assignments(p_ids UUID[], p_at TIMESTAMPTZ) RETURNS INT`
- `publish_assignments(p_ids UUID[]) RETURNS INT` — unchanged signature
- `publish_assignments_internal(p_ids UUID[]) RETURNS INT` — revoked from clients
- `publish_due_assignments() RETURNS INT`
- refusal codes `SCHEDULE_IN_PAST`, `ALREADY_PUBLISHED`, `GROUP_ARCHIVED`
- notification type `schedule_failed`

This task writes SQL only. **Do not apply anything to any database** — there is
no local Postgres and the Supabase project is live production. The owner applies
the file by hand later.

- [ ] **Step 1: Read what you are moving, before you move it**

Open `docs/assignment-targeting.sql` and find `publish_assignments`. Its body is
the thing this task splits. Read it in full; Step 4 copies it almost verbatim and
a reviewer will diff your copy against it.

The archive marker is already settled, so you do not have to go looking:
`internship_groups.is_archived BOOLEAN NOT NULL DEFAULT false`
(`docs/internship-groups-migration.sql:33`). Archiving is this project's
retirement mechanism — there is no DELETE policy on the table — and
`docs/direct-messages-migration.sql:82` is the precedent for refusing an action
against an archived group.

- [ ] **Step 2: Create the file with its header and the two columns**

```sql
-- docs/assignment-scheduling.sql
-- Sending a task can be scheduled.
-- Spec: docs/superpowers/specs/2026-10-10-assignment-scheduling-design.md
--
-- APPLY ORDER: after docs/assignment-targeting.sql and
-- docs/assignment-targeting-followups.sql. Idempotent, anonymous $$ only.
--
-- THIS FILE IS NOW THE HOME OF publish_assignments (was
-- docs/assignment-targeting.sql, which carries a NOTE saying so). Re-running
-- that file restores a publish_assignments that knows nothing about
-- scheduling or notifications.
--
-- REQUIRES the pg_cron extension, enabled once in the Supabase dashboard
-- (Database -> Extensions). The job is registered at the bottom of this file.
-- ============================================

-- ---- 1. The third state ----
-- scheduled_for set with published_at still NULL is "scheduled". It is
-- deliberately NOT a future published_at: every existing rule tests
-- `published_at IS NOT NULL`, and rewriting all of them to `<= now()` would
-- make a missed one leak a scheduled task early. With a separate column the
-- worst case is a task that goes out a minute late.
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

-- Why the send failed at its scheduled time. Non-NULL also means "do not try
-- again": without it the job would retry and re-notify every minute forever.
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS schedule_error TEXT;

-- The job's only query. Partial, because the due set is tiny next to the table.
CREATE INDEX IF NOT EXISTS group_assignments_due_idx
  ON group_assignments (scheduled_for)
  WHERE published_at IS NULL AND scheduled_for IS NOT NULL AND schedule_error IS NULL;
```

- [ ] **Step 3: Append the internal publisher — the shared half**

Copy the scope re-check and the targets re-check from `publish_assignments`
**verbatim**; the only new parts are the archive check, the `RETURNING`-driven
update, and the notifications.

```sql
-- ---- 2. The shared publish ----
-- A human tap and the timer must do the same thing, so the body lives here and
-- both call it. No identity check: the public wrapper does that, and the cron
-- job has no auth.uid() to check.
CREATE OR REPLACE FUNCTION publish_assignments_internal(p_ids UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bad_title  TEXT;
  moved_ids  UUID[];
  one_title  TEXT;
  n          INT;
BEGIN
  -- Scope re-check. trg_assignment_within_scope is BEFORE INSERT only, so a
  -- competency dropped from the group's targets after drafting is caught here
  -- or not at all. Named title, not just a refusal.
  SELECT a.title INTO bad_title
  FROM group_assignments a
  JOIN kpi_triplets t    ON t.id = a.triplet_id
  JOIN competency_kpis k ON k.id = t.kpi_id
  WHERE a.id = ANY(p_ids)
    AND NOT EXISTS (
      SELECT 1 FROM group_competency_targets gt
      WHERE gt.group_id = a.group_id AND gt.competency_id = k.competency_id
    )
  LIMIT 1;
  IF bad_title IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_IN_SCOPE: %', bad_title;
  END IF;

  -- A 'selected' assignment naming nobody would reach no one at all.
  SELECT a.title INTO bad_title
  FROM group_assignments a
  WHERE a.id = ANY(p_ids)
    AND a.published_at IS NULL
    AND a.audience = 'selected'
    AND NOT EXISTS (SELECT 1 FROM assignment_targets tg WHERE tg.assignment_id = a.id)
  LIMIT 1;
  IF bad_title IS NOT NULL THEN
    RAISE EXCEPTION 'TARGETS_REQUIRED: %', bad_title;
  END IF;

  -- NEW: a group can be archived between scheduling and the hour. Publishing
  -- into an archived group would put a task in front of students whose
  -- internship the advisor has already wound up.
  IF EXISTS (
    SELECT 1 FROM group_assignments a
    JOIN internship_groups g ON g.id = a.group_id
    WHERE a.id = ANY(p_ids) AND g.is_archived
  ) THEN
    RAISE EXCEPTION 'GROUP_ARCHIVED';
  END IF;

  -- Only drafts move, and we keep exactly which ones did. Re-publishing an
  -- already-sent task must not rewrite its published_at -- that timestamp is
  -- the record of when students first saw it -- and must not notify again:
  -- the cron job and a "Send now" tap can reach the same row in the same
  -- second, and p_ids would tell us nothing about which of them won.
  WITH upd AS (
    UPDATE group_assignments
       SET published_at = now(), scheduled_for = NULL, schedule_error = NULL
     WHERE id = ANY(p_ids) AND published_at IS NULL
    RETURNING id, title
  )
  SELECT array_agg(id), CASE WHEN count(*) = 1 THEN min(title) END
    INTO moved_ids, one_title
  FROM upd;

  n := coalesce(array_length(moved_ids, 1), 0);
  IF n = 0 THEN
    RETURN 0;
  END IF;

  -- One notification per student for the whole batch, not one per task: three
  -- tasks sent together are one event to the student. The English wording is
  -- load-bearing -- src/utils/notificationContent.ts matches these exact
  -- templates to render Turkish, and a reworded string silently falls back to
  -- English.
  INSERT INTO notifications (user_id, title, body, type, data)
  SELECT r.student_id,
         'New Task Assigned',
         CASE WHEN n = 1
              THEN 'A new task has been assigned: "' || coalesce(one_title, '') || '".'
              ELSE n || ' new tasks have been assigned.'
         END,
         'task_assigned',
         '{}'::jsonb
  FROM (
    -- A group-audience task in the batch puts the whole group in the set,
    -- whatever any other task in the batch narrows to.
    SELECT m.student_id
    FROM group_assignments a
    JOIN group_memberships m ON m.group_id = a.group_id AND m.left_at IS NULL
    WHERE a.id = ANY(moved_ids) AND a.audience = 'group'
    UNION
    SELECT tg.student_id
    FROM group_assignments a
    JOIN assignment_targets tg ON tg.assignment_id = a.id
    JOIN group_memberships m   ON m.group_id = a.group_id
                              AND m.student_id = tg.student_id
                              AND m.left_at IS NULL
    WHERE a.id = ANY(moved_ids) AND a.audience = 'selected'
  ) r;

  RETURN n;
END;
$$;

-- Only callers inside the database, exactly like feed_publish_assignment.
REVOKE EXECUTE ON FUNCTION publish_assignments_internal(UUID[]) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Append the public wrapper — the identity half**

```sql
-- ---- 3. publish_assignments: NEW HOME, now a thin wrapper ----
CREATE OR REPLACE FUNCTION publish_assignments(p_ids UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- SECURITY DEFINER has no RLS of its own, so ownership is checked here or
  -- not at all. Any row in the batch the caller does not own refuses the batch.
  IF EXISTS (
    SELECT 1 FROM group_assignments a
    WHERE a.id = ANY(p_ids) AND NOT owns_group(a.group_id)
  ) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  RETURN publish_assignments_internal(p_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION publish_assignments(UUID[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION publish_assignments(UUID[]) FROM PUBLIC, anon;
```

- [ ] **Step 5: Append `schedule_assignments`**

```sql
-- ---- 4. Writing the schedule ----
-- Runs at schedule time every check publishing runs, because at 15:00 nobody
-- is there to read an alert. p_at NULL cancels.
CREATE OR REPLACE FUNCTION schedule_assignments(p_ids UUID[], p_at TIMESTAMPTZ)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bad_title TEXT;
  n INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM group_assignments a
    WHERE a.id = ANY(p_ids) AND NOT owns_group(a.group_id)
  ) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  -- A sent task cannot be un-sent by scheduling it again. Refuses the whole
  -- batch rather than scheduling the rest, the same all-or-nothing shape
  -- publishing already has.
  IF EXISTS (
    SELECT 1 FROM group_assignments a
    WHERE a.id = ANY(p_ids) AND a.published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_PUBLISHED';
  END IF;

  IF p_at IS NOT NULL THEN
    IF p_at <= now() THEN
      RAISE EXCEPTION 'SCHEDULE_IN_PAST';
    END IF;

    SELECT a.title INTO bad_title
    FROM group_assignments a
    JOIN kpi_triplets t    ON t.id = a.triplet_id
    JOIN competency_kpis k ON k.id = t.kpi_id
    WHERE a.id = ANY(p_ids)
      AND NOT EXISTS (
        SELECT 1 FROM group_competency_targets gt
        WHERE gt.group_id = a.group_id AND gt.competency_id = k.competency_id
      )
    LIMIT 1;
    IF bad_title IS NOT NULL THEN
      RAISE EXCEPTION 'NOT_IN_SCOPE: %', bad_title;
    END IF;

    SELECT a.title INTO bad_title
    FROM group_assignments a
    WHERE a.id = ANY(p_ids)
      AND a.audience = 'selected'
      AND NOT EXISTS (SELECT 1 FROM assignment_targets tg WHERE tg.assignment_id = a.id)
    LIMIT 1;
    IF bad_title IS NOT NULL THEN
      RAISE EXCEPTION 'TARGETS_REQUIRED: %', bad_title;
    END IF;
  END IF;

  -- Scheduling afresh clears a previous failure, which is how the advisor
  -- takes a failed row out of the skip list.
  UPDATE group_assignments
     SET scheduled_for = p_at, schedule_error = NULL
   WHERE id = ANY(p_ids) AND published_at IS NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION schedule_assignments(UUID[], TIMESTAMPTZ) TO authenticated;
REVOKE EXECUTE ON FUNCTION schedule_assignments(UUID[], TIMESTAMPTZ) FROM PUBLIC, anon;
```

- [ ] **Step 6: Append the timer entry point**

```sql
-- ---- 5. What runs every minute ----
-- Batches, not rows: rows scheduled together by one action were one decision,
-- and publishing them row by row would turn a batch of three into three
-- notifications. Grouping also keeps the all-or-nothing refusal the manual
-- path has.
CREATE OR REPLACE FUNCTION publish_due_assignments()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b     RECORD;
  total INT := 0;
BEGIN
  -- A run that overruns its minute would otherwise meet the next one on the
  -- same due rows. The lock is released when the session ends, which for a
  -- cron run is the end of this statement.
  IF NOT pg_try_advisory_lock(hashtext('publish_due_assignments')) THEN
    RETURN 0;
  END IF;

  FOR b IN
    SELECT a.group_id, a.scheduled_for, array_agg(a.id ORDER BY a.created_at) AS ids
    FROM group_assignments a
    WHERE a.published_at IS NULL
      AND a.scheduled_for IS NOT NULL
      AND a.scheduled_for <= now()
      AND a.schedule_error IS NULL
    GROUP BY a.group_id, a.scheduled_for
  LOOP
    BEGIN
      total := total + publish_assignments_internal(b.ids);
    EXCEPTION WHEN OTHERS THEN
      -- BEGIN .. EXCEPTION opens a savepoint, so a refused batch rolls back
      -- only itself and the healthy batches in this run still publish.
      UPDATE group_assignments
         SET schedule_error = left(SQLERRM, 200)
       WHERE id = ANY(b.ids);

      -- Without this the task would simply never arrive and nobody would
      -- know. The job runs inside the database, so it writes the row itself.
      INSERT INTO notifications (user_id, title, body, type, data)
      SELECT g.advisor_id,
             'Scheduled task not sent',
             'A task scheduled for ' || g.name || ' could not be sent: ' || left(SQLERRM, 120),
             'schedule_failed',
             jsonb_build_object('groupId', b.group_id)
      FROM internship_groups g
      WHERE g.id = b.group_id;
    END;
  END LOOP;

  PERFORM pg_advisory_unlock(hashtext('publish_due_assignments'));
  RETURN total;
END;
$$;

REVOKE EXECUTE ON FUNCTION publish_due_assignments() FROM PUBLIC, anon, authenticated;
```

Check `internship_groups` really has a `name` column before using it in that
body; if the column is named differently, use the real one.

- [ ] **Step 7: Append the cron registration**

```sql
-- ---- 6. The job ----
-- Idempotent: unschedule first, because cron.schedule on an existing jobname
-- behaves differently across pg_cron versions.
DO $$
BEGIN
  PERFORM cron.unschedule('publish-due-assignments')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-due-assignments');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- no such job, or pg_cron not yet enabled; the SELECT below reports it
END;
$$;

SELECT cron.schedule('publish-due-assignments', '* * * * *',
                     'SELECT publish_due_assignments();');
```

If `cron.schedule` fails because the extension is not enabled, that is the
owner's dashboard step and not something this file should try to do itself —
say so in a comment above it.

- [ ] **Step 8: Add the NOTE to the old home**

At the top of `docs/assignment-targeting.sql`:

```sql
-- NOTE (2026-10-10): publish_assignments NO LONGER LIVES HERE.
-- docs/assignment-scheduling.sql holds the copy that stands: it is a thin
-- wrapper over publish_assignments_internal, which also writes the
-- "New Task Assigned" notifications and refuses an archived group.
-- Re-running this file restores a publish_assignments that does none of that,
-- so published tasks would stop notifying anyone, silently.
```

- [ ] **Step 9: Check and commit**

```bash
grep -c '\$\$' docs/assignment-scheduling.sql          # even
grep -n 'AS \$[a-z]' docs/assignment-scheduling.sql    # prints nothing
npx tsc --noEmit
```

```bash
git add docs/assignment-scheduling.sql docs/assignment-targeting.sql
git commit -m "feat(sql): a task's send can be scheduled

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The verification script

**Files:** Create `docs/assignment-scheduling-verification.sql`

**Interfaces:** consumes everything Task 1 produces; produces the owner's
PASS/FAIL table.

Follow `docs/assignment-targeting-verification.sql` exactly for shape: a `DO`
block accumulating PASS/FAIL into a `v_log TEXT`, published through
`set_config('probe.results', v_log, true)` and unpacked by a final `SELECT` over
`regexp_split_to_table`, inside `BEGIN … ROLLBACK`, **each check in its own
`BEGIN … EXCEPTION` sub-block**, with the expected row count in the part header.

Three traps that file already documents and that apply here too:

- `integer` → `smallint` is not an implicit cast in function resolution;
  `submit_assignment`'s last argument needs `2::SMALLINT`.
- Impersonation is
  `set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role', 'authenticated')::text, true)`
  — the `role` key matters whenever a policy tests `auth.role()`.
- Part B is owner-run, so a raw `SELECT` bypasses RLS; test visibility through
  the predicates, and leave real policy evaluation to Part C.

- [ ] **Step 1: Part A — structural**

One query, 8 rows, all PASS: `scheduled_for` and `schedule_error` exist;
`group_assignments_due_idx` exists; `publish_assignments_internal` and
`publish_due_assignments` are `SECURITY DEFINER` with a fixed `search_path` and
are **not** executable by `authenticated`; `schedule_assignments` and
`publish_assignments` **are**; and `cron.job` holds a row named
`publish-due-assignments` with schedule `* * * * *`.

Guard the `cron.job` check so a database without pg_cron reports a worded FAIL
rather than aborting the whole part:

```sql
  UNION ALL SELECT 'A8 the cron job is registered every minute',
         coalesce((SELECT count(*) = 1 FROM cron.job
                   WHERE jobname = 'publish-due-assignments'
                     AND schedule = '* * * * *'), false)
```

If `cron` is not a known schema that query errors at parse time, so wrap Part A's
`cron` check in its own statement after the main one and say in the header that
it reports separately.

- [ ] **Step 2: Part B — behaviour, against the simulation group `58MMWL`**

Expected 12 lines. Create two drafts from a triplet already inside the group's
competency scope, as `docs/assignment-targeting-verification.sql` Part B does,
and impersonate the advisor. The checks:

1. `schedule_assignments(ids, now() - interval '1 hour')` raises `SCHEDULE_IN_PAST`.
2. `schedule_assignments(ids, now() + interval '1 hour')` returns 2, and both
   rows read `scheduled_for` set with `published_at` still NULL.
3. A scheduled row is invisible to a member through `can_see_assignment`, and
   `submit_assignment` on it is refused — it is still a draft.
4. `publish_due_assignments()` publishes nothing while the time is in the future.
5. Back-date `scheduled_for` by a minute, then `publish_due_assignments()`
   returns 2, both rows have `published_at` set and `scheduled_for` NULL.
6. **One notification per recipient, not per assignment** *(Review Focus 1)*:
   after check 5 each active member has exactly one new `task_assigned` row, and
   its body is the plural template `'2 new tasks have been assigned.'`.
7. **A second call notifies nobody** *(Review Focus 1)*: calling
   `publish_assignments_internal` again with the same ids returns 0 and adds no
   notification row.
8. A group-audience publish created a `feed_posts` row; a selected one does not.
9. **An archived group fails and tells the advisor** *(Review Focus 3)*:
   `UPDATE internship_groups SET is_archived = true WHERE id = g`, schedule a
   fresh draft into the past, run the job — nothing publishes, the row carries
   `schedule_error`, and the advisor has a `schedule_failed` notification. The
   whole part rolls back, so the flag never survives the run.
10. **The failed row is skipped next run**: running the job again leaves the
    error in place and writes no second notification.
11. **A batch with one published row is refused whole** *(Review Focus 4)*:
    `schedule_assignments` over one published and one draft raises
    `ALREADY_PUBLISHED` and the draft is still unscheduled.
12. **Overlapping runs** *(Review Focus 2)*: take the advisory lock
    (`pg_advisory_lock(hashtext('publish_due_assignments'))`) in the session,
    then call `publish_due_assignments()` — it returns 0 without publishing the
    due row. Release the lock and confirm it then publishes.

- [ ] **Step 3: Part C — policies under `SET LOCAL ROLE authenticated`**

Expected 3 rows: a student cannot `SELECT` a scheduled assignment; `authenticated`
cannot call `publish_assignments_internal`; `authenticated` cannot call
`publish_due_assignments`.

- [ ] **Step 4: Check and commit**

```bash
grep -c '\$\$' docs/assignment-scheduling-verification.sql   # even
grep -n 'AS \$[a-z]' docs/assignment-scheduling-verification.sql
```

```bash
git add docs/assignment-scheduling-verification.sql
git commit -m "test(sql): verification for assignment scheduling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand over and stop**

Stop here. The controller hands the owner, one message each:
`docs/assignment-scheduling.sql`, then Parts A, B and C. The owner must first
enable **pg_cron** in the Supabase dashboard (Database → Extensions).

Once the owner reports the results, regenerate the types:

```bash
npx supabase gen types typescript --project-id ocxpymvikzujdqefnoqg --schema public > src/types/database.ts
```

---

### Task 3: Types, service, pure helpers

**Files:**
- Create: `src/utils/assignmentSchedule.ts`, `src/utils/__tests__/assignmentSchedule.test.ts`
- Modify: `src/types/assignment.ts`, `src/types/notification.ts`,
  `src/services/assignments.ts`, `src/utils/rpcErrors.ts`,
  `src/utils/notificationRoutes.ts`, `src/utils/notificationContent.ts`,
  `src/i18n/locales/en.json`, `tr.json`

**Interfaces produced:**
- `GroupAssignment.scheduledFor?: string`, `GroupAssignment.scheduleError?: string`
- `type ScheduleState = 'draft' | 'scheduled' | 'overdue' | 'failed'`
- `scheduleState(a: Pick<GroupAssignment,'scheduledFor'|'scheduleError'>, now?: Date): ScheduleState`
- `sendBeforeDue(sendAtIso: string, dueDate?: string): boolean`
- `assignmentService.scheduleAssignments(ids: string[], at: string | null): Promise<number>`

- [ ] **Step 1: Write the failing tests**

`src/utils/__tests__/assignmentSchedule.test.ts`:

```ts
import { scheduleState, sendBeforeDue } from '@/utils/assignmentSchedule';

const NOW = new Date('2026-10-10T12:00:00Z');

describe('scheduleState', () => {
  it('is a plain draft when nothing is scheduled', () => {
    expect(scheduleState({}, NOW)).toBe('draft');
  });

  it('is scheduled while the time is still ahead', () => {
    expect(scheduleState({ scheduledFor: '2026-10-10T15:00:00Z' }, NOW)).toBe('scheduled');
  });

  // The job should have published this and did not. Surfacing it is the only
  // thing that makes a silent pg_cron outage visible to the advisor.
  it('is overdue once the time has passed and it is still unpublished', () => {
    expect(scheduleState({ scheduledFor: '2026-10-10T11:00:00Z' }, NOW)).toBe('overdue');
  });

  // A failed row's time is necessarily in the past, so both conditions hold.
  // Failed wins: it tells the advisor something is wrong, not merely late.
  it('is failed rather than overdue when the send was refused', () => {
    expect(scheduleState(
      { scheduledFor: '2026-10-10T11:00:00Z', scheduleError: 'GROUP_ARCHIVED' }, NOW,
    )).toBe('failed');
  });
});

describe('sendBeforeDue', () => {
  it('accepts a send before the due date', () => {
    expect(sendBeforeDue('2026-10-11T15:00:00Z', '2026-10-20')).toBe(true);
  });

  // Otherwise the advisor hands a student a task that was already overdue
  // when it arrived.
  it('rejects a send after the due date', () => {
    expect(sendBeforeDue('2026-10-25T15:00:00Z', '2026-10-20')).toBe(false);
  });

  // The due date is a local calendar day; a send at any hour of that day is
  // still on time.
  it('accepts a send on the due date itself', () => {
    expect(sendBeforeDue('2026-10-20T23:00:00Z', '2026-10-20')).toBe(true);
  });

  it('accepts anything when there is no due date', () => {
    expect(sendBeforeDue('2026-10-25T15:00:00Z', undefined)).toBe(true);
  });
});

// Review Focus 5: timestamptz stores an instant. A time chosen before a DST
// change fires at that instant, which may be an hour off the wall clock the
// advisor pictured. That is the behaviour we want -- pinned here so nobody
// "fixes" it into a floating wall-clock time later.
describe('the stored value is an instant, not a wall clock', () => {
  it('keeps the chosen instant across a DST boundary', () => {
    const chosen = new Date('2026-10-25T13:00:00Z');
    expect(scheduleState({ scheduledFor: chosen.toISOString() },
      new Date('2026-10-25T12:59:00Z'))).toBe('scheduled');
    expect(scheduleState({ scheduledFor: chosen.toISOString() },
      new Date('2026-10-25T13:01:00Z'))).toBe('overdue');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx jest src/utils/__tests__/assignmentSchedule.test.ts`
Expected: FAIL — "Cannot find module '@/utils/assignmentSchedule'".

- [ ] **Step 3: Write the helpers**

```ts
import type { GroupAssignment } from '@/types/assignment';

export type ScheduleState = 'draft' | 'scheduled' | 'overdue' | 'failed';

/** What a draft's card should say. `overdue` means the timer should have
 *  published this and did not — the only signal an advisor gets that the
 *  scheduler itself has stopped. */
export function scheduleState(
  a: Pick<GroupAssignment, 'scheduledFor' | 'scheduleError'>,
  now: Date = new Date(),
): ScheduleState {
  if (a.scheduleError) return 'failed';
  if (!a.scheduledFor) return 'draft';
  return new Date(a.scheduledFor).getTime() <= now.getTime() ? 'overdue' : 'scheduled';
}

/** The due date is a local calendar day (`YYYY-MM-DD`), so the whole of that
 *  day is still on time; only a send after it is refused. */
export function sendBeforeDue(sendAtIso: string, dueDate?: string): boolean {
  if (!dueDate) return true;
  return new Date(sendAtIso).getTime() <= new Date(`${dueDate}T23:59:59`).getTime();
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx jest src/utils/__tests__/assignmentSchedule.test.ts` — all PASS.

- [ ] **Step 5: Add the types**

In `src/types/assignment.ts`, inside `GroupAssignment` after `publishedAt`:

```ts
  /** Set with publishedAt still unset means scheduled: the row is a draft to
   *  every rule that exists, and a timer will publish it. Cleared on publish. */
  scheduledFor?: string;
  /** Why the scheduled send was refused. Non-empty also means the job will not
   *  try again until the advisor re-schedules. */
  scheduleError?: string;
```

In `src/types/notification.ts`, add `| 'schedule_failed'` to `NotificationType`.

- [ ] **Step 6: Wire the service**

In `src/services/assignments.ts`, add to the row mapper beside `audience`:

```ts
    scheduledFor: (row.scheduled_for as string) || undefined,
    scheduleError: (row.schedule_error as string) || undefined,
```

and the method:

```ts
  /** Sets or clears the send time for a batch. `null` cancels and returns the
   *  rows to plain drafts. Every check publishing runs happens here too, so a
   *  refusal reaches the advisor while they are still looking at the screen.
   *  See schedule_assignments in docs/assignment-scheduling.sql. */
  async scheduleAssignments(ids: string[], at: string | null): Promise<number> {
    const { data, error } = await supabase.rpc('schedule_assignments', {
      p_ids: ids, p_at: at,
    });
    if (error) throw new RpcError(error.message);
    return (data as number) ?? 0;
  },
```

- [ ] **Step 7: Map the new refusals and route the new notification**

In `src/utils/rpcErrors.ts`:

```ts
  SCHEDULE_IN_PAST: 'errors.scheduleInPast',
  ALREADY_PUBLISHED: 'errors.alreadyPublished',
  GROUP_ARCHIVED: 'errors.groupArchived',
```

`en.json` / `tr.json` under `errors`:

```json
"scheduleInPast": "Choose a time in the future.",
"alreadyPublished": "This task has already been sent, so it cannot be scheduled.",
"groupArchived": "This group is archived, so tasks can no longer be sent to it."
```

```json
"scheduleInPast": "İleri bir zaman seçin.",
"alreadyPublished": "Bu görev zaten gönderildi, yeniden zamanlanamaz.",
"groupArchived": "Bu grup arşivlendi, artık görev gönderilemez."
```

In `src/utils/notificationRoutes.ts`, add a case to the **advisor** switch.
The file already lifts `const closureGroupId = str(data?.groupId);` at the top
of `routeForNotification`, so reuse it rather than re-reading `data`:

```ts
        case 'schedule_failed':
          return closureGroupId
            ? { pathname: '/(advisor)/group-assignments', params: { groupId: closureGroupId } }
            : { pathname: '/(advisor)/groups' };
```

`closureGroupId` is named for its first use, not its only one; if that reads
badly once a second case shares it, rename it to `groupId` in the same commit
and update the two closure cases that use it.

In `src/utils/notificationContent.ts`, add the Turkish rendering beside the
other types. The English the server writes is
`'Scheduled task not sent'` / `'A task scheduled for <group> could not be sent: <reason>'`;
match it with the same anchored-regex style the file already uses.

- [ ] **Step 8: Gates and commit**

```bash
npx jest --silent && npx tsc --noEmit && npx eslint .
```

```bash
git add src/utils/assignmentSchedule.ts src/utils/__tests__/assignmentSchedule.test.ts \
        src/types/assignment.ts src/types/notification.ts src/services/assignments.ts \
        src/utils/rpcErrors.ts src/utils/notificationRoutes.ts \
        src/utils/notificationContent.ts src/i18n/locales/en.json src/i18n/locales/tr.json \
        src/types/database.ts
git commit -m "feat(assignments): scheduling in the types and service

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The advisor schedules instead of sending

**Files:**
- Modify: `src/components/advisor/AssignmentReview.tsx`,
  `app/(advisor)/group-assignments.tsx:286-348`,
  `src/i18n/locales/*.json` (all seven for `taskFlow`)

**Interfaces consumed:** `scheduleAssignments`, `sendBeforeDue`,
`errors.scheduleInPast`.

- [ ] **Step 1: Add the send-time choice to the review screen**

`AssignmentReview.tsx` already renders the audience choice at `:138-160` as two
`TouchableOpacity` chips styled `[groupStyles.outline, on && groupStyles.selected]`.
Add a second row beneath it in the same shape:

```tsx
    <Text style={ui.label}>{t('taskFlow.sendWhen', 'When to send')}</Text>
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {(['now', 'later'] as const).map((value) => {
        const on = value === 'now' ? !sendAt : !!sendAt;
        return (
          <TouchableOpacity key={value} accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[groupStyles.outline, on && groupStyles.selected]}
            disabled={busy || (attempted && !failed)}
            onPress={() => value === 'now' ? setSendAt(null) : setShowSendPicker(true)}>
            <Text style={groupStyles.linkText}>
              {value === 'now'
                ? t('taskFlow.sendNow', 'Send now')
                : sendAt
                  ? t('taskFlow.sendAtValue', 'On {{when}}', {
                      when: new Date(sendAt).toLocaleString(i18n.language),
                    })
                  : t('taskFlow.sendLater', 'Schedule')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
```

`i18n` is already destructured from `useTranslation()` at the top of this
component for the due-date formatting, so the `toLocaleString` call above needs
no new import.

State beside the existing `targetIds` / `picking`:

```tsx
  // null means "send now", which is what the screen did before this existed.
  const [sendAt, setSendAt] = useState<string | null>(null);
  const [showSendPicker, setShowSendPicker] = useState(false);
```

Use `DateTimePicker` — the file already imports it for the due date at `:140-156`
— but in two steps, `mode="date"` then `mode="time"`, because Android's picker
does not do both at once. Build the result from the advisor's local date and
time and store `toISOString()`.

Reject a send after the due date with `sendBeforeDue(candidate, batchDate)`: show
`t('taskFlow.sendAfterDue')` inline and do not accept the value. **The two date
fields must not read alike** — the due date is an outline button saying
"Son teslim tarihi: …", so give the send-time row the label above it and keep
them visually apart, as in the snippet.

Pass the choice out through the existing `finish(true)` path so `onPublish`
receives it: change the prop to
`onPublish: (rows: GroupAssignment[], targetIds: string[] | null, sendAt: string | null) => Promise<boolean>`.

- [ ] **Step 2: Branch the publish handler**

In `app/(advisor)/group-assignments.tsx`, `handleSendToStudents` gains the third
argument. After the targets loop and **instead of** `publishAssignments` when a
time was chosen:

```tsx
      if (sendAt) {
        const scheduled = await assignmentService.scheduleAssignments(
          batch.map((d) => d.id), sendAt,
        );
        showToast(t('advisor.assignmentsScheduled', { count: scheduled }));
        await loadData();
        setSelectedDraftIds([]);
        setReviewingDrafts(false);
        return true;
      }
      const count = await assignmentService.publishAssignments(batch.map((d) => d.id));
```

The existing `catch` already maps `NOT_IN_SCOPE` and `TARGETS_REQUIRED` with
their titles; `SCHEDULE_IN_PAST` and `ALREADY_PUBLISHED` fall through to the
generic branch, which is correct — they carry no title.

- [ ] **Step 3: Delete the client's notification loop**

Still in `handleSendToStudents`, remove the whole `recipients` computation and
the `notificationService.create` loop (`:320-348`), leaving the
`showToast(t('advisor.assignmentsSent', { count }))` and the `count > 0` guard.
`publish_assignments_internal` writes those notifications now, for both paths,
from the rows it actually moved.

Remove the now-unused `notificationService` import if nothing else in the file
uses it — `tsc` will tell you, since `noUnusedLocals` is on.

Leave the comment explaining why `count > 0` matters; it still does, for the
toast.

- [ ] **Step 4: Add the keys**

`taskFlow` in **all seven** locales: `sendWhen`, `sendNow`, `sendLater`,
`sendAtValue`, `sendAfterDue`. `advisor.assignmentsScheduled` in en + tr.

- [ ] **Step 5: Gates and commit**

```bash
npx jest --silent && npx tsc --noEmit && npx eslint .
```

```bash
git add src/components/advisor/AssignmentReview.tsx "app/(advisor)/group-assignments.tsx" src/i18n/locales
git commit -m "feat(advisor): choose when a task goes out

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The drafts tray shows and manages a schedule

**Files:**
- Modify: `src/components/cards/AssignmentCard.tsx` (the `isDraft` branch
  around `:342-347`), `app/(advisor)/group-assignments.tsx`,
  `src/i18n/locales/*.json`

**Interfaces consumed:** `scheduleState`, `assignmentService.scheduleAssignments`,
`assignmentService.publishAssignments`.

- [ ] **Step 1: Show the state on a draft card**

In the `isDraft` branch, derive the state once and render one line from it:

```tsx
  const state = scheduleState(assignment);
  const when = assignment.scheduledFor
    ? new Date(assignment.scheduledFor).toLocaleString(i18n.language)
    : '';
```

```tsx
      {state === 'scheduled' && (
        <Text style={styles.subtle}>{t('taskFlow.scheduledFor', 'Goes out {{when}}', { when })}</Text>
      )}
      {state === 'overdue' && (
        <Text style={styles.warning}>
          {t('taskFlow.scheduleOverdue', 'Should have gone out {{when}}', { when })}
        </Text>
      )}
      {state === 'failed' && (
        <Text style={styles.error}>
          {t('taskFlow.scheduleFailed', 'Could not be sent: {{reason}}', {
            // A stable code becomes a sentence; a raw server message is never
            // shown, the same rule every other refusal in this app follows.
            reason: t(mapRpcError(assignment.scheduleError ?? '').key),
          })}
        </Text>
      )}
```

Use the card's existing tone styles if it has them; if there is no `warning` or
`error` text style on this card, add them from the theme tokens the rest of the
app uses for the same purpose (the withdraw link is already the card's red) —
do not introduce new colours.

- [ ] **Step 2: Add the actions**

On a `scheduled`, `overdue` or `failed` card:

- **Cancel schedule** — `scheduleAssignments([id], null)` then `onChanged()`.
- **Send now** — `publishAssignments([id])` then `onChanged()`.
- **Change the time** — reopen the same date+time picker and call
  `scheduleAssignments([id], iso)`.

Guard all three with one in-flight flag, the way the card's other actions use
`withdrawing` / `attaching` / `retargeting`, and give the disabled links
`accessibilityState={{ disabled: … }}` plus the existing `styles.linkDisabled`.

No confirmation on any of them: cancelling a schedule takes nothing away from a
student, because a scheduled task was never visible.

Every failure goes through `mapRpcError` into an `Alert`.

- [ ] **Step 3: Add the keys**

`taskFlow.scheduledFor`, `taskFlow.scheduleOverdue`, `taskFlow.scheduleFailed`,
`taskFlow.cancelSchedule`, `taskFlow.sendNowAction`, `taskFlow.changeSendTime` —
all seven locales, real translations.

- [ ] **Step 4: Gates and commit**

```bash
npx jest --silent && npx tsc --noEmit && npx eslint .
```

```bash
git add src/components/cards/AssignmentCard.tsx "app/(advisor)/group-assignments.tsx" src/i18n/locales
git commit -m "feat(advisor): manage a scheduled send from the drafts tray

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Device walk** — the controller runs this with the owner, not a
subagent. Schedule a task two minutes out for two students; watch it arrive;
confirm one notification per student and no stream card for a targeted one;
then schedule another, drop its competency from the group's scope, and confirm
the advisor is told it failed.

---

### Task 6: Documentation

**Files:** `CLAUDE.md`, `docs/superpowers/specs/2026-08-20-task-assignment-design.md`,
`docs/superpowers/specs/2026-09-26-assignment-targeting-design.md`, `PROGRESS.md`

- [ ] **Step 1: `CLAUDE.md`, Domain Model item 3**

After the publishing sentence, add:

```
Sending can be scheduled: `scheduled_for` set with `published_at` still NULL is
a third state that every existing rule still treats as a draft, and a pg_cron
job (`publish_due_assignments`, every minute) publishes it at the hour.
`publish_assignments` is a thin wrapper over `publish_assignments_internal`,
which both the tap and the timer call and which writes the "task assigned"
notifications — the client no longer does.
```

Add `pg_cron` to the Backend line as a dependency the project now has.

- [ ] **Step 2: Pointers on the two amended specs**

At the top of each, in the same style as their existing pointers:

```markdown
> **Amended on 2026-10-10** by `2026-10-10-assignment-scheduling-design.md`:
> publishing can also be triggered by a timer, and the notifications it writes
> moved from the client into the database.
```

- [ ] **Step 3: `PROGRESS.md`**

Add the session row: what the owners asked for, the separate-column decision and
its failure-direction reasoning, the publish split, the notification move and
what it did to the language, the failure path, the live verification results and
the device walk. Read the two most recent rows first and match their density.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-20-task-assignment-design.md \
        docs/superpowers/specs/2026-09-26-assignment-targeting-design.md PROGRESS.md
git commit -m "docs: a task's send can be scheduled

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
