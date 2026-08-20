# Competency Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eight hardcoded competencies with the project's own six-competency framework, let each advisor scope it to their group, and assess students by ticking observed KPIs instead of scoring sliders.

**Architecture:** The framework becomes read-only reference data seeded from the source PDF (6 competencies, 48 KPIs). A group selects which competencies apply and how far they aim. Mentors and students tick the KPIs they observed on a daily log; levels are derived from the accumulation, never stored, and only observations by someone other than the student count. Task order puts the new data layer in before anything is removed, and all deletion last.

**Tech Stack:** Expo SDK 54, React Native, TypeScript, Supabase (PostgREST + plpgsql RPCs), Zustand, i18next, Jest, Python (camelot) for the one-time seed extraction.

**Spec:** `docs/superpowers/specs/2026-08-19-competency-framework-design.md`

## Global Constraints

- **Path aliases only.** `@/…`, `@components/…`, `@services/…`. Never a relative path out of `src/`.
- **New user-facing strings go through `t()` but are written to `src/i18n/locales/en.json` ONLY.** Translation is paused; `src/i18n/index.ts:30` sets `fallbackLng: 'en'`, so other-language users see the English sentence rather than a raw key. Do not touch the other six locale files.
- **`en.json` is edited by round-tripping JSON through Python `json.dumps(indent=2, ensure_ascii=False)` plus a trailing newline**, which is byte-identical to the current formatting so the diff stays a pure addition.
- **RPC error codes are stable uppercase identifiers**, mapped in `src/utils/rpcErrors.ts` and parsed nowhere else.
- **Supabase SQL editor constraints**, all found the hard way on this project: only anonymous `$$` dollar tags parse (a named tag fails with `42601`); each submission gets its own connection, so identity borrowing and the call under test must share one submission inside an explicit transaction with `is_local = true`; a temp table is not visible to later statements in the same submission.
- **Postgres records a hard dependency from a policy's qual to every column AND function it names.** Dropping either while a policy references it fails with `2BP01`. This bit subsystem A three times. Before dropping anything, ask which surviving objects read it.
- **Qualify every column reference inside a `RETURNS TABLE` function.** `RETURNS TABLE (level INT, …)` creates a PL/pgSQL variable named `level`; an unqualified `WHERE level = …` raises `42702`. This shipped in this codebase once and went unnoticed for months.
- **`CREATE OR REPLACE FUNCTION` cannot change a return type.** Any function whose result columns change must be dropped first.
- **Every task ends `npx tsc --noEmit` clean and `npx jest` green.** Baseline is 3 suites / 20 tests.
- **No task may leave the app non-compiling.** If a deletion would orphan a reference, that deletion belongs in Task 8.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/generate-competency-seed.py` | **create** — turns the extractor's `kpis.json` into the seed SQL |
| `docs/competency-framework-migration.sql` | **create** — `competencies`, `competency_kpis`, RLS, the 48-row seed |
| `docs/competency-assessment-migration.sql` | **create** — `group_competency_targets`, `kpi_observations`, RLS, the new-group default |
| `docs/competency-rpcs.sql` | **create** — `get_competency_progress`, `get_working_kpis`, `record_kpi_observations` |
| `src/types/competency.ts` | **create** — `Competency`, `CompetencyKpi`, `CompetencyProgress`, `WorkingKpi` |
| `src/services/competency.ts` | **create** — the only data layer for the framework |
| `src/components/competency/KpiChecklist.tsx` | **create** — the shared tick list, used by both log screens |
| `app/(advisor)/group-competencies.tsx` | **create** — the six toggles and level pickers |
| `app/(advisor)/groups.tsx` | **modify** — a second action on each group card |
| `app/(mentor)/review-log.tsx` | **modify** — sliders become the checklist |
| `app/(student)/create-log.tsx` | **modify** — self-assessment becomes the checklist |
| `app/(advisor)/validation.tsx` | **modify** — comparison becomes set difference |
| `app/(student)/achievements.tsx` | **modify** — competency progress display |
| `src/utils/constants.ts` | **modify** — `COMPETENCIES` and `COMPETENCY_RUBRIC` deleted (Task 8) |
| `docs/competency-verification.sql` | **create** — six behavioural checks |

---

### Task 1: The framework tables and their seed

**Files:**
- Create: `scripts/generate-competency-seed.py`
- Create: `docs/competency-framework-migration.sql`

**Interfaces:**
- Consumes: `scripts/extract-internship-content.py`, already in the repo, which writes `kpis.json`.
- Produces: tables `competencies(id, code, name, display_order)` and `competency_kpis(id, competency_id, level, kpi_index, statement)`. Tasks 2, 3 and 9 depend on these exact column names.

You cannot run SQL against the database. Correctness is established by the generator's assertions and by review.

- [ ] **Step 1: Produce the KPI data**

```bash
python -m pip install --quiet pypdf camelot-py[base]
mkdir -p .tmp
python scripts/extract-internship-content.py \
  "C:/Users/Girisimci/Downloads/INTERNSHIP-CONTENT-DRAFT.pdf" .tmp
```

Expected: `KPIs: 48`, `triplets: 478`, then two `wrote …` lines. If the KPI count is not exactly 48 the script fails loudly and prints why — stop and report rather than proceeding with a short seed.

`.tmp/` is scratch; do not commit it. Add it to `.gitignore` if it is not already ignored.

- [ ] **Step 2: Write the seed generator**

Create `scripts/generate-competency-seed.py`:

```python
#!/usr/bin/env python3
"""Turn kpis.json into the seed half of docs/competency-framework-migration.sql.

The 48 rows are generated, never typed. A hand-written seed is where a wrong
level or a swapped KPI index enters silently, and nothing downstream would
notice: the app would simply assess against the wrong rung of the ladder.

Run:  python scripts/generate-competency-seed.py .tmp/kpis.json
Prints SQL on stdout.
"""
import json
import re
import sys
from collections import Counter

# code, display name. Order is the document's own; the framework states the
# competencies are non-hierarchical, so display_order is presentation only.
COMPETENCIES = [
    ("problem_solving", "Engineering Problem Solving"),
    ("documentation", "Technical Documentation"),
    ("communication", "Professional Communication"),
    ("digital_tools", "Digital Tool Proficiency"),
    ("ethics", "Responsibility & Ethics"),
    ("teamwork", "Collaboration & Teamwork"),
]
BY_NAME = {name: code for code, name in COMPETENCIES}


def sql_quote(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    kpis = json.load(open(sys.argv[1], encoding="utf-8"))

    if len(kpis) != 48:
        sys.exit("expected 48 KPIs, got %d" % len(kpis))
    per_competency = Counter(k["competency"] for k in kpis)
    for _, name in COMPETENCIES:
        if per_competency.get(name) != 8:
            sys.exit("%s has %d KPIs, expected 8" % (name, per_competency.get(name, 0)))
    per_level = Counter(k["level"] for k in kpis)
    for level in (1, 2, 3, 4):
        if per_level.get(level) != 12:
            sys.exit("level %d has %d KPIs, expected 12" % (level, per_level.get(level, 0)))
    seen = {(k["competency"], k["level"], k["kpi_index"]) for k in kpis}
    if len(seen) != 48:
        sys.exit("duplicate (competency, level, kpi_index) in the source data")

    print("-- Generated by scripts/generate-competency-seed.py. Do not hand-edit.")
    print("INSERT INTO competencies (code, name, display_order) VALUES")
    rows = ["  (%s, %s, %d)" % (sql_quote(code), sql_quote(name), i + 1)
            for i, (code, name) in enumerate(COMPETENCIES)]
    print(",\n".join(rows))
    print("ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name,")
    print("  display_order = EXCLUDED.display_order;")
    print()
    print("INSERT INTO competency_kpis (competency_id, level, kpi_index, statement)")
    print("SELECT c.id, v.level, v.kpi_index, v.statement")
    print("FROM (VALUES")
    values = []
    for k in kpis:
        values.append("  (%s, %d, %d, %s)" % (
            sql_quote(BY_NAME[k["competency"]]), k["level"], k["kpi_index"],
            sql_quote(re.sub(r"\s+", " ", k["statement"]).strip())))
    print(",\n".join(values))
    print(") AS v(code, level, kpi_index, statement)")
    print("JOIN competencies c ON c.code = v.code")
    print("ON CONFLICT (competency_id, level, kpi_index)")
    print("  DO UPDATE SET statement = EXCLUDED.statement;")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run it and check the output shape**

```bash
python scripts/generate-competency-seed.py .tmp/kpis.json > .tmp/seed.sql
grep -c "^  ('" .tmp/seed.sql
```

Expected: `54` — six competency rows plus 48 KPI rows. Any other number means the generator's assertions passed but its output is malformed; stop and report.

- [ ] **Step 4: Write the migration**

Create `docs/competency-framework-migration.sql` with this header and schema, then append the generated seed to the end of the file:

```sql
-- docs/competency-framework-migration.sql
-- The Engineering Internship Competency Framework as reference data.
-- Idempotent; safe to re-run.
--
-- Six competencies, four levels each, two KPIs per level = 48 rows. The seed at
-- the bottom is generated by scripts/generate-competency-seed.py from the
-- source PDF — do not hand-edit it. A hand-typed seed is where a wrong level or
-- a swapped KPI index enters silently, and nothing downstream would notice.

CREATE TABLE IF NOT EXISTS competencies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  display_order INT  NOT NULL
);

CREATE TABLE IF NOT EXISTS competency_kpis (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_id UUID NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
  level         INT  NOT NULL CHECK (level BETWEEN 1 AND 4),
  kpi_index     INT  NOT NULL CHECK (kpi_index IN (1, 2)),
  statement     TEXT NOT NULL,
  UNIQUE (competency_id, level, kpi_index)
);

ALTER TABLE competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE competency_kpis ENABLE ROW LEVEL SECURITY;

-- Read-only reference data. The framework is a project deliverable: an advisor
-- chooses which part of it applies to their group but never edits it, so there
-- is no INSERT, UPDATE or DELETE policy and no write path from the app.
DROP POLICY IF EXISTS "competencies read" ON competencies;
CREATE POLICY "competencies read" ON competencies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "competency kpis read" ON competency_kpis;
CREATE POLICY "competency kpis read" ON competency_kpis
  FOR SELECT TO authenticated USING (true);
```

Append `.tmp/seed.sql` beneath it:

```bash
cat .tmp/seed.sql >> docs/competency-framework-migration.sql
```

The `ON CONFLICT` clauses in the generated seed are what make the whole file re-runnable.

- [ ] **Step 5: Verify the file**

```bash
grep -cE '\$[a-zA-Z_]+\$' docs/competency-framework-migration.sql
grep -c "INSERT INTO" docs/competency-framework-migration.sql
```

Expected: `0` named dollar tags, `2` inserts.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npx jest --silent
git add scripts/generate-competency-seed.py docs/competency-framework-migration.sql .gitignore
git commit -m "feat: the competency framework as seeded reference data

Six competencies, four levels, two KPIs each. The 48 rows are generated
from the source PDF rather than typed: a hand-written seed is where a
wrong level or a swapped KPI index enters silently, and nothing
downstream would notice — the app would simply assess against the wrong
rung of the ladder.

Read-only. The framework is a project deliverable; an advisor chooses
which part applies to their group but never edits it, so the tables have
no write policy at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**NOTE FOR THE CONTROLLER:** the human applies this migration. Flag it; Tasks 2-8 do not block on it.

---

### Task 2: Group targets and observations

**Files:**
- Create: `docs/competency-assessment-migration.sql`

**Interfaces:**
- Consumes: `competencies` and `competency_kpis` (Task 1); `internship_groups` and `group_memberships` from the internship-groups migration.
- Produces: `group_competency_targets(id, group_id, competency_id, target_level)` and `kpi_observations(id, student_id, kpi_id, log_id, observed_by, observed_at)`. Tasks 3, 4 and 9 depend on these names.

- [ ] **Step 1: Write the migration**

Create `docs/competency-assessment-migration.sql`:

```sql
-- docs/competency-assessment-migration.sql
-- Run AFTER docs/competency-framework-migration.sql. Idempotent.

-- ============================================
-- 1. Which part of the framework a group uses
-- ============================================
-- The row's existence IS the selection. There is no `enabled` flag, which makes
-- "not selected but targeting level 3" unrepresentable rather than merely
-- discouraged.
CREATE TABLE IF NOT EXISTS group_competency_targets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  competency_id UUID NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
  target_level  INT  NOT NULL CHECK (target_level BETWEEN 1 AND 4),
  UNIQUE (group_id, competency_id)
);

ALTER TABLE group_competency_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group targets read" ON group_competency_targets;
CREATE POLICY "group targets read" ON group_competency_targets
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM internship_groups g
            WHERE g.id = group_competency_targets.group_id AND g.advisor_id = auth.uid())
    OR EXISTS (SELECT 1 FROM group_memberships m
               WHERE m.group_id = group_competency_targets.group_id
                 AND m.student_id = auth.uid() AND m.left_at IS NULL)
  );

DROP POLICY IF EXISTS "advisor writes group targets" ON group_competency_targets;
CREATE POLICY "advisor writes group targets" ON group_competency_targets
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM internship_groups g
            WHERE g.id = group_competency_targets.group_id AND g.advisor_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM internship_groups g
            WHERE g.id = group_competency_targets.group_id AND g.advisor_id = auth.uid())
  );
```

The `WITH CHECK` is not optional here. Without it Postgres reuses `USING` for the new row, and an advisor could rewrite a target's `group_id` to a group they do not own — the same gap that let an advisor reassign a membership's `student_id` in the internship-groups work.

```sql
-- ============================================
-- 2. A new group starts with the whole framework
-- ============================================
-- An advisor who never opens the competency screen must not leave their
-- students with an empty framework. Defaulting to all six matches the
-- document's position that they are equally important. Level 2 is the one
-- arbitrary number in this design and is a single constant.
CREATE OR REPLACE FUNCTION seed_group_competency_targets()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO group_competency_targets (group_id, competency_id, target_level)
  SELECT NEW.id, c.id, 2
  FROM competencies c
  ON CONFLICT (group_id, competency_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_seed_group_competency_targets ON internship_groups;
CREATE TRIGGER tr_seed_group_competency_targets
  AFTER INSERT ON internship_groups
  FOR EACH ROW EXECUTE FUNCTION seed_group_competency_targets();

-- Backfill groups that already exist.
INSERT INTO group_competency_targets (group_id, competency_id, target_level)
SELECT g.id, c.id, 2
FROM internship_groups g CROSS JOIN competencies c
ON CONFLICT (group_id, competency_id) DO NOTHING;

-- ============================================
-- 3. Observations
-- ============================================
CREATE TABLE IF NOT EXISTS kpi_observations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kpi_id      UUID NOT NULL REFERENCES competency_kpis(id) ON DELETE CASCADE,
  log_id      UUID REFERENCES daily_logs(id) ON DELETE SET NULL,
  observed_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kpi_id, log_id, observed_by)
);

CREATE INDEX IF NOT EXISTS kpi_observations_student_idx
  ON kpi_observations(student_id, kpi_id);

ALTER TABLE kpi_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "observations read" ON kpi_observations;
CREATE POLICY "observations read" ON kpi_observations
  FOR SELECT TO authenticated USING (
    student_id = auth.uid()
    OR observed_by = auth.uid()
    OR is_mentor_of(student_id)
    OR is_group_advisor_of(student_id)
  );

-- No INSERT, UPDATE or DELETE policy: record_kpi_observations is the only write
-- path. It is SECURITY DEFINER and writes as the table owner. A direct INSERT
-- would let a client set observed_by to someone else and manufacture the two
-- independent observations a level requires.
DROP POLICY IF EXISTS "observations insert" ON kpi_observations;
```

- [ ] **Step 2: Verify the file**

```bash
grep -cE '\$[a-zA-Z_]+\$' docs/competency-assessment-migration.sql
grep -c "WITH CHECK" docs/competency-assessment-migration.sql
grep -c "CREATE POLICY .* FOR INSERT" docs/competency-assessment-migration.sql
```

Expected: `0` named dollar tags, `1` `WITH CHECK`, `0` INSERT policies.

- [ ] **Step 3: Confirm the helper functions exist**

`is_mentor_of` and `is_group_advisor_of` are used by the read policy. Confirm both are defined by earlier migrations:

```bash
grep -rn "FUNCTION is_mentor_of\|FUNCTION is_group_advisor_of" docs/*.sql
```

Expected: `is_mentor_of` in `docs/database-schema.sql`, `is_group_advisor_of` in `docs/internship-groups-rls-fix.sql`. If either is missing the policy will fail on application — stop and report.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit && npx jest --silent
git add docs/competency-assessment-migration.sql
git commit -m "feat: group competency targets and KPI observations

A group's selection is the existence of its target rows, so 'not selected
but targeting level 3' cannot be represented. A new group is seeded with
all six competencies at level 2, because an advisor who never opens the
screen must not leave their students with an empty framework.

kpi_observations has no INSERT policy. record_kpi_observations is the only
write path and is SECURITY DEFINER; a direct INSERT would let a client set
observed_by to someone else and manufacture the two independent
observations a level requires.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The RPCs — where the level rule lives

**Files:**
- Create: `docs/competency-rpcs.sql`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces:
  - `get_competency_progress(p_student_id UUID)` → `TABLE(competency_id UUID, competency_code TEXT, competency_name TEXT, current_level INT, target_level INT)`
  - `get_working_kpis(p_student_id UUID)` → `TABLE(kpi_id UUID, competency_id UUID, competency_name TEXT, level INT, kpi_index INT, statement TEXT)`
  - `record_kpi_observations(p_student_id UUID, p_log_id UUID, p_kpi_ids UUID[])` → `VOID`
  - Error codes `ROLE_NOT_ALLOWED` and `NOT_AUTHENTICATED` only. These functions
    deliberately return an empty set for a student with no active group rather
    than raising — the progress list feeds a dashboard, not an action the
    student took.

  Task 4 wraps all three.

**This task carries the two rules the whole subsystem rests on.** Both fail silently if wrong: a student who can promote themselves looks exactly like one who cannot, and a ladder that can be climbed out of order looks exactly like one that cannot.

- [ ] **Step 1: Write the file**

Create `docs/competency-rpcs.sql`:

```sql
-- docs/competency-rpcs.sql
-- Run AFTER both competency migrations. Idempotent.
--
-- Every column reference inside these functions is alias-qualified. RETURNS
-- TABLE (level INT, …) creates a PL/pgSQL variable named `level`, and an
-- unqualified `WHERE level = …` raises 42702 — a bug that shipped in this
-- codebase once and survived months, because it only fires on the success path.

-- ============================================
-- 1. Who may look at whose progress
-- ============================================
CREATE OR REPLACE FUNCTION can_view_competency(p_student_id UUID)
RETURNS BOOLEAN AS $$
  SELECT p_student_id = auth.uid()
      OR is_mentor_of(p_student_id)
      OR is_group_advisor_of(p_student_id);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- 2. Current and target level per competency
-- ============================================
CREATE OR REPLACE FUNCTION get_competency_progress(p_student_id UUID)
RETURNS TABLE (
  competency_id   UUID,
  competency_code TEXT,
  competency_name TEXT,
  current_level   INT,
  target_level    INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_group UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT can_view_competency(p_student_id) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  SELECT m.group_id INTO my_group
  FROM group_memberships m
  WHERE m.student_id = p_student_id AND m.left_at IS NULL
  LIMIT 1;

  -- A student not in a group has no framework yet. Empty, not an error: this
  -- feeds a dashboard, not an action they took.
  IF my_group IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH demonstrated AS (
    -- Two observations from someone OTHER than the student. The exclusion is
    -- the whole reason a student cannot promote themselves, and it needs no
    -- extra column: a self-observation is exactly observed_by = student_id.
    SELECT k.id AS kid, k.competency_id AS cid, k.level AS lvl
    FROM competency_kpis k
    WHERE (
      SELECT count(*) FROM kpi_observations o
      WHERE o.kpi_id = k.id
        AND o.student_id = p_student_id
        AND o.observed_by <> p_student_id
    ) >= 2
  ),
  levels_done AS (
    SELECT d.cid, d.lvl
    FROM demonstrated d
    GROUP BY d.cid, d.lvl
    HAVING count(*) = 2          -- both KPIs of that level
  )
  SELECT t.competency_id, c.code, c.name,
    COALESCE((
      -- The highest L for which every level 1..L is complete. A gap anywhere
      -- below stops the ladder there, so L3 is unreachable without L2.
      SELECT max(candidate.lvl)
      FROM generate_series(1, 4) AS candidate(lvl)
      WHERE NOT EXISTS (
        SELECT 1 FROM generate_series(1, candidate.lvl) AS needed(lvl)
        WHERE NOT EXISTS (
          SELECT 1 FROM levels_done ld
          WHERE ld.cid = t.competency_id AND ld.lvl = needed.lvl
        )
      )
    ), 0)::INT,
    t.target_level
  FROM group_competency_targets t
  JOIN competencies c ON c.id = t.competency_id
  WHERE t.group_id = my_group
  ORDER BY c.display_order;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competency_progress(UUID) TO authenticated;

-- ============================================
-- 3. The KPIs to show on a log right now
-- ============================================
-- Only the two KPIs of each competency's working level — the lowest not yet
-- reached. Showing everything up to the group target would be 24 checkboxes on
-- every daily log. A competency already at its target drops off entirely.
CREATE OR REPLACE FUNCTION get_working_kpis(p_student_id UUID)
RETURNS TABLE (
  kpi_id          UUID,
  competency_id   UUID,
  competency_name TEXT,
  level           INT,
  kpi_index       INT,
  statement       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT can_view_competency(p_student_id) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  RETURN QUERY
  SELECT k.id, k.competency_id, c.name, k.level, k.kpi_index, k.statement
  FROM get_competency_progress(p_student_id) AS p
  JOIN competencies c ON c.id = p.competency_id
  JOIN competency_kpis k
    ON k.competency_id = p.competency_id
   AND k.level = p.current_level + 1
  WHERE p.current_level < p.target_level
  ORDER BY c.display_order, k.kpi_index;
END;
$$;

GRANT EXECUTE ON FUNCTION get_working_kpis(UUID) TO authenticated;

-- ============================================
-- 4. Recording ticks
-- ============================================
CREATE OR REPLACE FUNCTION record_kpi_observations(
  p_student_id UUID,
  p_log_id     UUID,
  p_kpi_ids    UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT can_view_competency(p_student_id) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  -- Re-saving a log replaces that observer's ticks on it rather than adding to
  -- them, so unticking a box actually removes the observation.
  DELETE FROM kpi_observations o
  WHERE o.student_id = p_student_id
    AND o.log_id IS NOT DISTINCT FROM p_log_id
    AND o.observed_by = auth.uid();

  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by)
  SELECT p_student_id, kid, p_log_id, auth.uid()
  FROM unnest(coalesce(p_kpi_ids, ARRAY[]::UUID[])) AS kid;
END;
$$;

GRANT EXECUTE ON FUNCTION record_kpi_observations(UUID, UUID, UUID[]) TO authenticated;
```

- [ ] **Step 2: Check every OUT-parameter name is qualified**

```bash
grep -nE "WHERE (level|kpi_index|statement|competency_id|competency_name|competency_code|current_level|target_level|kpi_id) " docs/competency-rpcs.sql
```

Expected: no output. Every such reference above is written `k.level`, `p.current_level`, `t.target_level`, `c.name` and so on. If you add a statement, qualify it.

- [ ] **Step 3: Check for named dollar tags**

```bash
grep -cE '\$[a-zA-Z_]+\$' docs/competency-rpcs.sql
```

Expected: `0`.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit && npx jest --silent
git add docs/competency-rpcs.sql
git commit -m "feat: competency progress, working KPIs and observation recording

Two rules live here and both fail silently if wrong. Only observations
where observed_by is not the student count toward a level, which is what
stops a student promoting themselves — a self-observation needs no flag,
it is exactly observed_by = student_id. And a level counts as reached only
when every level below it is also complete, so the ladder cannot be
climbed out of order.

get_working_kpis returns only the two KPIs of each competency's working
level. Showing everything up to the group target would be 24 checkboxes on
every daily log.

record_kpi_observations deletes this observer's prior ticks on the log
before inserting, so unticking a box removes the observation rather than
leaving it behind.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Types and service

**Files:**
- Create: `src/types/competency.ts`
- Create: `src/services/competency.ts`
- Modify: `src/types/index.ts`, `src/services/index.ts` — barrel exports
- Modify: `src/utils/rpcErrors.ts`
- Modify: `src/utils/__tests__/rpcErrors.test.ts`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: the RPCs from Task 3.
- Produces:
  - `Competency { id, code, name, displayOrder }`
  - `CompetencyKpi { id, competencyId, level, kpiIndex, statement }`
  - `CompetencyProgress { competencyId, code, name, currentLevel, targetLevel }`
  - `WorkingKpi { kpiId, competencyId, competencyName, level, kpiIndex, statement }`
  - `GroupCompetencyTarget { competencyId, targetLevel }`
  - `competencyService.{ listFramework, getGroupTargets, setGroupTargets, getWorkingKpis, getProgress, recordObservations, getObservedKpiIds }`

  Tasks 5, 6 and 7 use these exact names. **No new error code.** An earlier draft of
  this plan listed `NO_ACTIVE_GROUP`, but no RPC raises it — Task 3's
  `get_competency_progress` deliberately returns an empty set for a student with
  no group, and the client already has `student.noGroupYet` for that case. A
  mapping nothing raises is the same dead weight the previous subsystem had to
  clean up.

Purely additive — nothing references it yet, so the app keeps compiling.

- [ ] **Step 1: Confirm no new error code is needed**

`src/utils/rpcErrors.ts` is untouched by this task. Verify that nothing in Task 3's RPCs raises a code the map lacks:

```bash
grep -oE "RAISE EXCEPTION '[A-Z_]+'" docs/competency-rpcs.sql | sort -u
```

Expected: `NOT_AUTHENTICATED` and `ROLE_NOT_ALLOWED`, both already in `ERROR_KEYS`. If a third appears, stop and report — do not add it silently, because a client-side mapping and a server-side raise drifting apart is how an error ends up rendering as `errors.unknown`.

The test count stays at 20.

- [ ] **Step 5: Add the English strings**

Add to `advisor`:

```
"competencies": "Competencies",
"competencyScope": "Competency scope",
"competencyScopeHint": "Choose which competencies this internship develops, and how far it aims to take them.",
"targetLevel": "Target level",
"competencySaved": "Competency scope updated.",
"noCompetencies": "No competencies are selected for this group yet."
```

Add to `student`:

```
"myCompetencies": "My competencies",
"competencyLevel": "Level {{current}} of {{target}}",
"competencyNotStarted": "Not started",
"competencyComplete": "Target reached",
"whatIDidToday": "What did you demonstrate today?",
"whatIDidTodayHint": "Tick the behaviours you showed. Your mentor ticks separately — the two are compared, not merged."
```

Add to `mentor`:

```
"observedToday": "What did this student demonstrate?",
"observedTodayHint": "Tick only what you actually observed. A behaviour counts once it has been seen on two separate days.",
"noWorkingKpis": "This student has reached the group's target in every competency."
```

- [ ] **Step 6: Write the types**

Create `src/types/competency.ts`:

```ts
export interface Competency {
  id: string;
  code: string;
  name: string;
  displayOrder: number;
}

export interface CompetencyKpi {
  id: string;
  competencyId: string;
  level: number;
  kpiIndex: number;
  statement: string;
}

/** `currentLevel` is 0 until the first level is complete. */
export interface CompetencyProgress {
  competencyId: string;
  code: string;
  name: string;
  currentLevel: number;
  targetLevel: number;
}

export interface WorkingKpi {
  kpiId: string;
  competencyId: string;
  competencyName: string;
  level: number;
  kpiIndex: number;
  statement: string;
}

export interface GroupCompetencyTarget {
  competencyId: string;
  targetLevel: number;
}
```

Export them from `src/types/index.ts` following that file's existing barrel style.

- [ ] **Step 7: Write the service**

Create `src/services/competency.ts`. Follow the shape of `src/services/group.ts`: a `mapX(row: Record<string, unknown>)` helper per type, an exported service object, `throw new RpcError(error.message)` for `.rpc()` calls and plain `throw error` for PostgREST table calls.

```ts
import { supabase } from './supabase';
import { RpcError } from './rpcError';
import type {
  Competency, CompetencyKpi, CompetencyProgress, WorkingKpi, GroupCompetencyTarget,
} from '@/types/competency';

function mapCompetency(row: Record<string, unknown>): Competency {
  return {
    id: row.id as string,
    code: (row.code as string) || '',
    name: (row.name as string) || '',
    displayOrder: (row.display_order as number) ?? 0,
  };
}

function mapKpi(row: Record<string, unknown>): CompetencyKpi {
  return {
    id: row.id as string,
    competencyId: (row.competency_id as string) || '',
    level: (row.level as number) ?? 0,
    kpiIndex: (row.kpi_index as number) ?? 0,
    statement: (row.statement as string) || '',
  };
}

export const competencyService = {
  async listFramework(): Promise<{ competencies: Competency[]; kpis: CompetencyKpi[] }> {
    const [{ data: cs, error: cErr }, { data: ks, error: kErr }] = await Promise.all([
      supabase.from('competencies').select('*').order('display_order'),
      supabase.from('competency_kpis').select('*').order('level').order('kpi_index'),
    ]);
    if (cErr) throw cErr;
    if (kErr) throw kErr;
    return {
      competencies: (cs || []).map((r) => mapCompetency(r as Record<string, unknown>)),
      kpis: (ks || []).map((r) => mapKpi(r as Record<string, unknown>)),
    };
  },

  async getGroupTargets(groupId: string): Promise<GroupCompetencyTarget[]> {
    const { data, error } = await supabase
      .from('group_competency_targets')
      .select('competency_id, target_level')
      .eq('group_id', groupId);
    if (error) throw error;
    return (data || []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        competencyId: (row.competency_id as string) || '',
        targetLevel: (row.target_level as number) ?? 1,
      };
    });
  },

  /**
   * Replaces the group's whole selection. Deleting first is what makes
   * unticking a competency actually remove it — an upsert alone would leave
   * the old row in place and the competency would silently stay in scope.
   */
  async setGroupTargets(groupId: string, targets: GroupCompetencyTarget[]): Promise<void> {
    const { error: delErr } = await supabase
      .from('group_competency_targets')
      .delete()
      .eq('group_id', groupId);
    if (delErr) throw delErr;

    if (targets.length === 0) return;

    const { error } = await supabase.from('group_competency_targets').insert(
      targets.map((t) => ({
        group_id: groupId,
        competency_id: t.competencyId,
        target_level: t.targetLevel,
      })),
    );
    if (error) throw error;
  },

  async getProgress(studentId: string): Promise<CompetencyProgress[]> {
    const { data, error } = await supabase.rpc('get_competency_progress', {
      p_student_id: studentId,
    });
    if (error) throw new RpcError(error.message);
    return (data || []).map((r: Record<string, unknown>) => ({
      competencyId: (r.competency_id as string) || '',
      code: (r.competency_code as string) || '',
      name: (r.competency_name as string) || '',
      currentLevel: (r.current_level as number) ?? 0,
      targetLevel: (r.target_level as number) ?? 1,
    }));
  },

  async getWorkingKpis(studentId: string): Promise<WorkingKpi[]> {
    const { data, error } = await supabase.rpc('get_working_kpis', {
      p_student_id: studentId,
    });
    if (error) throw new RpcError(error.message);
    return (data || []).map((r: Record<string, unknown>) => ({
      kpiId: (r.kpi_id as string) || '',
      competencyId: (r.competency_id as string) || '',
      competencyName: (r.competency_name as string) || '',
      level: (r.level as number) ?? 0,
      kpiIndex: (r.kpi_index as number) ?? 0,
      statement: (r.statement as string) || '',
    }));
  },

  async recordObservations(studentId: string, logId: string | null, kpiIds: string[]): Promise<void> {
    const { error } = await supabase.rpc('record_kpi_observations', {
      p_student_id: studentId,
      p_log_id: logId,
      p_kpi_ids: kpiIds,
    });
    if (error) throw new RpcError(error.message);
  },

  /** This observer's existing ticks on one log, so the checklist opens pre-filled. */
  async getObservedKpiIds(studentId: string, logId: string, observerId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('kpi_observations')
      .select('kpi_id')
      .eq('student_id', studentId)
      .eq('log_id', logId)
      .eq('observed_by', observerId);
    if (error) throw error;
    return (data || []).map((r) => ((r as Record<string, unknown>).kpi_id as string));
  },
};
```

- [ ] **Step 8: Typecheck, test and commit**

```bash
npx tsc --noEmit && npx jest --silent
git add src/types/competency.ts src/types/index.ts src/services/competency.ts src/services/index.ts src/utils/rpcErrors.ts src/utils/__tests__/rpcErrors.test.ts src/i18n/locales/en.json
git commit -m "feat: competency types and service

Purely additive — nothing references these yet, so the app keeps
compiling while the old eight-competency model is still in place.

setGroupTargets deletes the group's rows before inserting. An upsert alone
would leave a competency the advisor just unticked in place, and it would
silently stay in scope.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The advisor's competency scope screen

**Files:**
- Create: `app/(advisor)/group-competencies.tsx`
- Modify: `app/(advisor)/_layout.tsx` — register with `href: null`
- Modify: `app/(advisor)/groups.tsx` — a second action on each group card

**Interfaces:**
- Consumes: `competencyService.listFramework`, `getGroupTargets`, `setGroupTargets`; `Competency`, `GroupCompetencyTarget`.
- Produces: the route `/(advisor)/group-competencies?groupId=…`.

- [ ] **Step 1: Write the screen**

Create `app/(advisor)/group-competencies.tsx`, following the layout conventions of `app/(advisor)/groups.tsx` — `SafeAreaView` + `ScrollView` + `RefreshControl`, the same card and button styles.

```tsx
import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { competencyService } from '@/services/competency';
import { colors, spacing, borderRadius } from '@/theme';
import type { Competency } from '@/types/competency';

const ADVISOR_COLOR = colors.info;
const LEVELS = [1, 2, 3, 4];

export default function GroupCompetenciesScreen() {
  const { t } = useTranslation();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();

  const [competencies, setCompetencies] = useState<Competency[]>([]);
  // competencyId -> target level, absent means not selected
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!groupId) return;
    try {
      const [{ competencies: cs }, ts] = await Promise.all([
        competencyService.listFramework(),
        competencyService.getGroupTargets(groupId),
      ]);
      setCompetencies(cs);
      const map: Record<string, number> = {};
      for (const target of ts) map[target.competencyId] = target.targetLevel;
      setTargets(map);
    } catch (err) {
      console.error('Group competencies load error:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  async function handleSave() {
    if (!groupId) return;
    setSaving(true);
    try {
      await competencyService.setGroupTargets(
        groupId,
        Object.entries(targets).map(([competencyId, targetLevel]) => ({
          competencyId, targetLevel,
        })),
      );
      Alert.alert(t('common.done'), t('advisor.competencySaved'));
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.unknown'));
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string) {
    setTargets((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = 2;
      return next;
    });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loading}><ActivityIndicator size="large" color={ADVISOR_COLOR} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ADVISOR_COLOR]} />
        }
      >
        <Text style={styles.screenTitle}>{t('advisor.competencyScope')}</Text>
        <Text style={styles.hint}>{t('advisor.competencyScopeHint')}</Text>

        {competencies.map((competency) => {
          const selected = competency.id in targets;
          return (
            <View key={competency.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.name}>{competency.name}</Text>
                <Switch
                  value={selected}
                  onValueChange={() => toggle(competency.id)}
                  trackColor={{ true: ADVISOR_COLOR }}
                />
              </View>

              {selected && (
                <>
                  <Text style={styles.label}>{t('advisor.targetLevel')}</Text>
                  <View style={styles.levelRow}>
                    {LEVELS.map((level) => {
                      const active = targets[competency.id] === level;
                      return (
                        <TouchableOpacity
                          key={level}
                          style={[styles.levelChip, active && styles.levelChipActive]}
                          onPress={() => setTargets((p) => ({ ...p, [competency.id]: level }))}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.levelText, active && styles.levelTextActive]}>
                            L{level}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          );
        })}

        {Object.keys(targets).length === 0 && (
          <Text style={styles.hint}>{t('advisor.noCompetencies')}</Text>
        )}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.7}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}
```

Write the `StyleSheet.create` block to match `app/(advisor)/groups.tsx`. Every style used above must exist in it: `safeArea`, `loading`, `content`, `screenTitle`, `hint`, `card`, `row`, `name`, `label`, `levelRow`, `levelChip`, `levelChipActive`, `levelText`, `levelTextActive`, `primaryBtn`, `primaryBtnText`.

Saving with nothing selected is allowed and clears the group's scope. That is deliberate — an advisor who wants a log-only internship should be able to say so — and `t('advisor.noCompetencies')` tells them what that means.

- [ ] **Step 2: Register the route without a tab**

In `app/(advisor)/_layout.tsx`, add beside the existing `href: null` entry for `student-monitor`:

```tsx
      <Tabs.Screen name="group-competencies" options={{ href: null }} />
```

The visible tab count must stay at seven.

- [ ] **Step 3: Add the action to the group card**

In `app/(advisor)/groups.tsx`, inside the `styles.actions` row of each group card, next to the existing `viewStudents` action:

```tsx
              <TouchableOpacity
                onPress={() => router.push(`/(advisor)/group-competencies?groupId=${g.id}`)}
                activeOpacity={0.7}
              >
                <Text style={styles.action}>{t('advisor.competencies')}</Text>
              </TouchableOpacity>
```

- [ ] **Step 4: Typecheck and confirm the keys resolve**

```bash
npx tsc --noEmit
python -c "
import json,re
used=set(re.findall(r\"t\('([a-zA-Z]+\.[a-zA-Z.]+)'\", open('app/(advisor)/group-competencies.tsx',encoding='utf-8').read()))
d=json.load(open('src/i18n/locales/en.json',encoding='utf-8'))
miss=[]
for k in sorted(used):
    cur=d
    for p in k.split('.'): cur=cur.get(p) if isinstance(cur,dict) else None
    if not isinstance(cur,str): miss.append(k)
print('keys:',len(used),'|',miss or 'OK')
"
```

Expected: `tsc` silent, `OK`.

- [ ] **Step 5: Commit**

```bash
npx jest --silent
git add app/\(advisor\)/group-competencies.tsx app/\(advisor\)/_layout.tsx app/\(advisor\)/groups.tsx
git commit -m "feat: advisor competency scope screen

Six toggles and a level picker each, reached from a second action on the
group card. Registered with href: null so the tab count stays at seven.

Saving with nothing selected clears the scope rather than being rejected —
an advisor who wants a log-only internship should be able to say so, and
the empty state says what it means.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The KPI checklist on both log screens

**Files:**
- Create: `src/components/competency/KpiChecklist.tsx`
- Create: `src/components/competency/index.ts`
- Modify: `app/(mentor)/review-log.tsx` (competency block around lines 531-560, state at 177, validation at 252-253, submit at 312)
- Modify: `app/(student)/create-log.tsx` (competency block, state at 95, XP gate at 114-117, submit at 450)

**Interfaces:**
- Consumes: `competencyService.getWorkingKpis`, `recordObservations`, `getObservedKpiIds`; `WorkingKpi`.
- Produces: `<KpiChecklist studentId={string} logId={string | null} observerId={string} title={string} hint={string} onChange={(kpiIds: string[]) => void} />`, which loads its own working KPIs and pre-fills the observer's existing ticks. Task 7 does not use it.

- [ ] **Step 1: Write the component**

Create `src/components/competency/KpiChecklist.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { competencyService } from '@/services/competency';
import { colors, spacing, borderRadius } from '@/theme';
import type { WorkingKpi } from '@/types/competency';

interface Props {
  studentId: string;
  logId: string | null;
  observerId: string;
  title: string;
  hint: string;
  onChange: (kpiIds: string[]) => void;
}

export function KpiChecklist({ studentId, logId, observerId, title, hint, onChange }: Props) {
  const { t } = useTranslation();
  const [kpis, setKpis] = useState<WorkingKpi[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const working = await competencyService.getWorkingKpis(studentId);
      setKpis(working);
      if (logId) {
        const already = await competencyService.getObservedKpiIds(studentId, logId, observerId);
        setSelected(new Set(already));
        onChange(already);
      }
    } catch (err) {
      console.error('KPI checklist load error:', err);
    } finally {
      setLoading(false);
    }
    // onChange is intentionally omitted: parents pass an inline arrow, and
    // including it would reload the list on every parent render.
  }, [studentId, logId, observerId]);

  useEffect(() => { load(); }, [load]);

  function toggle(kpiId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kpiId)) next.delete(kpiId);
      else next.add(kpiId);
      onChange(Array.from(next));
      return next;
    });
  }

  if (loading) return <ActivityIndicator size="small" color={colors.primary} />;

  if (kpis.length === 0) {
    return <Text style={styles.empty}>{t('mentor.noWorkingKpis')}</Text>;
  }

  // Grouped by competency so the mentor reads "Technical Documentation: these
  // two behaviours", not a flat list of twelve sentences.
  const byCompetency = kpis.reduce<Record<string, WorkingKpi[]>>((acc, kpi) => {
    (acc[kpi.competencyName] = acc[kpi.competencyName] || []).push(kpi);
    return acc;
  }, {});

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>

      {Object.entries(byCompetency).map(([name, items]) => (
        <View key={name} style={styles.group}>
          <Text style={styles.groupName}>
            {name} · L{items[0].level}
          </Text>
          {items.map((kpi) => {
            const on = selected.has(kpi.kpiId);
            return (
              <TouchableOpacity
                key={kpi.kpiId}
                style={styles.row}
                onPress={() => toggle(kpi.kpiId)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={on ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={on ? colors.primary : colors.textDisabled}
                />
                <Text style={styles.statement}>{kpi.statement}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}
```

Write the `StyleSheet.create` block in the same file. Styles used: `container`, `title`, `hint`, `group`, `groupName`, `row`, `statement`, `empty`.

Create `src/components/competency/index.ts`:

```ts
export { KpiChecklist } from './KpiChecklist';
```

- [ ] **Step 2: Replace the mentor's competency block**

In `app/(mentor)/review-log.tsx`:

Delete the `COMPETENCIES` import (line 25 — keep `LIMITS`), the local `COMPETENCY_LABELS` map (around line 39), the `competencyRatings` state (line 177), and the whole `COMPETENCIES.map(...)` rating block (around lines 531-560).

Add `const [observedKpis, setObservedKpis] = useState<string[]>([]);` and render:

```tsx
                <KpiChecklist
                  studentId={logDetail.studentId}
                  logId={logDetail.id}
                  observerId={user!.id}
                  title={t('mentor.observedToday')}
                  hint={t('mentor.observedTodayHint')}
                  onChange={setObservedKpis}
                />
```

**Delete the submit gate at lines 252-253.** It currently refuses to submit until all eight competencies are rated:

```ts
    const ratedCount = Object.values(competencyRatings).filter((v) => v > 0).length;
    if (ratedCount < COMPETENCIES.length) { … }
```

Ticking is not scoring: a mentor who saw none of the working behaviours today must be able to submit a review with nothing ticked, and forcing a tick would manufacture observations. Remove the check entirely rather than replacing it with a KPI-count equivalent.

In the submit handler (around line 312), drop `competencyRatings` from the payload and call:

```ts
      await competencyService.recordObservations(logDetail.studentId, logDetail.id, observedKpis);
```

- [ ] **Step 3: Replace the student's self-assessment block**

In `app/(student)/create-log.tsx`, make the same substitution: delete the `COMPETENCIES` import (line 28 — keep `LIMITS`), the local `COMPETENCY_LABELS` (line 53), the `competencyRatings` state (line 95) and the rating UI, and render `<KpiChecklist … />` with `title={t('student.whatIDidToday')}` and `hint={t('student.whatIDidTodayHint')}`, `studentId={user!.id}` and `observerId={user!.id}`.

**The XP gate at lines 114-117 needs a decision, not a translation.** It currently reads:

```ts
    const allRated = COMPETENCIES.every((c) => competencyRatings[c] && competencyRatings[c] >= 1);
    const assessmentPoints = allRated ? POINT_VALUES.selfAssessment : 0;
```

"All rated" has no equivalent under ticking, because ticking nothing is a legitimate answer. Hinge the same XP on `reflectionNotes` being non-empty instead:

```ts
    const assessmentPoints = reflectionNotes.trim() ? POINT_VALUES.selfAssessment : 0;
```

Reflection is effort; ticking is a claim, and paying XP per tick would pay students to over-claim the very behaviours the framework exists to measure honestly. Apply the same substitution to the other two places that compute `allRated` (around lines 123-126 and 450) — grep for `allRated` and make sure none survive.

- [ ] **Step 4: Verify nothing references the old model in these two files**

```bash
npx tsc --noEmit
grep -nE "COMPETENCIES|competencyRatings|allRated|COMPETENCY_LABELS" "app/(mentor)/review-log.tsx" "app/(student)/create-log.tsx"
```

Expected: `tsc` silent, `grep` empty.

- [ ] **Step 5: Commit**

```bash
npx jest --silent
git add src/components/competency app/\(mentor\)/review-log.tsx app/\(student\)/create-log.tsx
git commit -m "feat: tick observed KPIs instead of scoring competencies

Both log screens lose their eight 1-5 sliders for a shared checklist of
the student's working-level KPIs, grouped by competency.

Two gates had to go rather than be translated. The mentor's submit no
longer requires every competency to be rated: a mentor who saw none of the
working behaviours today must be able to submit with nothing ticked, and
forcing a tick manufactures observations. And the student's
self-assessment XP now hinges on the reflection note rather than on having
rated everything — reflection is effort, ticking is a claim, and paying XP
per tick would pay students to over-claim the behaviours the framework
exists to measure honestly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The comparison and the progress display

**Files:**
- Modify: `app/(advisor)/validation.tsx` (self/mentor comparison, types at 67-74, mapping at 98-134)
- Modify: `app/(student)/achievements.tsx`

**Interfaces:**
- Consumes: `competencyService.getProgress`, `getObservedKpiIds`; `CompetencyProgress`.
- Produces: nothing later depends on it.

- [ ] **Step 1: Rework the advisor's comparison**

In `app/(advisor)/validation.tsx`, the `selfAssessment.competencyRatings` and `mentorCompetencyRatings` fields (lines 67-74, 98, 126, 134) become tick sets. Replace them with two string arrays fetched alongside the log detail:

```tsx
  const [studentTicks, setStudentTicks] = useState<string[]>([]);
  const [mentorTicks, setMentorTicks] = useState<string[]>([]);
```

loaded with `competencyService.getObservedKpiIds(studentId, logId, studentId)` and the same call with the mentor's id, which the log detail already carries.

Render three groups. The statements come from `competencyService.getWorkingKpis(studentId)`, loaded alongside the ticks and held in a `Record<string, string>` keyed by `kpiId`:

```tsx
  const both = studentTicks.filter((id) => mentorTicks.includes(id));
  const studentOnly = studentTicks.filter((id) => !mentorTicks.includes(id));
  const mentorOnly = mentorTicks.filter((id) => !studentTicks.includes(id));

  const renderGroup = (label: string, ids: string[], icon: keyof typeof Ionicons.glyphMap, tint: string) =>
    ids.length === 0 ? null : (
      <View style={styles.compareGroup}>
        <Text style={styles.compareLabel}>{label}</Text>
        {ids.map((id) => (
          <View key={id} style={styles.compareRow}>
            <Ionicons name={icon} size={16} color={tint} />
            <Text style={styles.compareText}>{kpiStatements[id] || id}</Text>
          </View>
        ))}
      </View>
    );
```

and in the detail view, where the competency comparison block used to be:

```tsx
        {renderGroup(t('advisor.agreedOn'), both, 'checkmark-circle', colors.success)}
        {renderGroup(t('advisor.studentClaimedOnly'), studentOnly, 'help-circle', colors.warning)}
        {renderGroup(t('advisor.mentorSawOnly'), mentorOnly, 'eye', colors.info)}
        {both.length + studentOnly.length + mentorOnly.length === 0 && (
          <Text style={styles.compareEmpty}>{t('advisor.nothingTicked')}</Text>
        )}
```

Add these four keys to `advisor` in `src/i18n/locales/en.json`:

```
"agreedOn": "Both agreed",
"studentClaimedOnly": "Student ticked, mentor did not",
"mentorSawOnly": "Mentor saw, student did not tick",
"nothingTicked": "Neither party ticked anything on this log."
```

Styles used: `compareGroup`, `compareLabel`, `compareRow`, `compareText`, `compareEmpty`. Add them to that file's `StyleSheet.create` following its existing conventions.

The middle group is the one worth reading: "the student believes they demonstrated this, the mentor did not see it" is a conversation the advisor can have, where the numeric gap it replaces was not.

- [ ] **Step 2: Add progress to the student's achievements screen**

In `app/(student)/achievements.tsx`, add a competency section fed by `competencyService.getProgress(user.id)`:

```tsx
        {progress.map((p) => (
          <View key={p.competencyId} style={styles.competencyRow}>
            <Text style={styles.competencyName}>{p.name}</Text>
            <Text style={styles.competencyLevel}>
              {p.currentLevel === 0
                ? t('student.competencyNotStarted')
                : p.currentLevel >= p.targetLevel
                  ? t('student.competencyComplete')
                  : t('student.competencyLevel', { current: p.currentLevel, target: p.targetLevel })}
            </Text>
          </View>
        ))}
```

A student with no group gets an empty array from the RPC — render nothing rather than an error, matching how the leaderboard already handles that case.

- [ ] **Step 3: Typecheck and confirm the keys resolve**

```bash
npx tsc --noEmit
python -c "
import json,re
used=set()
for f in ['app/(advisor)/validation.tsx','app/(student)/achievements.tsx']:
    used|=set(re.findall(r\"t\('([a-zA-Z]+\.[a-zA-Z.]+)'\", open(f,encoding='utf-8').read()))
d=json.load(open('src/i18n/locales/en.json',encoding='utf-8'))
miss=[]
for k in sorted(used):
    cur=d
    for p in k.split('.'): cur=cur.get(p) if isinstance(cur,dict) else None
    if not isinstance(cur,str): miss.append(k)
print('keys:',len(used),'|',miss or 'OK')
"
```

Expected: `tsc` silent, `OK`.

- [ ] **Step 4: Commit**

```bash
npx jest --silent
git add app/\(advisor\)/validation.tsx app/\(student\)/achievements.tsx
git commit -m "feat: tick-set comparison and competency progress

The advisor's validation screen compares what the student ticked against
what the mentor ticked, in three groups: agreed, student only, mentor
only. That is a conversation in a way a numeric gap never was.

Achievements gains a competency section showing current and target level.
A student with no group gets an empty list, matching how the leaderboard
already handles that case.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Delete the eight-competency model

Deliberately last. Removing any of this earlier would leave the tree non-compiling.

**Files:**
- Modify: `src/utils/constants.ts`
- Modify: `src/types/log.ts:53,64`
- Modify: `src/services/logs.ts:283,291,308,342`
- Modify: `src/services/advisor.ts:50`
- Create: `docs/competency-cleanup-migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This task only removes.

- [ ] **Step 1: Delete the constants**

In `src/utils/constants.ts`, delete `COMPETENCIES` and `COMPETENCY_RUBRIC` entirely. Leave everything else — `LIMITS`, `POINT_VALUES`, `PRIVACY_POLICY_VERSION` and the rest are unrelated and still used.

- [ ] **Step 2: Drop `competencyRatings` from the log types and services**

`src/types/log.ts:53,64` declare `competencyRatings: Record<string, number>` on the self-assessment and mentor-feedback shapes. Remove both fields, then follow the type errors: `src/services/logs.ts` takes `competencyRatings` as a parameter at lines 283 and 308 and writes `competency_ratings` at 291 and 342, and `src/services/advisor.ts:50` selects the column. Remove the parameter, the writes and the select.

Callers of those service functions lose an argument. Fix each one `tsc` reports.

- [ ] **Step 3: Sweep**

```bash
npx tsc --noEmit
grep -rn "COMPETENCIES\|COMPETENCY_RUBRIC\|competencyRatings\|competency_ratings" src/ app/
```

Expected: `tsc` silent, `grep` empty. Any hit is a live reference to something deleted — fix it here rather than leaving it for the final review.

- [ ] **Step 4: Write the cleanup migration**

Create `docs/competency-cleanup-migration.sql`:

```sql
-- docs/competency-cleanup-migration.sql
-- Run LAST, after the app no longer reads these columns.
--
-- The eight-competency JSONB scoring is replaced by kpi_observations. Both
-- tables survive: they still carry reflection_notes, rating, comments and
-- is_approved. Only the scoring goes.

-- Nothing else reads these columns, so no policy or function depends on them —
-- but check before assuming, because a policy's qual holds a hard dependency on
-- every column it names and dropping one out from under a policy fails 2BP01.
DO $$
DECLARE
  blocking TEXT;
BEGIN
  SELECT string_agg(policyname || ' on ' || tablename, ', ') INTO blocking
  FROM pg_policies
  WHERE qual LIKE '%competency_ratings%' OR with_check LIKE '%competency_ratings%';

  IF blocking IS NOT NULL THEN
    RAISE EXCEPTION 'policies still read competency_ratings: %', blocking;
  END IF;
END $$;

ALTER TABLE self_assessments DROP COLUMN IF EXISTS competency_ratings;
ALTER TABLE mentor_feedbacks DROP COLUMN IF EXISTS competency_ratings;
```

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npx jest --silent
git add -A
git commit -m "refactor: delete the eight-competency model

COMPETENCIES and COMPETENCY_RUBRIC were never research-based; the
project's own framework replaces them. The competency_ratings JSONB
columns go with them — self_assessments and mentor_feedbacks survive,
carrying reflection_notes, rating, comments and is_approved.

Deleted last on purpose. Removing any of it earlier would have left the
app non-compiling between tasks.

The cleanup migration checks for policies reading the columns before
dropping them. Nothing does today, but a policy's qual holds a hard
dependency on every column it names, and that trap cost three failed
migrations on the previous subsystem.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Verification

**Files:**
- Create: `docs/competency-verification.sql`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Write the script**

Create `docs/competency-verification.sql`, two submissions. Part A asserts schema; Part B exercises the two rules inside a transaction that rolls back. Anonymous `$$` only; no temp table — results accumulate in a text variable handed over through a transaction-local GUC, the pattern `docs/internship-groups-verification.sql` uses.

```sql
-- ============================================================
-- PART A — schema assertions
-- Expected: one row, "PASS: schema assertions held".
-- ============================================================

DO $$
DECLARE
  n INT;
BEGIN
  SELECT count(*) INTO n FROM competencies;
  IF n <> 6 THEN RAISE EXCEPTION 'FAIL: % competencies, expected 6', n; END IF;

  SELECT count(*) INTO n FROM competency_kpis;
  IF n <> 48 THEN RAISE EXCEPTION 'FAIL: % KPIs, expected 48', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT c.id FROM competencies c
    JOIN competency_kpis k ON k.competency_id = c.id
    GROUP BY c.id HAVING count(*) <> 8
  ) AS bad;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % competencies do not have 8 KPIs', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT k.level FROM competency_kpis k
    GROUP BY k.level HAVING count(*) <> 12
  ) AS bad;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % levels do not have 12 KPIs', n; END IF;

  -- No write path to the framework, and none to observations either: both are
  -- reference or RPC-only tables, and an INSERT policy on kpi_observations
  -- would let a client set observed_by to someone else.
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE tablename IN ('competencies','competency_kpis','kpi_observations')
               AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: a write policy exists on a read-only or RPC-only table';
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS result;
```

Then Part B, a separate submission.

**A subtlety the script must respect:** in Postgres a unique index treats NULLs as
distinct, so `UNIQUE (kpi_id, log_id, observed_by)` does **not** block two rows
that differ only by having `log_id IS NULL`. Every case below therefore attaches
observations to real `daily_logs` rows, created inside the transaction. This is
not a defect in the schema — `record_kpi_observations` deletes the caller's prior
ticks for that log before inserting, so re-saving replaces rather than
accumulates, and no direct INSERT path exists — but a verification script that
used NULL log ids would prove nothing about case 5.

```sql
-- ============================================================
-- PART B — the two rules
-- Submit everything from BEGIN to ROLLBACK in one go.
--
-- Expected rows:
--   1 defaults      6 targets at level 2
--   2 mentor twice  current_level = 1
--   3 self twice    current_level = 0
--   4 L2 not L1     current_level = 0
--   5 double tick   rejected by the unique index
--   6 at target     absent from working KPIs
-- ============================================================

BEGIN;

DO $$
DECLARE
  adv  UUID;
  stu  UUID;
  grp  UUID;
  comp UUID;
  k1a  UUID; k1b UUID; k2a UUID; k2b UUID;
  lgA  UUID; lgB UUID;
  lvl  INT;
  n    INT;
  log  TEXT := '';
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;

  IF adv IS NULL OR stu IS NULL THEN
    PERFORM set_config('probe.results',
      '1-6 competency' || E'\t' || 'SKIP: needs one advisor and one student profile' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe competency')
  RETURNING id INTO grp;

  -- 1. The AFTER INSERT trigger should have seeded the whole framework.
  SELECT count(*) INTO n FROM group_competency_targets t
  WHERE t.group_id = grp AND t.target_level = 2;
  log := log || '1 defaults' || E'\t'
      || CASE WHEN n = 6 THEN '6 targets at level 2'
              ELSE 'FAIL: ' || n || ' targets at level 2' END || E'\n';

  DELETE FROM group_memberships m WHERE m.student_id = stu;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);

  SELECT c.id INTO comp FROM competencies c ORDER BY c.display_order LIMIT 1;
  SELECT k.id INTO k1a FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 1 AND k.kpi_index = 1;
  SELECT k.id INTO k1b FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 1 AND k.kpi_index = 2;
  SELECT k.id INTO k2a FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 2 AND k.kpi_index = 1;
  SELECT k.id INTO k2b FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 2 AND k.kpi_index = 2;

  -- Two real logs. The threshold is two observations of a KPI, and with a real
  -- log id the unique index makes "two" mean two separate days rather than one
  -- row saved twice.
  INSERT INTO daily_logs (student_id, date, title, content)
  VALUES (stu, CURRENT_DATE - 1, 'Probe A', 'Probe A') RETURNING id INTO lgA;
  INSERT INTO daily_logs (student_id, date, title, content)
  VALUES (stu, CURRENT_DATE - 2, 'Probe B', 'Probe B') RETURNING id INTO lgB;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);

  -- 2. Both L1 KPIs seen by the advisor on two different days.
  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by) VALUES
    (stu, k1a, lgA, adv), (stu, k1b, lgA, adv),
    (stu, k1a, lgB, adv), (stu, k1b, lgB, adv);

  SELECT p.current_level INTO lvl
  FROM get_competency_progress(stu) AS p WHERE p.competency_id = comp;
  log := log || '2 mentor twice' || E'\t'
      || CASE WHEN lvl = 1 THEN 'current_level = 1'
              ELSE 'FAIL: current_level = ' || coalesce(lvl, -1) END || E'\n';

  -- 3. The same pattern, but the student ticking their own boxes. This is the
  --    check that stops a student promoting themselves.
  DELETE FROM kpi_observations o WHERE o.student_id = stu;
  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by) VALUES
    (stu, k1a, lgA, stu), (stu, k1b, lgA, stu),
    (stu, k1a, lgB, stu), (stu, k1b, lgB, stu);

  SELECT p.current_level INTO lvl
  FROM get_competency_progress(stu) AS p WHERE p.competency_id = comp;
  log := log || '3 self twice' || E'\t'
      || CASE WHEN lvl = 0 THEN 'current_level = 0'
              ELSE 'FAIL: self ticks promoted to ' || lvl END || E'\n';

  -- 4. L2 fully demonstrated, L1 untouched. The ladder must not be climbable
  --    out of order.
  DELETE FROM kpi_observations o WHERE o.student_id = stu;
  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by) VALUES
    (stu, k2a, lgA, adv), (stu, k2b, lgA, adv),
    (stu, k2a, lgB, adv), (stu, k2b, lgB, adv);

  SELECT p.current_level INTO lvl
  FROM get_competency_progress(stu) AS p WHERE p.competency_id = comp;
  log := log || '4 L2 not L1' || E'\t'
      || CASE WHEN lvl = 0 THEN 'current_level = 0'
              ELSE 'FAIL: skipped to level ' || lvl END || E'\n';

  -- 5. The same observer cannot tick the same KPI twice on one log.
  BEGIN
    INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by)
    VALUES (stu, k2a, lgA, adv);
    log := log || '5 double tick' || E'\t' || 'FAIL: duplicate accepted' || E'\n';
  EXCEPTION WHEN unique_violation THEN
    log := log || '5 double tick' || E'\t' || 'rejected by the unique index' || E'\n';
  WHEN OTHERS THEN
    log := log || '5 double tick' || E'\t' || 'FAIL (wrong error): ' || SQLERRM || E'\n';
  END;

  -- 6. A competency already at its target drops out of the working list.
  UPDATE group_competency_targets t SET target_level = 1
  WHERE t.group_id = grp AND t.competency_id = comp;
  DELETE FROM kpi_observations o WHERE o.student_id = stu;
  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by) VALUES
    (stu, k1a, lgA, adv), (stu, k1b, lgA, adv),
    (stu, k1a, lgB, adv), (stu, k1b, lgB, adv);

  SELECT count(*) INTO n FROM get_working_kpis(stu) AS w WHERE w.competency_id = comp;
  log := log || '6 at target' || E'\t'
      || CASE WHEN n = 0 THEN 'absent from working KPIs'
              ELSE 'FAIL: still returns ' || n || ' KPIs' END || E'\n';

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;
```

**Rows 3 and 4 cannot be skipped.** Both fail silently: 3 lets students promote themselves with nothing on screen looking broken, and 4 collapses the framework's progression claim while the system continues to appear functional.

- [ ] **Step 2: Have the human run it**

Ask the user to apply, in order: `docs/competency-framework-migration.sql`, `docs/competency-assessment-migration.sql`, `docs/competency-rpcs.sql`, then `docs/competency-cleanup-migration.sql`, then Parts A and B of this file. Record each result verbatim.

- [ ] **Step 3: Add the PROGRESS row**

Append to the Session Log table in `PROGRESS.md`:

```markdown
| 2026-08-19 | Session 15 | Competency framework (subsystem B of three). Replaced the eight hardcoded competencies with the project's own framework — 6 competencies, 4 levels, 2 KPIs each, 48 rows seeded from `INTERNSHIP-CONTENT-DRAFT.pdf` via `scripts/extract-internship-content.py`. Advisors scope the framework per group (which competencies, how far). Daily assessment became ticking observed KPIs rather than scoring sliders; levels derive from two observations per KPI by someone other than the student, and a level counts only when every level below it is complete. Migrations: `docs/competency-framework-migration.sql`, `docs/competency-assessment-migration.sql`, `docs/competency-rpcs.sql`, `docs/competency-cleanup-migration.sql`; verification: `docs/competency-verification.sql` |
```

- [ ] **Step 4: Device checklist**

Record the actual result of each line.

1. An advisor opens a group's competency scope and sees six competencies, all on, all at L2.
2. The advisor turns two off and sets one to L1; reopening shows the change persisted.
3. A student's log screen shows the working KPIs of the remaining competencies only — two per competency, none from the switched-off ones.
4. The student ticks two and saves; reopening the log shows them still ticked.
5. The mentor reviews the same log and sees the same list, with their own ticks empty rather than the student's.
6. The mentor ticks both KPIs of one competency's L1 on two different logs.
7. The student's achievements screen now shows that competency at level 1.
8. The advisor's validation screen shows the three comparison groups for a log both parties ticked.
9. A competency the advisor set to L1 disappears from the checklist once the student reaches L1.
10. A student with no group sees no competency section and no error.

- [ ] **Step 5: Commit**

```bash
git add docs/competency-verification.sql PROGRESS.md
git commit -m "test: verify the competency framework

Rows 3 and 4 of Part B are the load-bearing cases. Both fail silently if
the rule is wrong: 3 lets a student promote themselves with nothing on
screen looking broken, and 4 collapses the framework's progression claim
while the system continues to appear functional.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes for the implementer

**Nothing may leave the app non-compiling.** The order exists for that: the data layer lands in Task 4 while the old model is still present, the screens switch over in 5-7, and only then does Task 8 delete.

**Two constants are flagged as arbitrary in the spec and stay that way.** The default target level of 2 (Task 2) and the two-observation threshold (Task 3). Do not tune them; if either looks wrong, say so and leave it.

**The self-observation exclusion needs no column.** A self-observation is exactly `observed_by = student_id`. If you find yourself adding an `is_self` flag, the rule has already been implemented for you.

**Do not reintroduce scoring.** If you find yourself writing a 1-5 rating, a slider, or a `Record<string, number>` of competency scores, you are working from the model this subsystem removes.
