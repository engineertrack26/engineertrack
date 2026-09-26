# Assignment targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An advisor can send a task to the whole group, as today, or to one or
several students they pick — so a student who is ready for the next competency
level gets the task that matches it.

**Architecture:** `group_assignments` gains an explicit `audience` column
(`group` / `selected`) and a companion `assignment_targets` join table with no
write policy; one `SECURITY DEFINER` RPC, `set_assignment_targets`, owns both at
once so they can never disagree. Two `SECURITY DEFINER` predicates
(`can_see_assignment`, `mentor_sees_assignment`) carry the visibility rule into
the `group_assignments` read policy, into `submit_assignment`, and nowhere else.
The advisor chooses the audience once per batch on the review screen and can
re-target a published task from its own card.

**Tech Stack:** PostgreSQL / Supabase (RLS + `SECURITY DEFINER` RPCs, SQL applied
by hand in the SQL editor), Expo Router, React Native, TypeScript, Zustand,
i18next, Jest.

**Spec:** `docs/superpowers/specs/2026-09-26-assignment-targeting-design.md`

## Global Constraints

- **SQL files are idempotent** and use **anonymous `$$` only** — a named dollar
  tag fails in the Supabase SQL editor.
- **One SQL file per message** to the owner, who applies it by hand. Every
  verification part must **end in a `SELECT` that returns a result set**: the
  editor hides `NOTICE` and shows only the last statement's result.
- **Single-home rule:** a function body lives in exactly one file. When a
  function moves, the old file gets a `NOTE` saying that re-running it reverts
  the change.
- **`CREATE OR REPLACE FUNCTION` cannot change a return type.** A function whose
  `RETURNS TABLE` gains a column must be `DROP FUNCTION`ed first.
- **Every RPC refusal is a stable code** (`NOT_TARGETED`, `TARGETS_REQUIRED`,
  `HAS_SUBMISSION`, `STUDENT_NOT_IN_GROUP`, `NOT_GROUP_OWNER`) mapped by
  `mapRpcError` → `errors.*`. Never show a raw `err.message`.
- **Never a bare `catch {}`.** A failed load shows `LoadFailedBanner`.
- **New i18n keys go to `en.json` and `tr.json`**, with `t(key, 'Default text')`
  at the call site. The parity-tested sections are `advisorHome`, `mentorHome`,
  `mentorFlow`, `mentorStudents`, `taskFlow`, `authUi`, `recoveryUi` — a key
  added to one of those **must** be added to all seven locales (en, tr, de, it,
  ro, sr, el) or `src/i18n/__tests__/locales.test.ts` fails.
- **A function-form `style` prop on `Pressable` renders nothing on this
  runtime.** Use static arrays, or `TouchableOpacity`.
- **Path aliases (`@/…`)**, never a relative import out of `src/`.
- **Commits stage explicit paths only** (`git add <paths>`), never `git add -A`
  or `.`; never `git stash`, `git checkout --`, `git reset`. The working tree is
  shared with a parallel Codex session — `sim/log/security-probe.md` is theirs
  and must not be touched.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Never re-run anything under `sim/phases/`.**
- Gates after every task: `npx tsc --noEmit` silent, `npx jest --silent` green,
  `npx eslint .` clean.

## Review Focus

Five things the spec implies but no task's own happy-path test would reach.
Each one has its test written into the task that owns the code.

1. **A targeted student leaves the group.** `left_at` is set; the task must stop
   being visible to them, but their submission must survive for the report.
   (Task 2, Part B.)
2. **The same student id appears twice in `p_student_ids`.** The composite
   primary key would raise; asking twice means the same as asking once, so the
   call must succeed and count the student once. (Task 1, Part B via Task 2.)
3. **Widening back to the whole group when a target has already submitted.**
   `HAS_SUBMISSION` exists to stop a submission being orphaned; widening orphans
   nobody, so it must be **allowed** — refusing it would trap the advisor.
   (Task 2, Part B.)
4. **A published task that changes audience and the stream card.** Narrowing
   must take the card down (it names the task to everyone, which is what
   targeting avoids); widening must create the card that was never posted.
   (Task 2, Part B.)
5. **The advisor sends a batch spanning two competencies.** There is no single
   level to show, so the picker must omit the badges instead of showing a level
   from the wrong competency. (Task 3, Jest.)

---

## File Structure

**SQL (new):**
- `docs/assignment-targeting.sql` — the whole server change in one applicable
  file: the column, the table and its policy, the two predicates, the read
  policy, the target-audience trigger, `set_assignment_targets`, and the new
  home of `publish_assignments`, `group_assignment_counts` and the feed trigger.
- `docs/assignment-targeting-verification.sql` — Parts A / B / C.

**SQL (modified):**
- `docs/review-by-advisor.sql` — `submit_assignment` gains the `NOT_TARGETED`
  guard (this file is its home; the owner re-applies it).
- `docs/assignment-drafts-rpcs.sql`, `docs/task-assignment-rpcs.sql`,
  `docs/group-feed-assignment-cards.sql` — `NOTE` headers only.

**Client (new):**
- `src/utils/assignmentTargets.ts` — pure helpers (dedupe/validate, the
  "2 / 3" string, the level sort).
- `src/utils/__tests__/assignmentTargets.test.ts`
- `src/components/advisor/TargetPicker.tsx` — the multi-select sheet, modelled
  on `src/components/messages/ContactPicker.tsx`.

**Client (modified):**
- `src/types/assignment.ts`, `src/services/assignments.ts`,
  `src/utils/rpcErrors.ts`
- `src/components/advisor/AssignmentReview.tsx` — the audience choice
- `app/(advisor)/group-assignments.tsx` — notification recipients, re-target
- `src/components/cards/AssignmentCard.tsx` — the audience row and denominators
- `src/i18n/locales/en.json`, `tr.json` (+ five more for `taskFlow.*`)

**Docs:** `CLAUDE.md`, the 2026-08-20 spec's pointer, `PROGRESS.md`.

---

### Task 1: The server — schema, access and the write path

**Files:**
- Create: `docs/assignment-targeting.sql`
- Modify: `docs/assignment-drafts-rpcs.sql` (header NOTE),
  `docs/task-assignment-rpcs.sql` (header NOTE),
  `docs/group-feed-assignment-cards.sql` (header NOTE),
  `docs/review-by-advisor.sql:86-89` (the `NOT_TARGETED` guard)

**Interfaces:**
- Consumes: existing helpers `owns_group(UUID)`, `is_member_of_group(UUID)`,
  `mentors_a_member_of_group(UUID)`, `is_mentor_of(UUID)`,
  `feed_publish_assignment(UUID)`.
- Produces, for Tasks 2–5:
  - `set_assignment_targets(p_assignment_id UUID, p_student_ids UUID[]) RETURNS INT`
  - `can_see_assignment(p_assignment_id UUID) RETURNS BOOLEAN`
  - `mentor_sees_assignment(p_assignment_id UUID) RETURNS BOOLEAN`
  - `group_levels_for_competency(p_group_id UUID, p_competency_id UUID) RETURNS TABLE (student_id UUID, current_level INT)`
  - `group_assignment_counts(p_group_id UUID) RETURNS TABLE (assignment_id UUID, submitted INT, approved INT, needs_revision INT, target_count INT)`
  - `group_assignments.audience TEXT` (`'group' | 'selected'`)
  - table `assignment_targets(assignment_id, student_id, created_at)`
  - refusal codes `NOT_TARGETED`, `TARGETS_REQUIRED`, `HAS_SUBMISSION`,
    `STUDENT_NOT_IN_GROUP`, `NOT_GROUP_OWNER`, `AUDIENCE_NOT_SELECTED`

This task writes SQL only. Nothing here is applied to the database by an agent —
the owner applies it. The task's deliverable is the file plus the notes.

- [ ] **Step 1: Create `docs/assignment-targeting.sql` with the header and the schema**

```sql
-- docs/assignment-targeting.sql
-- A task can go to selected students, not only the whole group.
-- Spec: docs/superpowers/specs/2026-09-26-assignment-targeting-design.md
--
-- Apply AFTER docs/task-assignment-migration.sql,
-- docs/assignment-drafts-migration.sql, docs/assignment-drafts-rpcs.sql,
-- docs/group-feed-assignment-cards.sql and docs/review-by-advisor.sql.
-- Idempotent, anonymous $$ only.
--
-- THIS FILE IS NOW THE HOME OF publish_assignments (was
-- docs/assignment-drafts-rpcs.sql), group_assignment_counts (was
-- docs/task-assignment-rpcs.sql) and the trg_feed_assignment_post trigger
-- (was docs/group-feed-assignment-cards.sql). Re-running any of those three
-- files reverts this feature; each carries a NOTE saying so.
-- ============================================

-- ---- 1. The audience column ----
-- The default is what every existing row already means: published so far ==
-- published to the whole group. No migration of meaning is needed.
ALTER TABLE group_assignments
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'group';

ALTER TABLE group_assignments DROP CONSTRAINT IF EXISTS group_assignments_audience_check;
ALTER TABLE group_assignments ADD CONSTRAINT group_assignments_audience_check
  CHECK (audience IN ('group', 'selected'));

-- ---- 2. The targets ----
CREATE TABLE IF NOT EXISTS assignment_targets (
  assignment_id UUID NOT NULL REFERENCES group_assignments(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS assignment_targets_student_idx
  ON assignment_targets(student_id);

ALTER TABLE assignment_targets ENABLE ROW LEVEL SECURITY;

-- NO WRITE POLICY, deliberately -- the same rule assignment_submissions and
-- kpi_observations follow. set_assignment_targets is the only writer.
-- A read policy IS needed: the advisor's re-target sheet lists the current
-- targets. It is owner-only; every other role's visibility is decided by the
-- two SECURITY DEFINER predicates below, which bypass this policy.
DROP POLICY IF EXISTS "advisor reads targets" ON assignment_targets;
CREATE POLICY "advisor reads targets" ON assignment_targets
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM group_assignments a
            WHERE a.id = assignment_targets.assignment_id AND owns_group(a.group_id))
  );
```

- [ ] **Step 2: Append the two visibility predicates and the read policy**

```sql
-- ---- 3. Who may see an assignment ----
-- SECURITY DEFINER for the same reason owns_group is: a policy must be able to
-- call it without re-entering the policies of the tables it reads.
-- Both predicates require published_at, which is what keeps drafts invisible --
-- the condition the read policy used to carry inline.
CREATE OR REPLACE FUNCTION can_see_assignment(p_assignment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_assignments a
    JOIN group_memberships m ON m.group_id = a.group_id
                            AND m.student_id = auth.uid()
                            AND m.left_at IS NULL
    WHERE a.id = p_assignment_id
      AND a.published_at IS NOT NULL
      AND (a.audience = 'group'
           OR EXISTS (SELECT 1 FROM assignment_targets tg
                      WHERE tg.assignment_id = a.id AND tg.student_id = auth.uid()))
  );
$$;

GRANT EXECUTE ON FUNCTION can_see_assignment(UUID) TO authenticated;

-- The mentor sees what THEIR student was given -- not every task in the group,
-- which after targeting would mean showing them tasks their student never had.
CREATE OR REPLACE FUNCTION mentor_sees_assignment(p_assignment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_assignments a
    WHERE a.id = p_assignment_id
      AND a.published_at IS NOT NULL
      AND mentors_a_member_of_group(a.group_id)
      AND (a.audience = 'group'
           OR EXISTS (
             SELECT 1
             FROM assignment_targets tg
             JOIN group_memberships m ON m.student_id = tg.student_id
                                     AND m.group_id = a.group_id
                                     AND m.left_at IS NULL
             WHERE tg.assignment_id = a.id AND is_mentor_of(tg.student_id)))
  );
$$;

GRANT EXECUTE ON FUNCTION mentor_sees_assignment(UUID) TO authenticated;

-- ---- 4. The read policy ----
-- Replaces the version in docs/assignment-drafts-migration.sql. The advisor's
-- branch is unchanged; the other two moved into the predicates above, which
-- keep the published_at condition.
DROP POLICY IF EXISTS "assignments read" ON group_assignments;
CREATE POLICY "assignments read" ON group_assignments
  FOR SELECT TO authenticated USING (
    owns_group(group_id)
    OR can_see_assignment(id)
    OR mentor_sees_assignment(id)
  );
```

- [ ] **Step 3: Append the audience/target consistency trigger**

```sql
-- ---- 5. A target row only exists on a 'selected' assignment ----
-- The backstop for anything that ever writes the table outside
-- set_assignment_targets. It is why that function sets the audience BEFORE it
-- inserts rows.
CREATE OR REPLACE FUNCTION trg_target_requires_selected_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_assignments a
    WHERE a.id = NEW.assignment_id AND a.audience = 'selected'
  ) THEN
    RAISE EXCEPTION 'AUDIENCE_NOT_SELECTED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_target_requires_selected ON assignment_targets;
CREATE TRIGGER trg_target_requires_selected
  BEFORE INSERT OR UPDATE ON assignment_targets
  FOR EACH ROW EXECUTE FUNCTION trg_target_requires_selected_fn();
```

- [ ] **Step 4: Append `set_assignment_targets`**

```sql
-- ---- 6. The one writer ----
-- Sets the audience and the rows together, which is what keeps them
-- consistent. Works the same on a draft and on a published assignment, so the
-- review screen and a published card both go through it.
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
  IF array_length(v_ids, 1) IS NOT NULL AND EXISTS (
    SELECT 1
    FROM assignment_targets tg
    JOIN assignment_submissions s ON s.assignment_id = tg.assignment_id
                                 AND s.student_id = tg.student_id
    WHERE tg.assignment_id = p_assignment_id
      AND NOT (tg.student_id = ANY(v_ids))
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
```

- [ ] **Step 5: Append `publish_assignments` (new home) with the `TARGETS_REQUIRED` guard**

Copy the body from `docs/assignment-drafts-rpcs.sql:21-69` **verbatim** and add
only the block marked below. Do not retype it from memory — diff your copy
against the original before moving on.

```sql
-- ---- 7. publish_assignments: NEW HOME ----
-- Body copied verbatim from docs/assignment-drafts-rpcs.sql, plus the
-- TARGETS_REQUIRED re-check. That file now carries a NOTE: re-running it drops
-- this guard.
CREATE OR REPLACE FUNCTION publish_assignments(p_ids UUID[])
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

  -- NEW: an assignment whose audience is 'selected' and which names nobody
  -- would reach no one at all. Same all-or-nothing shape as NOT_IN_SCOPE, and
  -- it names the task for the same reason.
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

  UPDATE group_assignments
  SET published_at = now()
  WHERE id = ANY(p_ids) AND published_at IS NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION publish_assignments(UUID[]) TO authenticated;
```

- [ ] **Step 6: Append `group_assignment_counts` (new home) with `target_count`**

```sql
-- ---- 8. group_assignment_counts: NEW HOME, one column wider ----
-- "2 submitted" means nothing without its denominator once a task can go to
-- three students out of seven. target_count is the group's active member count
-- for a group audience and the number of target rows for a selected one.
--
-- DROP first: CREATE OR REPLACE cannot change a RETURNS TABLE.
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
```

- [ ] **Step 7: Append `group_levels_for_competency`**

```sql
-- ---- 9. The picker's level badges ----
-- The purpose of targeting is level-based individualisation, so the picker has
-- to answer "who is ready". get_competency_progress answers per student; seven
-- round-trips would make the sheet crawl. The ladder logic is the same as that
-- function's, deliberately: a level counts only when both its KPIs have two
-- observations from someone other than the student, and a gap below stops the
-- ladder there.
CREATE OR REPLACE FUNCTION group_levels_for_competency(p_group_id UUID, p_competency_id UUID)
RETURNS TABLE (student_id UUID, current_level INT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH members AS (
    SELECT m.student_id AS sid
    FROM group_memberships m
    WHERE m.group_id = p_group_id
      AND m.left_at IS NULL
      AND owns_group(p_group_id)
  ),
  demonstrated AS (
    SELECT mm.sid, k.id AS kid, k.level AS lvl
    FROM members mm
    JOIN competency_kpis k ON k.competency_id = p_competency_id
    WHERE (
      SELECT count(*) FROM kpi_observations o
      WHERE o.kpi_id = k.id AND o.student_id = mm.sid AND o.observed_by <> mm.sid
    ) >= 2
  ),
  levels_done AS (
    SELECT d.sid, d.lvl
    FROM demonstrated d
    GROUP BY d.sid, d.lvl
    HAVING count(*) = 2
  )
  SELECT mm.sid,
    COALESCE((
      SELECT max(candidate.lvl)
      FROM generate_series(1, 4) AS candidate(lvl)
      WHERE NOT EXISTS (
        SELECT 1 FROM generate_series(1, candidate.lvl) AS needed(lvl)
        WHERE NOT EXISTS (
          SELECT 1 FROM levels_done ld WHERE ld.sid = mm.sid AND ld.lvl = needed.lvl
        )
      )
    ), 0)::INT
  FROM members mm;
$$;

GRANT EXECUTE ON FUNCTION group_levels_for_competency(UUID, UUID) TO authenticated;
```

- [ ] **Step 8: Append the feed trigger, re-created with the audience condition**

```sql
-- ---- 10. No stream card for a targeted task: NEW HOME of the trigger ----
-- The card tells a group what it is all working on. A task given to two
-- students is not that, and posting it would announce to everyone exactly what
-- targeting exists to avoid. The condition is in the WHEN clause, so
-- trg_feed_assignment_post_fn and feed_publish_assignment are untouched.
-- docs/group-feed-assignment-cards.sql carries a NOTE: re-running it drops this
-- condition and every targeted publish starts posting a card again.
DROP TRIGGER IF EXISTS trg_feed_assignment_post ON group_assignments;
CREATE TRIGGER trg_feed_assignment_post
  AFTER UPDATE OF published_at ON group_assignments
  FOR EACH ROW
  WHEN (NEW.published_at IS NOT NULL
        AND OLD.published_at IS NULL
        AND NEW.audience = 'group')
  EXECUTE FUNCTION trg_feed_assignment_post_fn();
```

- [ ] **Step 9: Add the `NOT_TARGETED` guard to `submit_assignment`**

In `docs/review-by-advisor.sql`, the membership guard reads:

```sql
  -- Only an active member of the assignment's group may submit to it.
  IF NOT is_member_of_group(target_group) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;
```

Replace it with:

```sql
  -- Only an active member of the assignment's group may submit to it.
  IF NOT is_member_of_group(target_group) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  -- ... and only if the task was actually given to them. A separate code from
  -- ROLE_NOT_ALLOWED so the message can say the task is not yours rather than
  -- that you lack a role -- a member of the group has the role.
  -- can_see_assignment also covers "not published yet".
  IF NOT can_see_assignment(p_assignment_id) THEN
    RAISE EXCEPTION 'NOT_TARGETED';
  END IF;
```

Verify the variable really is named `target_group` and the parameter
`p_assignment_id` before editing — read the function's `DECLARE` block first.
Add to that file's header:

```sql
-- 2026-09-26: submit_assignment also refuses NOT_TARGETED when the task was
-- given to selected students and the caller is not one of them. The predicate
-- can_see_assignment comes from docs/assignment-targeting.sql, which must be
-- applied before this file.
```

- [ ] **Step 10: Add the NOTE headers to the three old homes**

At the top of `docs/assignment-drafts-rpcs.sql`, after line 2:

```sql
-- NOTE (2026-09-26): publish_assignments NO LONGER LIVES HERE.
-- docs/assignment-targeting.sql holds the copy that stands -- this one has no
-- idea group_assignments.audience exists, so re-running this file alone lets a
-- 'selected' assignment with no targets be published to nobody, silently.
-- If you re-apply this file, re-apply docs/assignment-targeting.sql after it.
```

At the top of `docs/task-assignment-rpcs.sql` (add to the notes already there):

```sql
-- NOTE (2026-09-26): group_assignment_counts NO LONGER LIVES HERE.
-- docs/assignment-targeting.sql holds the copy that stands; this one returns
-- four columns instead of five, so re-running it makes the advisor's cards
-- lose their denominator and getAssignmentCounts read target_count as 0.
```

At the top of `docs/group-feed-assignment-cards.sql`:

```sql
-- NOTE (2026-09-26): the trg_feed_assignment_post TRIGGER no longer lives here
-- (the function trg_feed_assignment_post_fn still does). The copy that stands
-- is in docs/assignment-targeting.sql and carries "AND NEW.audience = 'group'".
-- Re-running this file drops that condition and every targeted publish posts a
-- stream card announcing the task to the whole group again.
```

- [ ] **Step 11: Check the file parses and commit**

The SQL is not applied by an agent. Check it mechanically instead:

```bash
grep -c '\$\$' docs/assignment-targeting.sql          # must be even
grep -n 'AS \$[a-z]' docs/assignment-targeting.sql    # must print nothing (no named tags)
npx tsc --noEmit
```

```bash
git add docs/assignment-targeting.sql docs/review-by-advisor.sql \
        docs/assignment-drafts-rpcs.sql docs/task-assignment-rpcs.sql \
        docs/group-feed-assignment-cards.sql
git commit -m "feat(sql): a task can be sent to selected students

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The verification script

**Files:**
- Create: `docs/assignment-targeting-verification.sql`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: nothing the client uses. Its output is the owner's PASS/FAIL table.

Three parts in one file, separated by a banner comment, each part run on its own
by the owner. Every part ends in a `SELECT` returning rows. Parts B and C
accumulate into a `probe.results` setting and unpack it at the end — the editor
hides `NOTICE` and shows only the last statement's result.

- [ ] **Step 1: Write Part A (structural), one query**

```sql
-- ============================================
-- PART A -- structural. Run this block alone. Expect 12 rows, all PASS.
-- ============================================
WITH checks AS (
  SELECT 'audience column' AS check_name,
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'group_assignments' AND column_name = 'audience'
                   AND is_nullable = 'NO' AND column_default LIKE '%group%') AS ok
  UNION ALL SELECT 'audience CHECK',
         EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'group_assignments_audience_check')
  UNION ALL SELECT 'assignment_targets exists',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_name = 'assignment_targets')
  UNION ALL SELECT 'composite primary key',
         (SELECT count(*) FROM information_schema.key_column_usage
          WHERE table_name = 'assignment_targets'
            AND constraint_name LIKE '%pkey%') = 2
  UNION ALL SELECT 'targets RLS on',
         (SELECT relrowsecurity FROM pg_class WHERE relname = 'assignment_targets')
  UNION ALL SELECT 'targets: read policy only',
         (SELECT count(*) FROM pg_policies WHERE tablename = 'assignment_targets') = 1
     AND (SELECT count(*) FROM pg_policies
          WHERE tablename = 'assignment_targets' AND cmd = 'SELECT') = 1
  UNION ALL SELECT 'can_see_assignment definer + search_path',
         EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.proname = 'can_see_assignment' AND p.prosecdef
                   AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%')
  UNION ALL SELECT 'mentor_sees_assignment definer + search_path',
         EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.proname = 'mentor_sees_assignment' AND p.prosecdef
                   AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%')
  UNION ALL SELECT 'trg_target_requires_selected',
         EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgname = 'trg_target_requires_selected' AND NOT tgisinternal)
  UNION ALL SELECT 'feed trigger carries the audience condition',
         (SELECT pg_get_triggerdef(oid) FROM pg_trigger
          WHERE tgname = 'trg_feed_assignment_post' AND NOT tgisinternal)
         LIKE '%audience%'
  UNION ALL SELECT 'counts return target_count',
         EXISTS (SELECT 1 FROM information_schema.routines r
                 JOIN information_schema.parameters pa ON pa.specific_name = r.specific_name
                 WHERE r.routine_name = 'group_assignment_counts'
                   AND pa.parameter_name = 'target_count')
  UNION ALL SELECT 'set_assignment_targets + levels granted to authenticated',
         has_function_privilege('authenticated',
           'set_assignment_targets(uuid,uuid[])', 'EXECUTE')
     AND has_function_privilege('authenticated',
           'group_levels_for_competency(uuid,uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon',
           'set_assignment_targets(uuid,uuid[])', 'EXECUTE')
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, check_name
FROM checks ORDER BY ok, check_name;
```

- [ ] **Step 2: Write Part B (behaviour) against the simulation group `58MMWL`**

The whole part runs inside `BEGIN … ROLLBACK` so nothing survives. Actors are
resolved by lookup, never hard-coded, and every check records its own PASS/FAIL
line rather than raising — one failure must not hide the eleven checks after it.

One `DO` block, one `v_log` accumulator. There is no helper procedure — nested
routines do not exist in PL/pgSQL and a second `$$` body cannot be nested inside
the first in the SQL editor. Every check appends one line:

```sql
-- ============================================
-- PART B -- behaviour. Run this whole block alone. Expect one row per check.
-- Nothing is kept: the transaction rolls back.
-- ============================================
BEGIN;

DO $$
DECLARE
  v_log    TEXT := '';
  g        UUID;
  advisor  UUID;
  s1       UUID;  -- target
  s2       UUID;  -- member, not targeted
  s3       UUID;  -- target who submits
  a_group  UUID;  -- a group-audience assignment, already published
  a_sel    UUID;  -- a draft that becomes selected-audience
  n        INT;
BEGIN
  SELECT ig.id, ig.advisor_id INTO g, advisor
  FROM internship_groups ig WHERE ig.code = '58MMWL';

  SELECT m.student_id INTO s1 FROM group_memberships m
  WHERE m.group_id = g AND m.left_at IS NULL ORDER BY m.joined_at OFFSET 0 LIMIT 1;
  SELECT m.student_id INTO s2 FROM group_memberships m
  WHERE m.group_id = g AND m.left_at IS NULL ORDER BY m.joined_at OFFSET 1 LIMIT 1;
  SELECT m.student_id INTO s3 FROM group_memberships m
  WHERE m.group_id = g AND m.left_at IS NULL ORDER BY m.joined_at OFFSET 2 LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', advisor)::text, true);

  -- Two drafts from a triplet already inside the group's competency scope --
  -- anything else would be refused by trg_assignment_within_scope on INSERT
  -- and by publish_assignments' NOT_IN_SCOPE re-check.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE group task', 'o', 'c', advisor
  FROM kpi_triplets t
  JOIN competency_kpis k ON k.id = t.kpi_id
  JOIN group_competency_targets gt ON gt.group_id = g AND gt.competency_id = k.competency_id
  LIMIT 1
  RETURNING id INTO a_group;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE selected task', 'o', 'c', advisor
  FROM kpi_triplets t
  JOIN competency_kpis k ON k.id = t.kpi_id
  JOIN group_competency_targets gt ON gt.group_id = g AND gt.competency_id = k.competency_id
  LIMIT 1
  RETURNING id INTO a_sel;

  PERFORM publish_assignments(ARRAY[a_group]);

  n := set_assignment_targets(a_sel, ARRAY[s1, s3]);
  v_log := v_log || CASE WHEN n = 2 THEN 'PASS  ' ELSE 'FAIL  ' END
                 || 'set_assignment_targets returns 2 (got ' || n || ')' || chr(10);

  -- ... every other check in the same shape ...

  PERFORM set_config('probe.results', v_log, true);
END;
$$;

SELECT line FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE line <> '';

ROLLBACK;
```

For a refusal check, use the shape already in
`docs/review-by-advisor-verification.sql`:

```sql
  BEGIN
    PERFORM submit_assignment(a_sel, NULL, NULL, '[]'::jsonb, '[]'::jsonb, 2::SMALLINT);
    v_log := v_log || 'FAIL  untargeted member is refused NOT_TARGETED (no error)' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || CASE WHEN SQLERRM LIKE '%NOT_TARGETED%' THEN 'PASS  ' ELSE 'FAIL  ' END
                   || 'untargeted member is refused NOT_TARGETED (got ' || SQLERRM || ')' || chr(10);
  END;
```

`BEGIN … EXCEPTION` opens a savepoint, so a caught error rolls back only its own
sub-block. Integer literals passed to `SMALLINT` parameters **must** be cast
(`2::SMALLINT`) — `integer → smallint` is not an implicit cast in function
resolution and the call fails with "function does not exist".

Impersonation, once per actor, is:

```sql
PERFORM set_config('request.jwt.claims', json_build_object('sub', advisor)::text, true);
```

The twelve checks, in order:

1. `set_assignment_targets(a_sel, ARRAY[s1, s3])` returns `2`, and
   `group_assignments.audience` reads `'selected'`.
2. **Duplicates:** `set_assignment_targets(a_sel, ARRAY[s1, s1, s3])` returns
   `2`, not an error. *(Review Focus 2.)*
3. As `s1`: `SELECT count(*) FROM group_assignments WHERE id = a_sel` is 1.
   As `s2`: it is 0. As `s1`: the group-audience `a_group` is also 1.
4. As `s2`: `submit_assignment(a_sel, …)` raises `NOT_TARGETED`.
   As `s3`: `submit_assignment(a_sel, …)` succeeds.
5. **A late joiner** — insert a `group_memberships` row for a fresh profile,
   then as that student `a_group` is visible although it was published before
   they arrived.
6. **A target who leaves:** set `left_at = now()` on `s1`'s membership; as `s1`,
   `a_sel` returns 0 rows, and `assignment_submissions` for `s3` is untouched.
   Restore `left_at = NULL`. *(Review Focus 1.)*
7. As the advisor: publishing a draft whose audience is `'selected'` with no
   targets raises `TARGETS_REQUIRED`.
8. `INSERT INTO assignment_targets (assignment_id, student_id) VALUES (a_group, s2)`
   raises `AUDIENCE_NOT_SELECTED`.
9. Removing `s3` (who submitted in check 4) with
   `set_assignment_targets(a_sel, ARRAY[s1])` raises `HAS_SUBMISSION`;
   removing `s1`, who has not, with `ARRAY[s3]` returns `1`.
10. **Widening with a submission present:** `set_assignment_targets(a_sel, '{}')`
    returns `0` and sets the audience to `'group'` — it is **not** refused.
    *(Review Focus 3.)*
11. `group_assignment_counts(g)`: `target_count` for `a_group` equals the active
    member count, and for a re-targeted `a_sel` equals its target count.
12. **The stream card** *(Review Focus 4)*: publishing a fresh `'selected'`
    draft creates no `feed_posts` row for it; publishing a `'group'` draft
    creates one; `set_assignment_targets(<that group one>, ARRAY[s1])` deletes
    the card; `set_assignment_targets(…, '{}')` puts it back.
13. The mentor of `s1` sees `a_sel`; a mentor whose only student is `s2` does
    not. (Resolve both from `student_profiles.mentor_id`; skip with an explicit
    `SKIP` line, not a silent pass, if the simulation has no such pair.)
14. As `s2` (a student, not the group's advisor):
    `set_assignment_targets(a_sel, ARRAY[s2])` raises `NOT_GROUP_OWNER`.

The block ends with the `set_config` / `regexp_split_to_table` / `ROLLBACK`
tail shown above.

- [ ] **Step 3: Write Part C (policies) under `SET LOCAL ROLE authenticated`**

An owner-run script proves a policy exists, not that it evaluates. Part C is the
only real RLS test.

```sql
-- ============================================
-- PART C -- policies. Run alone. Expect 4 rows, all PASS.
-- ============================================
BEGIN;
SET LOCAL ROLE authenticated;
```

…then, inside the same `DO` / `v_log` shape:

1. As a member who is **not** a target: `SELECT count(*) FROM group_assignments
   WHERE id = <a_sel>` is 0.
2. As a target: it is 1.
3. As the advisor: `INSERT INTO assignment_targets …` raises
   `42501 insufficient_privilege` (no write policy). Catch it and match on
   `SQLSTATE '42501'`, not on the message text.
4. As the advisor: `DELETE FROM assignment_targets WHERE assignment_id = <a_sel>`
   affects **0 rows** — a DELETE with no policy is not an error, it simply
   matches nothing. Assert `ROW_COUNT = 0` and that the rows are still there.

`RESET ROLE; ROLLBACK;` at the end.

- [ ] **Step 4: Check and commit**

```bash
grep -c '\$\$' docs/assignment-targeting-verification.sql   # even
grep -n 'AS \$[a-z]' docs/assignment-targeting-verification.sql  # nothing
```

```bash
git add docs/assignment-targeting-verification.sql
git commit -m "test(sql): verification for assignment targeting

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand the SQL to the owner**

Stop here and hand over, one file per message, in this order:
`docs/assignment-targeting.sql`, then `docs/review-by-advisor.sql`, then each
verification part. Prepare the clipboard with:

```powershell
Get-Content -Raw -Encoding UTF8 docs\assignment-targeting.sql | Set-Clipboard
```

Do not continue to Task 3 until the owner reports Part A, B and C results.
Regenerate the types once the schema is live:

```bash
npx supabase gen types typescript --project-id ocxpymvikzujdqefnoqg --schema public > src/types/database.ts
```

---

### Task 3: Types, pure helpers and the service layer

**Files:**
- Create: `src/utils/assignmentTargets.ts`,
  `src/utils/__tests__/assignmentTargets.test.ts`
- Modify: `src/types/assignment.ts`, `src/services/assignments.ts:302-313`
  (`getAssignmentCounts`), `src/utils/rpcErrors.ts:16-30`,
  `src/i18n/locales/en.json`, `src/i18n/locales/tr.json`

**Interfaces:**
- Consumes: `set_assignment_targets`, `group_levels_for_competency`,
  `group_assignment_counts` (five columns) from Task 1.
- Produces, for Tasks 4 and 5:
  - `type AssignmentAudience = 'group' | 'selected'`
  - `GroupAssignment.audience: AssignmentAudience`
  - `AssignmentCounts.targetCount: number`
  - `interface StudentLevel { studentId: string; currentLevel: number }`
  - `assignmentService.setAssignmentTargets(assignmentId: string, studentIds: string[]): Promise<number>`
  - `assignmentService.listAssignmentTargets(assignmentId: string): Promise<string[]>`
  - `assignmentService.listGroupLevels(groupId: string, competencyId: string): Promise<StudentLevel[]>`
  - `sortByLevel<T extends { id: string }>(students: T[], levels: StudentLevel[] | null): T[]`
  - `submittedOfTarget(counts: AssignmentCounts): string`
  - `soleCompetencyId(ids: (string | undefined)[]): string | null`

- [ ] **Step 1: Write the failing helper tests**

`src/utils/__tests__/assignmentTargets.test.ts`:

```ts
import { sortByLevel, submittedOfTarget, soleCompetencyId } from '@/utils/assignmentTargets';

const students = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Bora' },
  { id: 'c', name: 'Cem' },
];

describe('sortByLevel', () => {
  it('puts the highest level first, then falls back to the given order', () => {
    const levels = [
      { studentId: 'a', currentLevel: 1 },
      { studentId: 'b', currentLevel: 3 },
      { studentId: 'c', currentLevel: 3 },
    ];
    expect(sortByLevel(students, levels).map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('treats a student the levels do not mention as level 0', () => {
    const levels = [{ studentId: 'c', currentLevel: 2 }];
    expect(sortByLevel(students, levels).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  // The levels never loaded. The picker must still list everybody, in the
  // order it was given -- an empty list would read as "no students".
  it('returns the input unchanged when there are no levels at all', () => {
    expect(sortByLevel(students, null).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('submittedOfTarget', () => {
  it('reads "2 / 3"', () => {
    expect(submittedOfTarget({ assignmentId: 'x', submitted: 2, approved: 1,
      needsRevision: 0, targetCount: 3 })).toBe('2 / 3');
  });

  // targetCount is 0 on a row the server could not count (an assignment whose
  // group has no active members). A denominator of 0 is a lie, not a fact.
  it('omits the denominator when the target count is zero', () => {
    expect(submittedOfTarget({ assignmentId: 'x', submitted: 0, approved: 0,
      needsRevision: 0, targetCount: 0 })).toBe('0');
  });
});

describe('soleCompetencyId', () => {
  it('returns the id when every task shares one competency', () => {
    expect(soleCompetencyId(['k1', 'k1', 'k1'])).toBe('k1');
  });

  // Review Focus 5: a batch spanning two competencies has no single level to
  // show, so the picker must omit the badges rather than pick one.
  it('returns null for a batch that spans two competencies', () => {
    expect(soleCompetencyId(['k1', 'k2'])).toBeNull();
  });

  it('returns null when a task has no competency resolved', () => {
    expect(soleCompetencyId(['k1', undefined])).toBeNull();
    expect(soleCompetencyId([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/utils/__tests__/assignmentTargets.test.ts`
Expected: FAIL — "Cannot find module '@/utils/assignmentTargets'".

- [ ] **Step 3: Write `src/utils/assignmentTargets.ts`**

```ts
import type { AssignmentCounts } from '@/types/assignment';

export interface StudentLevel {
  studentId: string;
  currentLevel: number;
}

/** Highest level first: the picker exists to answer "who is ready". A stable
 *  sort, so students on the same level keep the order the caller gave them
 *  (alphabetical, from the member list). `null` levels means the read failed
 *  or the batch spans two competencies -- the list still has to render. */
export function sortByLevel<T extends { id: string }>(
  students: T[],
  levels: StudentLevel[] | null,
): T[] {
  if (!levels) return students;
  const byId = new Map(levels.map((l) => [l.studentId, l.currentLevel]));
  return students
    .map((s, index) => ({ s, index, level: byId.get(s.id) ?? 0 }))
    .sort((a, b) => b.level - a.level || a.index - b.index)
    .map((x) => x.s);
}

/** "2 / 3". The denominator is the number of people who were actually given
 *  the task, which after targeting is no longer the member count. */
export function submittedOfTarget(counts: AssignmentCounts): string {
  if (!counts.targetCount) return String(counts.submitted);
  return `${counts.submitted} / ${counts.targetCount}`;
}

/** The one competency a batch is drawn from, or null when it spans more than
 *  one (or any task's competency is unresolved). Null means the picker shows
 *  no level badges: a level from the wrong competency is worse than none. */
export function soleCompetencyId(ids: (string | undefined)[]): string | null {
  if (!ids.length || ids.some((id) => !id)) return null;
  const first = ids[0] as string;
  return ids.every((id) => id === first) ? first : null;
}
```

- [ ] **Step 4: Add the types**

In `src/types/assignment.ts`, above `GroupAssignment`:

```ts
/** Who a task was given to. 'group' is every active member, now and later --
 *  a student who joins next week sees it too. 'selected' is exactly the rows
 *  in assignment_targets. Explicit rather than "no target rows means
 *  everyone", so that losing the rows hides the task instead of broadcasting
 *  it: see the 2026-09-26 spec. */
export type AssignmentAudience = 'group' | 'selected';
```

In `GroupAssignment`, after `publishedAt`:

```ts
  /** Server default 'group'; a row read before the column existed reads as
   *  'group' too, which is what it was. */
  audience: AssignmentAudience;
```

In `AssignmentCounts`, after `needsRevision`:

```ts
  /** How many people were given this task: the group's active member count
   *  for a group audience, the number of target rows for a selected one. 0
   *  only when the group is empty -- the card then shows a bare number rather
   *  than a denominator of zero. */
  targetCount: number;
```

- [ ] **Step 5: Wire the service**

In `src/services/assignments.ts`, inside the row mapper (`toAssignment`, around
line 59) add:

```ts
    // Server default 'group'. The ?? also covers a row read by an old client
    // path before the column existed -- which meant the whole group.
    audience: (row.audience as AssignmentAudience) ?? 'group',
```

No select needs changing: every assignment query asks for `*, ${COMPETENCY_EMBED}`,
so the new column arrives on its own. Then add the three methods:

```ts
  async getAssignmentCounts(groupId: string): Promise<AssignmentCounts[]> {
    const { data, error } = await supabase.rpc('group_assignment_counts', {
      p_group_id: groupId,
    });
    if (error) throw new RpcError(error.message);
    return ((data as Record<string, unknown>[]) || []).map((r) => ({
      assignmentId: (r.assignment_id as string) || '',
      submitted: (r.submitted as number) ?? 0,
      approved: (r.approved as number) ?? 0,
      needsRevision: (r.needs_revision as number) ?? 0,
      targetCount: (r.target_count as number) ?? 0,
    }));
  },

  /** Sets the audience and the target rows in one call -- they are written
   *  together server-side so they can never disagree. An empty array is how a
   *  task goes back to the whole group. Returns the number of targets after
   *  the call. See set_assignment_targets in docs/assignment-targeting.sql. */
  async setAssignmentTargets(assignmentId: string, studentIds: string[]): Promise<number> {
    const { data, error } = await supabase.rpc('set_assignment_targets', {
      p_assignment_id: assignmentId,
      p_student_ids: studentIds,
    });
    if (error) throw new RpcError(error.message);
    return (data as number) ?? 0;
  },

  /** The current targets of one assignment. A plain select: assignment_targets
   *  has a read policy for the group's advisor, and nobody else calls this. */
  async listAssignmentTargets(assignmentId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('assignment_targets')
      .select('student_id')
      .eq('assignment_id', assignmentId);
    if (error) throw new RpcError(error.message);
    return (data || []).map((r) => r.student_id as string);
  },

  /** Every member's level in one competency, for the target picker's badges.
   *  One round-trip instead of get_competency_progress per student. */
  async listGroupLevels(groupId: string, competencyId: string): Promise<StudentLevel[]> {
    const { data, error } = await supabase.rpc('group_levels_for_competency', {
      p_group_id: groupId,
      p_competency_id: competencyId,
    });
    if (error) throw new RpcError(error.message);
    return ((data as Record<string, unknown>[]) || []).map((r) => ({
      studentId: (r.student_id as string) || '',
      currentLevel: (r.current_level as number) ?? 0,
    }));
  },
```

Import `StudentLevel` from `@/utils/assignmentTargets` and `AssignmentAudience`
from `@/types/assignment`. **Add each import as its own line after an existing
single-line import** — an insertion into the middle of a multi-line
`import { … }` block has broken this file's neighbours three times.

- [ ] **Step 6: Map the new refusal codes**

In `src/utils/rpcErrors.ts`, beside `NOT_IN_SCOPE`:

```ts
  NOT_TARGETED: 'errors.notTargeted',
  TARGETS_REQUIRED: 'errors.targetsRequired',
  HAS_SUBMISSION: 'errors.hasSubmission',
  STUDENT_NOT_IN_GROUP: 'errors.studentNotInGroup',
  NOT_GROUP_OWNER: 'errors.notGroupOwner',
```

`TARGETS_REQUIRED` carries the task's title as `detail`, the same
`CODE: <title>` shape `NOT_IN_SCOPE` uses — check the existing regex already
splits on the colon and add `errors.targetsRequiredTitled` alongside
`errors.notInScopeTitled`.

In `en.json` (`errors` section) and `tr.json`:

```json
"notTargeted": "This task was not assigned to you.",
"targetsRequired": "Choose at least one student, or send the task to the whole group.",
"targetsRequiredTitled": "\"{{title}}\" is set to selected students but nobody is chosen yet.",
"hasSubmission": "This student has already submitted this task, so they cannot be removed from it.",
"studentNotInGroup": "That student is not an active member of this group.",
"notGroupOwner": "Only the group's advisor can change who a task is for."
```

Turkish:

```json
"notTargeted": "Bu görev size verilmedi.",
"targetsRequired": "En az bir öğrenci seçin ya da görevi tüm gruba gönderin.",
"targetsRequiredTitled": "\"{{title}}\" seçili öğrencilere ayarlı ama henüz kimse seçilmedi.",
"hasSubmission": "Bu öğrenci görevi zaten teslim etti, görevden çıkarılamaz.",
"studentNotInGroup": "Bu öğrenci grubun etkin üyesi değil.",
"notGroupOwner": "Bir görevin kime verildiğini yalnızca grubun danışmanı değiştirebilir."
```

`errors` is an en + tr section, not parity-tested — the other five fall back.

- [ ] **Step 7: Run the tests and the gates**

```bash
npx jest src/utils/__tests__/assignmentTargets.test.ts   # PASS
npx jest --silent                                        # all green
npx tsc --noEmit                                         # silent
npx eslint .
```

`tsc` will name every call site that now has to supply `audience` or
`targetCount` — fix them by reading from the row, never by casting. The two
`ZERO_COUNTS`-style literals (one in `app/(advisor)/group-assignments.tsx`, plus
any in tests) each need `targetCount: 0`.

**The student's and the mentor's read paths need no change at all.**
`listMyAssignments` and `listStudentSubmissions` keep their queries; the read
policy simply stops returning a task that was not given. There is deliberately
no "assigned only to you" badge — labelling a task given for a student's level
would single them out, and the task being in their list is enough (spec, *What
the others see*). Do not add one.

- [ ] **Step 8: Commit**

```bash
git add src/utils/assignmentTargets.ts src/utils/__tests__/assignmentTargets.test.ts \
        src/types/assignment.ts src/services/assignments.ts src/utils/rpcErrors.ts \
        src/i18n/locales/en.json src/i18n/locales/tr.json src/types/database.ts
git commit -m "feat(assignments): audience and targets in the types and service

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The advisor picks the audience when sending

**Files:**
- Create: `src/components/advisor/TargetPicker.tsx`
- Modify: `src/components/advisor/AssignmentReview.tsx:16-33` (props and state),
  `:110-130` (the summary and the new control),
  `app/(advisor)/group-assignments.tsx:255-320` (`handleSendToStudents`),
  `:600-625` (the `AssignmentReview` call site),
  `src/i18n/locales/en.json`, `tr.json`, `de.json`, `it.json`, `ro.json`,
  `sr.json`, `el.json` (`taskFlow` is parity-tested)

**Interfaces:**
- Consumes: `sortByLevel`, `soleCompetencyId`, `StudentLevel`,
  `assignmentService.setAssignmentTargets`, `assignmentService.listGroupLevels`.
- Produces, for Task 5: `TargetPicker`, exported from
  `src/components/advisor/TargetPicker.tsx` with the props below.

- [ ] **Step 1: Write `src/components/advisor/TargetPicker.tsx`**

Modelled on `src/components/messages/ContactPicker.tsx` — the multi-select
pattern (checkboxes, "select all", a running count on the button) is already
built there and the advisor has used it for the message broadcast.

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LoadFailedBanner } from '@/components/common';
import { assignmentService } from '@/services/assignments';
import { sortByLevel, type StudentLevel } from '@/utils/assignmentTargets';
import { colors, fonts, spacing } from '@/theme';

export interface TargetCandidate {
  id: string;
  name: string;
}

export function TargetPicker({ visible, groupId, competencyId, students, selected, onToggle, onSubmit, onClose }: {
  visible: boolean;
  groupId: string;
  /** null when the batch spans more than one competency: no single level to
   *  show, so the badges are omitted rather than taken from the wrong one. */
  competencyId: string | null;
  students: TargetCandidate[];
  selected: string[];
  onToggle: (id: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [levels, setLevels] = useState<StudentLevel[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible || !competencyId) { setLevels(null); return; }
    let alive = true;
    setFailed(false);
    assignmentService.listGroupLevels(groupId, competencyId)
      .then((rows) => { if (alive) setLevels(rows); })
      // The badges are an aid, not the point of the screen. A failed read
      // leaves the list usable and unsorted rather than blocking the send.
      .catch((err) => { console.warn('levels failed:', err); if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [visible, groupId, competencyId]);

  const ordered = sortByLevel(students, levels);
  const allPicked = students.length > 0 && students.every((s) => selected.includes(s.id));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('taskFlow.pickStudents', 'Who gets this task?')}</Text>
          {students.length > 0 ? (
            <TouchableOpacity hitSlop={8} accessibilityRole="button"
              onPress={() => students.forEach((s) => {
                if (allPicked ? selected.includes(s.id) : !selected.includes(s.id)) onToggle(s.id);
              })}>
              <Text style={styles.action}>
                {allPicked ? t('messages.clearAll') : t('messages.selectAll')}
              </Text>
            </TouchableOpacity>
          ) : <View style={{ width: 24 }} />}
        </View>
        <Text style={styles.hint}>{t('taskFlow.pickStudentsHint',
          'Only the students you choose will see this task.')}</Text>
        {failed && <LoadFailedBanner onRetry={() => setFailed(false)} />}
        {visible && competencyId && levels === null && !failed
          ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
          : (
          <FlatList
            data={ordered}
            keyExtractor={(s) => s.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>{t('taskFlow.noMembers')}</Text>}
            renderItem={({ item }) => {
              const picked = selected.includes(item.id);
              const level = levels?.find((l) => l.studentId === item.id)?.currentLevel;
              return (
                <TouchableOpacity style={styles.row} onPress={() => onToggle(item.id)} activeOpacity={0.7}
                  accessibilityRole="checkbox" accessibilityState={{ checked: picked }}>
                  <Ionicons name={picked ? 'checkbox' : 'square-outline'} size={22}
                    color={picked ? colors.ink : colors.textSecondary} style={styles.check} />
                  <Text style={styles.name}>{item.name}</Text>
                  {level !== undefined && (
                    <Text style={styles.level}>{t('taskFlow.levelBadge', 'L{{level}}', { level })}</Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}
        <View style={styles.footer}>
          <TouchableOpacity style={[styles.send, selected.length === 0 && styles.sendOff]}
            disabled={selected.length === 0} onPress={onSubmit} activeOpacity={0.8}
            accessibilityRole="button">
            <Text style={styles.sendText}>
              {t('messages.continueWith', { count: selected.length })}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', fontFamily: fonts.semibold, color: colors.text },
  action: { fontSize: 14, fontWeight: '500', fontFamily: fonts.medium, color: colors.ink },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  check: { marginRight: spacing.md },
  name: { flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.text },
  level: { fontSize: 12, fontFamily: fonts.medium, color: colors.stamp, marginLeft: spacing.sm },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: 40 },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  send: { minHeight: 52, borderRadius: 6, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
  sendText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '600', fontFamily: fonts.semibold },
});
```

Note: **no function-form `style` prop anywhere** — static arrays only.

- [ ] **Step 2: Add the audience choice to `AssignmentReview`**

Extend the props (`AssignmentReview.tsx:16-19`):

```tsx
export function AssignmentReview({ groupId, createdBy, triplets, dueDate, memberCount, members, onClose, onDone, onPublish }: {
  groupId: string; createdBy: string; triplets: KpiTriplet[]; dueDate: string; memberCount: number;
  /** The group's active members as the picker wants them. `GroupMember` has
   *  firstName/lastName, not name, so the caller maps -- the picker should not
   *  have to know how this project spells a person. */
  members: TargetCandidate[];
  onClose: () => void; onDone: () => void;
  onPublish: (rows: GroupAssignment[], targetIds: string[]) => Promise<boolean>;
}) {
```

State, beside the existing `useState` calls:

```tsx
  // The audience is chosen once per batch, and defaults to the whole group so
  // an advisor who never opens the picker keeps today's behaviour exactly.
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
```

`competencyId` is a **prop**, not derived here: `KpiTriplet` carries `kpiId`,
not `competencyId`, and the wizard deliberately keeps picked triplets across a
change of competency, so a batch really can span two. The caller resolves it,
because only it holds the `kpis` list. Add to the props:

```tsx
  /** The one competency this batch is drawn from, or null when it spans more
   *  than one -- the picker then shows no level badges. */
  competencyId: string | null;
```

and in `app/(advisor)/group-assignments.tsx`, at the `AssignmentReview` call
site (`:605-607`):

```tsx
        competencyId={soleCompetencyId(
          Array.from(picked.values()).map((tr) => kpis.find((k) => k.id === tr.kpiId)?.competencyId),
        )}
        members={members.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim() }))}
```

Do that mapping once, in a `useMemo` beside the other derived lists, and pass
the same array to `AssignmentCard` in Task 5 — two different spellings of a
student's name on two screens of the same flow is exactly the kind of drift
this project keeps out.

The control, directly under the existing `taskFlow.summary` line (`:119`):

```tsx
    <Text style={ui.label}>{t('taskFlow.audience', 'Who gets this')}</Text>
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {(['group', 'selected'] as const).map((value) => {
        const on = value === 'group' ? targetIds.length === 0 : targetIds.length > 0;
        return (
          <TouchableOpacity key={value} accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[groupStyles.outline, on && groupStyles.outlineOn]}
            disabled={attempted || busy}
            onPress={() => value === 'group' ? setTargetIds([]) : setPicking(true)}>
            <Text style={groupStyles.linkText}>
              {value === 'group'
                ? t('taskFlow.audienceGroup', 'Whole group ({{count}})', { count: memberCount })
                : targetIds.length > 0
                  ? t('taskFlow.audienceSelectedCount', '{{count}} students', { count: targetIds.length })
                  : t('taskFlow.audienceSelected', 'Selected students')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
```

`groupStyles.outlineOn` does not exist yet — `GroupUI.tsx:72` has only
`outline`. Add it right after, rather than inventing a new style file:

```ts
  outlineOn: { borderWidth: 2, backgroundColor: colors.page },
``` Render the picker at the end, beside the date picker:

```tsx
    {picking && <TargetPicker visible groupId={groupId} competencyId={competencyId}
      students={members} selected={targetIds}
      onToggle={(id) => setTargetIds((old) =>
        old.includes(id) ? old.filter((x) => x !== id) : [...old, id])}
      onSubmit={() => setPicking(false)}
      onClose={() => setPicking(false)} />}
```

And pass the choice through the existing `finish(true)` path so `onPublish`
receives `targetIds`.

- [ ] **Step 3: Set the targets before publishing, and notify only them**

In `app/(advisor)/group-assignments.tsx`, `handleSendToStudents` becomes
`(batch, targetIds)`. Directly **before** `publishAssignments` — the targets
must exist before the publish, or `publish_assignments` refuses with
`TARGETS_REQUIRED`:

```tsx
      // The targets go in first: publish_assignments refuses a 'selected'
      // assignment that names nobody, and set_assignment_targets is what makes
      // it 'selected' in the first place. An empty array is a no-op on a draft
      // that is already group-audience, so the group path costs nothing.
      if (targetIds.length) {
        for (const draft of batch) {
          await assignmentService.setAssignmentTargets(draft.id, targetIds);
        }
      }
      const count = await assignmentService.publishAssignments(batch.map((d) => d.id));
```

Then the notification recipients, replacing `members.map(...)`:

```tsx
        // Only the people who were actually given the task. Notifying the
        // whole group about a task five of them cannot open is the same leak
        // the stream card was dropped to avoid.
        const recipients = targetIds.length
          ? members.filter((m) => targetIds.includes(m.id))
          : members;
        await Promise.all(
          recipients.map((m) =>
            notificationService.create(/* unchanged */).catch((e) => console.warn('notify failed:', e)),
          ),
        );
```

Add `TARGETS_REQUIRED` to the titled-error branch beside `NOT_IN_SCOPE`:

```tsx
      if ((code === 'NOT_IN_SCOPE' || code === 'TARGETS_REQUIRED') && detail) {
        Alert.alert(t('common.error'), t(code === 'NOT_IN_SCOPE'
          ? 'errors.notInScopeTitled' : 'errors.targetsRequiredTitled', { title: detail }));
      }
```

Pass `members={members}` at the `AssignmentReview` call site (`:605-607`). The
drafts tray at `:608-625` publishes without a review screen — it keeps whatever
audience each draft already carries, so it calls `handleSendToStudents(rows, [])`.
Add a one-line comment saying so.

- [ ] **Step 4: Add the `taskFlow` keys to all seven locales**

`taskFlow` is parity-tested. Add these to **en, tr, de, it, ro, sr, el** or
`src/i18n/__tests__/locales.test.ts` fails:

```
taskFlow.audience, taskFlow.audienceGroup, taskFlow.audienceSelected,
taskFlow.audienceSelectedCount, taskFlow.pickStudents,
taskFlow.pickStudentsHint, taskFlow.levelBadge
```

English and Turkish as in the code above. For the other five, translate rather
than copying the English — `levelBadge` stays `"L{{level}}"` everywhere.

- [ ] **Step 5: Run the gates**

```bash
npx jest --silent          # locale parity must pass
npx tsc --noEmit
npx eslint .
```

- [ ] **Step 6: Commit**

```bash
git add src/components/advisor/TargetPicker.tsx \
        src/components/advisor/AssignmentReview.tsx \
        "app/(advisor)/group-assignments.tsx" src/i18n/locales
git commit -m "feat(advisor): choose whether a task goes to the group or to selected students

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The published card shows and changes its audience

**Files:**
- Modify: `src/components/cards/AssignmentCard.tsx:29-31` (props, `members: TargetCandidate[]`),
  `:285-305` (the counts row), `:400+` (the advisor's actions),
  `app/(advisor)/group-assignments.tsx` (pass `members`),
  `src/i18n/locales/en.json`, `tr.json` (+ five for `taskFlow`)

**Interfaces:**
- Consumes: `TargetPicker` (Task 4), `submittedOfTarget`,
  `assignmentService.listAssignmentTargets`, `setAssignmentTargets`.
- Produces: nothing further.

- [ ] **Step 1: Show the audience on the card**

`AssignmentCard` already takes `counts`, `countsUnavailable` and `memberCount`.
Add `members: { id: string; name: string }[]` and render, in the counts block
around `:294`:

```tsx
          <Text style={ui.label}>
            {assignment.audience === 'selected'
              ? t('taskFlow.audienceSelectedCount', { count: counts.targetCount })
              : t('taskFlow.audienceGroup', { count: memberCount })}
          </Text>
```

and change the submitted line from a bare count to the denominator:

```tsx
              {t('advisor.submittedOfCount', '{{value}} submitted',
                 { value: submittedOfTarget(counts) })}
```

`advisor.*` is an en + tr section. Keep `advisor.approvedCount` and
`advisor.revisionCount` as they are — a denominator on those would be wrong
(not everyone is expected to be approved yet).

- [ ] **Step 2: Let the advisor re-target from the card**

`AssignmentCard` needs two pieces of state of its own, beside the ones it
already has:

```tsx
  const [picking, setPicking] = useState(false);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  // The card has no shared `busy`; each action owns its own flag
  // (`withdrawing`, `attaching`, `editSaving`). This one follows suit.
  const [retargeting, setRetargeting] = useState(false);
```

Under the existing advisor actions (around `:400`), for a published assignment
only:

```tsx
      {!isDraft && (
        <TouchableOpacity accessibilityRole="button" disabled={retargeting}
          onPress={async () => {
            try {
              setTargetIds(await assignmentService.listAssignmentTargets(assignment.id));
              setPicking(true);
            } catch (err) {
              const { key } = mapRpcError(err instanceof Error ? err.message : '');
              Alert.alert(t('common.error'), t(key));
            }
          }}>
          <Text style={ui.link}>{t('taskFlow.changeAudience', 'Change who this is for')}</Text>
        </TouchableOpacity>
      )}
```

and the picker itself, with a **"send to the whole group"** escape that the
send-time picker does not need (there, "whole group" is the other chip):

```tsx
      {picking && (
        <TargetPicker visible groupId={assignment.groupId}
          competencyId={assignment.competencyId ?? null}
          students={members} selected={targetIds}
          onToggle={(id) => setTargetIds((old) =>
            old.includes(id) ? old.filter((x) => x !== id) : [...old, id])}
          onSubmit={async () => {
            setPicking(false);
            setRetargeting(true);
            try {
              await assignmentService.setAssignmentTargets(assignment.id, targetIds);
              onChanged();
            } catch (err) {
              // HAS_SUBMISSION is the one an advisor will actually hit: they
              // tried to take the task away from someone who already did it.
              const { key } = mapRpcError(err instanceof Error ? err.message : '');
              Alert.alert(t('common.error'), t(key));
            } finally {
              setRetargeting(false);
            }
          }}
          onClose={() => setPicking(false)} />
      )}
```

Add a "back to the whole group" row inside the card, beside the change link,
shown only when `assignment.audience === 'selected'`, calling
`setAssignmentTargets(assignment.id, [])` then `onChanged()`, behind an
`Alert.alert` confirmation — it makes the task visible to everyone, which is not
undoable by simply re-picking (the stream card is posted).

- [ ] **Step 3: Add the two keys**

`taskFlow.changeAudience` and `taskFlow.audienceBackToGroup` in all seven
locales; `advisor.submittedOfCount` in en + tr.

- [ ] **Step 4: Run the gates and commit**

```bash
npx jest --silent && npx tsc --noEmit && npx eslint .
```

```bash
git add src/components/cards/AssignmentCard.tsx "app/(advisor)/group-assignments.tsx" src/i18n/locales
git commit -m "feat(advisor): a published task shows who it is for and can be re-targeted

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Device walk**

On the emulator, as the simulation advisor in group `58MMWL`:

1. Draft two tasks from one competency, open the review screen, choose
   "Selected students", pick two of the seven, send.
2. Sign in as one of the two: the task is in My Tasks. Sign in as a third: it is
   not, and the group feed shows **no** card for it.
3. Back as the advisor: the card reads "2 students" and "0 / 2".
4. Have one of the two submit. Try to remove them from the targets: the refusal
   names the submission (`HAS_SUBMISSION`).
5. Send the task back to the whole group: every student sees it, and a card
   appears in the stream.

---

### Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md` (Domain Model item 3),
  `docs/superpowers/specs/2026-08-20-task-assignment-design.md` (pointer),
  `PROGRESS.md` (the session row)

- [ ] **Step 1: `CLAUDE.md`, Domain Model item 3**

After "the advisor `review_assignment` approves → KPI observation", add:

```
A task goes to the whole group by default (`audience = 'group'`, dynamic — a
student who joins later sees it too) or to named students
(`audience = 'selected'` + `assignment_targets`, written only by
`set_assignment_targets`). A targeted task gets no stream card and notifies only
its targets.
```

And in the Backend line, add `assignment_targets` to the list of tables with no
direct write policy.

- [ ] **Step 2: Pointer on the amended spec**

At the top of `docs/superpowers/specs/2026-08-20-task-assignment-design.md`,
beside the pointer to the 2026-09-24 advisor-review spec:

```markdown
> **Amended again on 2026-09-26** by
> `2026-09-26-assignment-targeting-design.md`: an assignment no longer
> necessarily belongs to every member of its group.
```

- [ ] **Step 3: `PROGRESS.md`**

Add the session row: what the owners asked for, the two-part data model and why
the explicit column was chosen over "no rows means everyone", the live A/B/C
results, the device walk, and the commit range.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-20-task-assignment-design.md PROGRESS.md
git commit -m "docs: a task can be sent to selected students

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
