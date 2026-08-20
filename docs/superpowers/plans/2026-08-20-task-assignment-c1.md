# Task Assignment C1 — Reference Data and Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the 478 learning triplets mapped to their KPIs, the assignment and submission tables, and the bridge that turns a mentor's approval into a KPI observation — all verifiable without a single screen.

**Architecture:** Triplets become read-only reference data hanging off `competency_kpis`, extracted from the PDF by walking camelot tables in document order. Assignments are made to a group and carry copies of the objective and criterion; per-student submissions are created on first action. All writes go through `SECURITY DEFINER` RPCs and all policies route through `SECURITY DEFINER` helpers, because these tables must consult group ownership, group membership and the mentor link at once — the exact shape that produced a `42P17` recursion on 2026-08-20.

**Tech Stack:** Postgres/Supabase (RLS, PL/pgSQL, RPCs), Python 3.11 with camelot + pypdf for extraction, TypeScript service layer, Jest for the pure helpers.

**Spec:** `docs/superpowers/specs/2026-08-20-task-assignment-design.md`

## Global Constraints

- Path aliases only (`@/…`); never a relative path out of `src/`.
- `npx tsc --noEmit` must be silent at the end of every task.
- `npx jest --silent` must pass. Baseline is 3 suites / 20 tests; only Task 5 changes that count.
- Do not touch any locale file except `src/i18n/locales/en.json`. Translation is paused project-wide and `fallbackLng` is `'en'`.
- Migrations are written, never executed by an implementer. They are applied by hand against the live database.
- No `CASCADE` on any drop.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `.tmp/` is gitignored. Extraction artifacts are never committed; generated migrations are.

---

### Task 1: Map every triplet to its KPI

**Files:**
- Modify: `scripts/extract-internship-content.py` (`extract_triplets` at 134-173, `check` at 175, `main` at 226)

**Interfaces:**
- Consumes: nothing.
- Produces: `.tmp/triplets.json`, where each entry gains `competency: str`, `level: int`, `kpi_index: int` alongside the existing `objective`, `task`, `criterion`, `pages`.

The mechanism, established by probing the PDF and recorded in the spec: **the KPI heading is a row inside the triplet table**, not a page position. A section's table reads `L1` / `KPI1: …` / the column headers / then the triplets. Document-wide there are 48 heading rows in 48 distinct tables and 499 raw triplet rows that merge to 478.

- [ ] **Step 1: Rewrite `extract_triplets` to carry the KPI**

Replace the whole function. It now takes the already-extracted KPI list so it can both assign and verify alignment:

```python
def extract_triplets(pdf_path, kpis):
    """The Learning Objective / Task / Assessment Criterion rows, each tagged
    with the KPI it sits under.

    The KPI heading is a row inside the same table as its triplets, above the
    column headers, so no page geometry is needed: a triplet belongs to the
    heading row above it in its own table.

    The table carries the level and the KPI index but not the competency name,
    which lives in the text layer. `kpis` is already in document order, so the
    Nth table carrying a heading is the Nth KPI — an assumption this function
    proves rather than trusts, by matching the heading's statement text.
    """
    import camelot

    tables = camelot.read_pdf(pdf_path, pages="1-80", flavor="lattice")
    ordered = sorted(tables, key=lambda t: (t.page, t.order))

    rows = []
    seen_kpis = 0
    current = None
    for table in ordered:
        df = table.df
        for i in range(len(df)):
            cells = [" ".join(str(x).split()) for x in df.iloc[i].tolist()]
            first = cells[0] if cells else ""

            if re.match(r"KPI\s*\d\s*:", first):
                if seen_kpis >= len(kpis):
                    raise SystemExit(f"FAIL: more KPI headings than the {len(kpis)} extracted")
                current = kpis[seen_kpis]
                statement = re.sub(r"^KPI\s*\d\s*:\s*", "", first)
                # The table cell and the text layer must be the same sentence.
                # A mismatch means the Nth heading is not the Nth KPI, and every
                # triplet after it would be filed under the wrong competency.
                head = " ".join(statement.split())[:40].lower()
                want = " ".join(current["statement"].split())[:40].lower()
                if head != want:
                    raise SystemExit(
                        f"FAIL: KPI {seen_kpis + 1} misaligned\n"
                        f"  table: {head}\n"
                        f"  kpis : {want}"
                    )
                seen_kpis += 1
                continue

            if len(cells) != 3 or not all(cells):
                continue
            if "LEARNING" in first.upper():
                continue
            if current is None:
                raise SystemExit("FAIL: a triplet row appeared before any KPI heading")

            rows.append({
                "page": table.page,
                "competency": current["competency"],
                "level": current["level"],
                "kpi_index": current["kpi_index"],
                "objective": cells[0],
                "task": cells[1],
                "criterion": cells[2],
            })

    if seen_kpis != len(kpis):
        raise SystemExit(f"FAIL: {seen_kpis} KPI headings in tables, expected {len(kpis)}")

    # A row split across a page break arrives as two rows whose first cell does
    # not end in a period. Merge only within one KPI: a merge across a boundary
    # would silently move text between competencies.
    merged = []
    for row in rows:
        previous = merged[-1] if merged else None
        continues = (
            previous is not None
            and not previous["objective"].rstrip().endswith(".")
            and row["page"] != previous["pages"][-1]
            and (previous["competency"], previous["level"], previous["kpi_index"])
                == (row["competency"], row["level"], row["kpi_index"])
        )
        if continues:
            for key in ("objective", "task", "criterion"):
                previous[key] = (previous[key] + " " + row[key]).strip()
            previous["pages"] = sorted(set(previous["pages"] + [row["page"]]))
        else:
            entry = dict(row)
            entry["pages"] = [entry.pop("page")]
            merged.append(entry)
    return merged
```

- [ ] **Step 2: Assert the shape of a boundary error in `check`**

A misfiled triplet leaves no gap and raises nothing — it is a plausible sentence in the wrong place. The distribution is what betrays it: when a boundary slips, one KPI takes about twenty and its neighbour takes none. Add to `check`:

```python
    counts = Counter(
        (t["competency"], t["level"], t["kpi_index"]) for t in triplets
    )
    if len(counts) != len(kpis):
        raise SystemExit(f"FAIL: {len(counts)} KPIs carry triplets, expected {len(kpis)}")

    outside = {k: n for k, n in counts.items() if not 8 <= n <= 12}
    if outside:
        raise SystemExit(f"FAIL: KPIs outside the 8-12 band: {outside}")

    # Within the band this is not a failure, but it is where a missing triplet
    # would hide, so it is reported for the human pass. The document says ten
    # each; 478 across 48 averages 9.96.
    uneven = {k: n for k, n in counts.items() if n != 10}
    print(f"note: {len(uneven)} KPIs do not hold exactly 10 triplets: {uneven}", file=sys.stderr)
```

- [ ] **Step 3: Print one sample per KPI for the human pass**

In `main`, after `check` passes:

```python
    import random
    random.seed(0)          # same 48 samples on every run, so a re-check is comparable
    by_kpi = {}
    for t in triplets:
        by_kpi.setdefault((t["competency"], t["level"], t["kpi_index"]), []).append(t)
    print("\n--- one sample per KPI, compare against the PDF ---", file=sys.stderr)
    for key in sorted(by_kpi):
        s = random.choice(by_kpi[key])
        print(f"{key[0]} L{key[1]} KPI{key[2]}: {s['objective']}  (p{s['pages'][0]})", file=sys.stderr)
```

- [ ] **Step 4: Wire `extract_triplets` to its new argument**

In `main`, `extract_triplets(pdf_path)` becomes `extract_triplets(pdf_path, kpis)`. The KPI extraction must run first.

- [ ] **Step 5: Run it**

```bash
python scripts/extract-internship-content.py "C:/Users/Girisimci/Downloads/INTERNSHIP-CONTENT-DRAFT.pdf"
```

Expected: no `FAIL:`, 478 triplets, every KPI inside the 8-12 band, and 48 sample lines. Camelot takes several minutes over 80 pages — do not assume it has hung.

If a `FAIL:` appears, do not widen the band or relax the alignment check to make it pass. Both exist to catch exactly the error you would be hiding. Report it instead.

- [ ] **Step 6: Commit**

```bash
git add scripts/extract-internship-content.py
git commit -m "feat: map every triplet to the KPI it belongs to

The KPI heading is a row inside the triplet table, above the column
headers, so a triplet belongs to the heading in its own table. No page
geometry, no ambiguous pages.

The table gives the level and the index but not the competency, which
comes from the KPI list by document order. That order is proven rather
than assumed: the heading row's statement is matched against the
corresponding entry and a mismatch stops the run, because a misalignment
would file every following triplet under the wrong competency and
nothing downstream would notice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Generate the triplet seed migration

**Files:**
- Create: `scripts/generate-triplet-seed.py`
- Create: `docs/task-triplets-migration.sql` (generated)

**Interfaces:**
- Consumes: `.tmp/triplets.json` from Task 1.
- Produces: table `kpi_triplets (id, kpi_id, triplet_index, objective, task, criterion)` with `UNIQUE (kpi_id, triplet_index)`, SELECT-only RLS.

- [ ] **Step 1: Write the generator**

Model it on `scripts/generate-competency-seed.py`, which prints SQL to stdout and quotes with a `sql_quote` helper. Rows are joined to their KPI through `(competency code, level, kpi_index)`, the natural key the seed already uses:

```python
#!/usr/bin/env python3
"""Generate docs/task-triplets-migration.sql from .tmp/triplets.json.

Do not hand-edit the output. A hand-typed seed is where a wrong KPI link
enters silently, and nothing downstream would notice.
"""
import json
import sys


def sql_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def main():
    triplets = json.load(open(sys.argv[1], encoding="utf-8"))

    by_kpi = {}
    for t in triplets:
        by_kpi.setdefault((t["competency"], t["level"], t["kpi_index"]), []).append(t)

    values = []
    for key in sorted(by_kpi):
        code, level, kpi_index = key
        for n, t in enumerate(by_kpi[key], start=1):
            values.append(
                "  (%s, %d, %d, %d, %s, %s, %s)"
                % (sql_quote(code), level, kpi_index, n,
                   sql_quote(t["objective"]), sql_quote(t["task"]),
                   sql_quote(t["criterion"]))
            )

    print("-- docs/task-triplets-migration.sql")
    print("-- Generated by scripts/generate-triplet-seed.py. Do not hand-edit.")
    print("-- Run AFTER docs/competency-framework-migration.sql. Idempotent.")
    print("--")
    print("-- The Learning Objective -> Task -> Assessment Criterion triplets, the")
    print("-- pedagogical unit the internship content document is built on. Read-only:")
    print("-- an advisor derives tasks from these but never edits them.")
    print()
    print("CREATE TABLE IF NOT EXISTS kpi_triplets (")
    print("  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),")
    print("  kpi_id        UUID NOT NULL REFERENCES competency_kpis(id) ON DELETE CASCADE,")
    print("  triplet_index INT  NOT NULL,")
    print("  objective     TEXT NOT NULL,")
    print("  task          TEXT NOT NULL,")
    print("  criterion     TEXT NOT NULL,")
    print("  UNIQUE (kpi_id, triplet_index)")
    print(");")
    print()
    print("ALTER TABLE kpi_triplets ENABLE ROW LEVEL SECURITY;")
    print()
    print('DROP POLICY IF EXISTS "kpi triplets read" ON kpi_triplets;')
    print('CREATE POLICY "kpi triplets read" ON kpi_triplets')
    print("  FOR SELECT TO authenticated USING (true);")
    print()
    print("INSERT INTO kpi_triplets (kpi_id, triplet_index, objective, task, criterion)")
    print("SELECT k.id, v.triplet_index, v.objective, v.task, v.criterion")
    print("FROM (VALUES")
    print(",\n".join(values))
    print(") AS v(code, level, kpi_index, triplet_index, objective, task, criterion)")
    print("JOIN competencies c ON c.code = v.code")
    print("JOIN competency_kpis k ON k.competency_id = c.id")
    print("  AND k.level = v.level AND k.kpi_index = v.kpi_index")
    print("ON CONFLICT (kpi_id, triplet_index) DO UPDATE SET")
    print("  objective = EXCLUDED.objective,")
    print("  task = EXCLUDED.task,")
    print("  criterion = EXCLUDED.criterion;")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate and count**

```bash
python scripts/generate-triplet-seed.py .tmp/triplets.json > docs/task-triplets-migration.sql
grep -c "^  ('" docs/task-triplets-migration.sql
```

Expected: `478`. Any other number means the generator dropped rows; do not proceed.

- [ ] **Step 3: Check the quoting survived**

```bash
python -c "
src = open('docs/task-triplets-migration.sql', encoding='utf-8').read()
bad = [i+1 for i, l in enumerate(src.split('\n')) if l.count(chr(39)) % 2]
print('lines with unbalanced quotes:', bad or 'none')
print('total quotes:', src.count(chr(39)))
"
```

Expected: `none`. An apostrophe inside a statement that was not doubled would produce an odd count on that line and a syntax error at apply time.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-triplet-seed.py docs/task-triplets-migration.sql
git commit -m "feat: the learning triplets as seeded reference data

478 rows joined to their KPI through the natural key the competency seed
already uses. Read-only, like the framework itself: an advisor derives
tasks from a triplet but never edits one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Assignment tables and their access rules

**Files:**
- Create: `docs/task-assignment-migration.sql`

**Interfaces:**
- Consumes: `internship_groups`, `group_memberships`, `kpi_triplets`, `daily_logs`, `profiles`; helpers `owns_group(UUID)` and `is_member_of_group(UUID)` from `docs/internship-groups-rls-recursion-fix.sql`.
- Produces: tables `group_assignments` and `assignment_submissions`; helper `mentors_a_member_of_group(UUID) RETURNS BOOLEAN`.

- [ ] **Step 1: Write the migration**

```sql
-- docs/task-assignment-migration.sql
-- Run AFTER docs/task-triplets-migration.sql. Idempotent.

-- A mentor belongs to no group, but must read the assignments of the students
-- they supervise in order to evaluate them. SECURITY DEFINER for the same
-- reason every other helper here is: a policy body that reads internship_groups
-- or group_memberships directly re-enters their policies, which is what caused
-- 42P17 on 2026-08-20.
CREATE OR REPLACE FUNCTION mentors_a_member_of_group(p_group_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_memberships m
    JOIN student_profiles sp ON sp.id = m.student_id
    WHERE m.group_id = p_group_id
      AND m.left_at IS NULL
      AND sp.mentor_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION mentors_a_member_of_group(UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS group_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  triplet_id  UUID NOT NULL REFERENCES kpi_triplets(id),
  title       TEXT NOT NULL,
  description TEXT,
  objective   TEXT NOT NULL,
  criterion   TEXT NOT NULL,
  due_date    DATE,
  created_by  UUID NOT NULL REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_assignments_group_idx
  ON group_assignments(group_id);

-- objective and criterion are copied from the triplet rather than joined. If
-- the reference text is corrected next month, approvals granted last month must
-- still mean what they meant when they were granted.

ALTER TABLE group_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignments read" ON group_assignments;
CREATE POLICY "assignments read" ON group_assignments
  FOR SELECT TO authenticated USING (
    owns_group(group_id)
    OR is_member_of_group(group_id)
    OR mentors_a_member_of_group(group_id)
  );

DROP POLICY IF EXISTS "advisor writes assignments" ON group_assignments;
CREATE POLICY "advisor writes assignments" ON group_assignments
  FOR ALL TO authenticated
  USING (owns_group(group_id))
  WITH CHECK (owns_group(group_id));

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES group_assignments(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('submitted','approved','needs_revision')),
  student_note  TEXT,
  mentor_note   TEXT,
  log_id        UUID REFERENCES daily_logs(id) ON DELETE SET NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES profiles(id),
  UNIQUE (assignment_id, student_id)
);

-- There is no 'assigned' status. A row appears on the student's first action,
-- so its absence IS "not started", and the advisor's overview is a LEFT JOIN
-- from the group's members. That also means a student who joins in week eight
-- inherits every earlier assignment, which is deliberate: a visible backlog
-- beats a silent omission.

CREATE INDEX IF NOT EXISTS assignment_submissions_student_idx
  ON assignment_submissions(student_id, status);

ALTER TABLE assignment_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "submissions read" ON assignment_submissions;
CREATE POLICY "submissions read" ON assignment_submissions
  FOR SELECT TO authenticated USING (
    student_id = auth.uid()
    OR is_mentor_of(student_id)
    OR is_group_advisor_of(student_id)
  );

-- No INSERT, UPDATE or DELETE policy. submit_assignment and review_assignment
-- are the only write paths, both SECURITY DEFINER, both taking the actor from
-- auth.uid() rather than a parameter. A mentor's approval writes a KPI
-- observation; a direct write path would make that observation forgeable, which
-- is the same reasoning that left kpi_observations with no INSERT policy.
DROP POLICY IF EXISTS "submissions insert" ON assignment_submissions;
DROP POLICY IF EXISTS "submissions update" ON assignment_submissions;
```

- [ ] **Step 2: Check no policy reads a group table directly**

```bash
grep -n "internship_groups\|group_memberships" docs/task-assignment-migration.sql
```

Expected: hits **only** inside `mentors_a_member_of_group`, never inside a `CREATE POLICY` body. A policy naming either table re-enters its RLS and reintroduces the recursion that took down every authenticated read on 2026-08-20.

- [ ] **Step 3: Commit**

```bash
git add docs/task-assignment-migration.sql
git commit -m "feat: group assignments and per-student submissions

Assignments go to the group and carry copies of the objective and
criterion, so a later correction to the reference text cannot change what
a past approval meant.

Submission rows are created on the student's first action; their absence
is 'not started'. No trigger, no backfill, and a student who joins late
inherits the backlog rather than silently receiving nothing.

No write policy on assignment_submissions at all: the two RPCs are the
only path, because an approval writes a KPI observation and a direct
write would make it forgeable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The RPCs and the approval-to-observation bridge

**Files:**
- Create: `docs/task-assignment-rpcs.sql`

**Interfaces:**
- Consumes: everything from Task 3; `kpi_observations`, `record_kpi_observations`, `group_competency_targets`, `award_xp_internal(UUID, INTEGER, TEXT, UUID)`.
- Produces: `submit_assignment(p_assignment_id UUID, p_note TEXT, p_log_id UUID) RETURNS UUID`; `review_assignment(p_submission_id UUID, p_approved BOOLEAN, p_note TEXT) RETURNS VOID`. Error codes raised: `NOT_AUTHENTICATED`, `ROLE_NOT_ALLOWED`, `ASSIGNMENT_NOT_FOUND`, `SUBMISSION_NOT_FOUND`, `NOT_IN_SCOPE`.

- [ ] **Step 1: Extend `kpi_observations` and harden the tick delete**

```sql
-- docs/task-assignment-rpcs.sql
-- Run AFTER docs/task-assignment-migration.sql. Idempotent.

ALTER TABLE kpi_observations
  ADD COLUMN IF NOT EXISTS assignment_submission_id UUID
    REFERENCES assignment_submissions(id) ON DELETE CASCADE;

-- One observation per approved submission. UNIQUE (kpi_id, log_id, observed_by)
-- treats NULLs as distinct, so two approvals of DIFFERENT tasks for one KPI
-- correctly produce two observations — that is what two independent pieces of
-- evidence means. But re-approving ONE submission would also produce two,
-- manufacturing two observations from a single piece of evidence.
CREATE UNIQUE INDEX IF NOT EXISTS one_observation_per_submission
  ON kpi_observations(assignment_submission_id)
  WHERE assignment_submission_id IS NOT NULL;
```

- [ ] **Step 2: Stop a log re-save from deleting task observations**

`record_kpi_observations` deletes the caller's prior ticks for a log before inserting, matching `o.log_id IS NOT DISTINCT FROM p_log_id`. Task observations survive today only because the app always passes a real log id — incidental, not structural. Replace the whole function (`CREATE OR REPLACE` is enough; the signature is unchanged):

```sql
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

  DELETE FROM kpi_observations o
  WHERE o.student_id = p_student_id
    AND o.log_id IS NOT DISTINCT FROM p_log_id
    AND o.observed_by = auth.uid()
    AND o.assignment_submission_id IS NULL;   -- never a task observation

  INSERT INTO kpi_observations (student_id, kpi_id, log_id, observed_by)
  SELECT p_student_id, kid, p_log_id, auth.uid()
  FROM unnest(coalesce(p_kpi_ids, ARRAY[]::UUID[])) AS kid;
END;
$$;
```

- [ ] **Step 3: `submit_assignment`**

```sql
CREATE OR REPLACE FUNCTION submit_assignment(
  p_assignment_id UUID,
  p_note          TEXT DEFAULT NULL,
  p_log_id        UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_group UUID;
  submission   UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT a.group_id INTO target_group
  FROM group_assignments a WHERE a.id = p_assignment_id;

  IF target_group IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND';
  END IF;

  -- Only an active member of the assignment's group may submit to it.
  IF NOT is_member_of_group(target_group) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  INSERT INTO assignment_submissions
    (assignment_id, student_id, status, student_note, log_id, submitted_at)
  VALUES (p_assignment_id, auth.uid(), 'submitted', p_note, p_log_id, now())
  ON CONFLICT (assignment_id, student_id) DO UPDATE
    SET status = 'submitted',
        student_note = EXCLUDED.student_note,
        log_id = EXCLUDED.log_id,
        submitted_at = now(),
        reviewed_at = NULL,
        reviewed_by = NULL
  RETURNING id INTO submission;

  RETURN submission;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_assignment(UUID, TEXT, UUID) TO authenticated;
```

Resubmitting after a revision request clears `reviewed_at` and `reviewed_by`, so the mentor's queue shows it as waiting again.

- [ ] **Step 4: `review_assignment`, which carries the bridge**

```sql
CREATE OR REPLACE FUNCTION review_assignment(
  p_submission_id UUID,
  p_approved      BOOLEAN,
  p_note          TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  the_student UUID;
  the_kpi     UUID;
  the_group   UUID;
  the_comp    UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT s.student_id, t.kpi_id, a.group_id, k.competency_id
  INTO the_student, the_kpi, the_group, the_comp
  FROM assignment_submissions s
  JOIN group_assignments a ON a.id = s.assignment_id
  JOIN kpi_triplets t      ON t.id = a.triplet_id
  JOIN competency_kpis k   ON k.id = t.kpi_id
  WHERE s.id = p_submission_id;

  IF the_student IS NULL THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_FOUND';
  END IF;

  -- The workplace mentor evaluates. The advisor assigns and watches.
  IF NOT is_mentor_of(the_student) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  -- An observation for a competency outside the group's scope is written but
  -- never reported, because get_competency_progress only returns competencies
  -- with a target row. The student would do the work, be approved, and see
  -- nothing move.
  IF NOT EXISTS (
    SELECT 1 FROM group_competency_targets gt
    WHERE gt.group_id = the_group AND gt.competency_id = the_comp
  ) THEN
    RAISE EXCEPTION 'NOT_IN_SCOPE';
  END IF;

  UPDATE assignment_submissions s
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'needs_revision' END,
      mentor_note = p_note,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  WHERE s.id = p_submission_id;

  IF p_approved THEN
    INSERT INTO kpi_observations
      (student_id, kpi_id, log_id, observed_by, assignment_submission_id)
    VALUES (the_student, the_kpi, NULL, auth.uid(), p_submission_id)
    ON CONFLICT (assignment_submission_id) DO NOTHING;
  ELSE
    -- A withdrawn approval must stop counting. Otherwise the student stays
    -- promoted on evidence that was taken back.
    DELETE FROM kpi_observations o
    WHERE o.assignment_submission_id = p_submission_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION review_assignment(UUID, BOOLEAN, TEXT) TO authenticated;
```

- [ ] **Step 5: XP on approval**

Mirrors the log-approval branch in `docs/gamification-server-side-migration.sql:174-183`, including its guard against paying twice:

```sql
CREATE OR REPLACE FUNCTION award_assignment_xp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved'
     AND OLD.status IS DISTINCT FROM 'approved'
     AND NOT EXISTS (
       SELECT 1 FROM xp_transactions x
       WHERE x.student_id = NEW.student_id
         AND x.reason = 'assignment_approved:' || NEW.id::text
     )
  THEN
    PERFORM award_xp_internal(
      NEW.student_id, 20, 'assignment_approved:' || NEW.id::text, NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_xp ON assignment_submissions;
CREATE TRIGGER trg_assignment_xp
  AFTER UPDATE ON assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION award_assignment_xp();
```

`xp_transactions.log_id` cannot hold a submission id, so the submission is carried in `reason` and that is what makes the duplicate guard work. Twenty XP matches log approval: an approved task is the student's work confirmed by someone else, the same kind of thing.

Note this fires on UPDATE only. `submit_assignment` inserts with status `submitted`, so the first approval is always an UPDATE.

- [ ] **Step 6: Commit**

```bash
git add docs/task-assignment-rpcs.sql
git commit -m "feat: submit, review, and the bridge to KPI observations

A mentor's approval writes one observation for the KPI behind the task,
attributed to the mentor, so planned work and spontaneous behaviour feed
the same two-observation threshold.

Re-approving one submission cannot write a second observation: a partial
unique index caps it at one per submission. Two approvals of DIFFERENT
tasks for one KPI still produce two, which is the point.

Moving an approved submission back to needs_revision deletes the
observation. A withdrawn approval must stop counting.

record_kpi_observations no longer deletes task observations when a log is
re-saved. It never did in practice, but only because the app always
passes a real log id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Types, service layer and error codes

**Files:**
- Create: `src/types/assignment.ts`
- Create: `src/services/assignments.ts`
- Modify: `src/types/index.ts` (barrel export)
- Modify: `src/utils/rpcErrors.ts:6-15`
- Modify: `src/utils/__tests__/rpcErrors.test.ts`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: the RPCs from Task 4; `supabase` from `@/services/supabase`; `RpcError` and the row-mapping style of `src/services/competency.ts`.
- Produces: `assignmentService` with `listTriplets(kpiId)`, `listGroupAssignments(groupId)`, `createAssignment(input)`, `listMyAssignments(studentId)`, `submitAssignment(assignmentId, note, logId)`, `listPendingReviews(mentorId)`, `reviewAssignment(submissionId, approved, note)`.

- [ ] **Step 1: Write the failing test for the new error codes**

In `src/utils/__tests__/rpcErrors.test.ts`, add:

```ts
  it('maps the assignment error codes', () => {
    expect(mapRpcError('ASSIGNMENT_NOT_FOUND').key).toBe('errors.assignmentNotFound');
    expect(mapRpcError('SUBMISSION_NOT_FOUND').key).toBe('errors.submissionNotFound');
    expect(mapRpcError('NOT_IN_SCOPE').key).toBe('errors.notInScope');
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest src/utils/__tests__/rpcErrors.test.ts
```

Expected: FAIL — all three currently map to `errors.unknown`.

- [ ] **Step 3: Add the codes**

In `src/utils/rpcErrors.ts`, extend `ERROR_KEYS`:

```ts
  ASSIGNMENT_NOT_FOUND: 'errors.assignmentNotFound',
  SUBMISSION_NOT_FOUND: 'errors.submissionNotFound',
  NOT_IN_SCOPE: 'errors.notInScope',
```

And add to the `errors` object in `src/i18n/locales/en.json` ONLY:

```
"assignmentNotFound": "That task no longer exists.",
"submissionNotFound": "That submission no longer exists.",
"notInScope": "This competency is not part of the group's scope."
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx jest --silent
```

Expected: 3 suites, 21 tests. This is the one task that changes the count.

- [ ] **Step 5: Write the types**

`src/types/assignment.ts`:

```ts
export interface KpiTriplet {
  id: string;
  kpiId: string;
  tripletIndex: number;
  objective: string;
  task: string;
  criterion: string;
}

export type SubmissionStatus = 'submitted' | 'approved' | 'needs_revision';

export interface GroupAssignment {
  id: string;
  groupId: string;
  tripletId: string;
  title: string;
  description?: string;
  objective: string;
  criterion: string;
  dueDate?: string;
  createdAt: string;
}

export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  status: SubmissionStatus;
  studentNote?: string;
  mentorNote?: string;
  logId?: string;
  submittedAt: string;
  reviewedAt?: string;
}

/** An assignment as one student sees it: the task plus their own state, which
 *  is absent until they act on it. */
export interface MyAssignment extends GroupAssignment {
  submission?: AssignmentSubmission;
}
```

Export it from `src/types/index.ts` following the existing barrel style.

- [ ] **Step 6: Write the service**

`src/services/assignments.ts`, mapping snake_case rows to camelCase exactly as `src/services/competency.ts` does. Column names must match the migrations character for character — a wrong key yields `undefined` at runtime rather than a compile error, and this project has been bitten by that before:

Note the import paths: `src/services/competency.ts` imports its siblings relatively
(`'./supabase'`, `'./rpcError'`) and its types by alias. `RpcError` lives in
`src/services/rpcError.ts`, not in `src/utils/rpcErrors.ts` — that file holds
`mapRpcError`, which is a different thing. Follow the sibling exactly:

```ts
import { supabase } from './supabase';
import { RpcError } from './rpcError';
import type {
  KpiTriplet, GroupAssignment, MyAssignment, AssignmentSubmission,
} from '@/types/assignment';

function toAssignment(r: Record<string, unknown>): GroupAssignment {
  return {
    id: (r.id as string) || '',
    groupId: (r.group_id as string) || '',
    tripletId: (r.triplet_id as string) || '',
    title: (r.title as string) || '',
    description: (r.description as string) || undefined,
    objective: (r.objective as string) || '',
    criterion: (r.criterion as string) || '',
    dueDate: (r.due_date as string) || undefined,
    createdAt: (r.created_at as string) || '',
  };
}

export const assignmentService = {
  async listTriplets(kpiId: string): Promise<KpiTriplet[]> {
    const { data, error } = await supabase
      .from('kpi_triplets')
      .select('id, kpi_id, triplet_index, objective, task, criterion')
      .eq('kpi_id', kpiId)
      .order('triplet_index');
    if (error) throw error;
    return (data || []).map((r: Record<string, unknown>) => ({
      id: (r.id as string) || '',
      kpiId: (r.kpi_id as string) || '',
      tripletIndex: (r.triplet_index as number) ?? 0,
      objective: (r.objective as string) || '',
      task: (r.task as string) || '',
      criterion: (r.criterion as string) || '',
    }));
  },

  async createAssignment(input: {
    groupId: string; tripletId: string; title: string; description?: string;
    objective: string; criterion: string; dueDate?: string; createdBy: string;
  }): Promise<GroupAssignment> {
    const { data, error } = await supabase
      .from('group_assignments')
      .insert({
        group_id: input.groupId,
        triplet_id: input.tripletId,
        title: input.title,
        description: input.description ?? null,
        objective: input.objective,
        criterion: input.criterion,
        due_date: input.dueDate ?? null,
        created_by: input.createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return toAssignment(data as Record<string, unknown>);
  },

  async listGroupAssignments(groupId: string): Promise<GroupAssignment[]> {
    const { data, error } = await supabase
      .from('group_assignments')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => toAssignment(r as Record<string, unknown>));
  },

  async submitAssignment(assignmentId: string, note: string, logId: string | null): Promise<string> {
    const { data, error } = await supabase.rpc('submit_assignment', {
      p_assignment_id: assignmentId,
      p_note: note,
      p_log_id: logId,
    });
    if (error) throw new RpcError(error.message);
    return data as string;
  },

  async reviewAssignment(submissionId: string, approved: boolean, note: string): Promise<void> {
    const { error } = await supabase.rpc('review_assignment', {
      p_submission_id: submissionId,
      p_approved: approved,
      p_note: note,
    });
    if (error) throw new RpcError(error.message);
  },
};
```

The two list functions that join across both tables, in the same file:

```ts
  /** Every assignment for the student's group, with their own submission if
   *  they have acted on it. A student with no submission row has not started;
   *  the absence is the state, so this is a left join, not a filter. */
  async listMyAssignments(groupId: string, studentId: string): Promise<MyAssignment[]> {
    const { data, error } = await supabase
      .from('group_assignments')
      .select('*, assignment_submissions(*)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return (data || []).map((row) => {
      const r = row as Record<string, unknown>;
      const all = Array.isArray(r.assignment_submissions) ? r.assignment_submissions : [];
      // PostgREST returns every submission on the assignment, not just this
      // student's — the RLS policy lets an advisor read them all.
      const mine = (all as Array<Record<string, unknown>>)
        .find((s) => s.student_id === studentId);
      return {
        ...toAssignment(r),
        submission: mine ? toSubmission(mine) : undefined,
      };
    });
  },

  /** Submissions waiting on this mentor. RLS already limits the rows to the
   *  students they supervise, so the status filter is the whole query. */
  async listPendingReviews(): Promise<Array<AssignmentSubmission & { assignment: GroupAssignment }>> {
    const { data, error } = await supabase
      .from('assignment_submissions')
      .select('*, group_assignments(*)')
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: true });
    if (error) throw error;

    return (data || []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        ...toSubmission(r),
        assignment: toAssignment((r.group_assignments || {}) as Record<string, unknown>),
      };
    });
  },
```

with the submission mapper alongside `toAssignment`:

```ts
function toSubmission(r: Record<string, unknown>): AssignmentSubmission {
  return {
    id: (r.id as string) || '',
    assignmentId: (r.assignment_id as string) || '',
    studentId: (r.student_id as string) || '',
    status: (r.status as AssignmentSubmission['status']) || 'submitted',
    studentNote: (r.student_note as string) || undefined,
    mentorNote: (r.mentor_note as string) || undefined,
    logId: (r.log_id as string) || undefined,
    submittedAt: (r.submitted_at as string) || '',
    reviewedAt: (r.reviewed_at as string) || undefined,
  };
}
```

`listPendingReviews` takes no mentor id on purpose: passing one would invite a caller to pass somebody else's, and the policy already scopes the rows to `is_mentor_of(student_id)`. The id would be decoration over a rule the database enforces anyway.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit && npx jest --silent
git add src/types/assignment.ts src/types/index.ts src/services/assignments.ts src/utils/rpcErrors.ts src/utils/__tests__/rpcErrors.test.ts src/i18n/locales/en.json
git commit -m "feat: assignment types, service and error codes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Verification script

**Files:**
- Create: `docs/task-assignment-verification.sql`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing. Two submissions, Part A and Part B.

Follow the shape of `docs/competency-verification.sql`: anonymous `$$` only (a named dollar tag fails `42601` in the Supabase editor), no temp tables (invisible across statements, `42P01`), results accumulated in a text variable handed over through a transaction-local GUC.

- [ ] **Step 1: Part A, schema assertions**

```sql
-- ============================================================
-- PART A — schema assertions
-- Expected: one row, "PASS: schema assertions held".
-- ============================================================

DO $$
DECLARE
  n INT;
BEGIN
  SELECT count(*) INTO n FROM kpi_triplets;
  IF n <> 478 THEN RAISE EXCEPTION 'FAIL: % triplets, expected 478', n; END IF;

  SELECT count(DISTINCT t.kpi_id) INTO n FROM kpi_triplets t;
  IF n <> 48 THEN RAISE EXCEPTION 'FAIL: % KPIs carry triplets, expected 48', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT t.kpi_id FROM kpi_triplets t
    GROUP BY t.kpi_id HAVING count(*) < 8 OR count(*) > 12
  ) AS bad;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % KPIs outside the 8-12 band', n; END IF;

  -- kpi_triplets is reference data and assignment_submissions is RPC-only.
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE tablename IN ('kpi_triplets','assignment_submissions')
               AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: a write policy exists on a read-only or RPC-only table';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE indexname = 'one_observation_per_submission') THEN
    RAISE EXCEPTION 'FAIL: one_observation_per_submission is missing; re-approval would double-count';
  END IF;

  -- The same structural check the recursion fix ends with. These two tables
  -- consult group ownership, membership and the mentor link at once, which is
  -- the shape that produced 42P17.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename IN ('group_assignments','assignment_submissions')
      AND (coalesce(qual, '')       ~ '\minternship_groups\M'
        OR coalesce(qual, '')       ~ '\mgroup_memberships\M'
        OR coalesce(with_check, '') ~ '\minternship_groups\M'
        OR coalesce(with_check, '') ~ '\mgroup_memberships\M')
  ) THEN
    RAISE EXCEPTION 'FAIL: a policy reads a group table directly';
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS result;
```

- [ ] **Step 2: Part B, the rules**

Fixtures need an advisor and a student whose `student_profiles.mentor_id` is set. Report `SKIP` rather than failing when they are absent — "no fixtures" is not the same finding as "the rule is broken". The fixture log is dated 1900 because `daily_logs` carries `UNIQUE(student_id, date)`, and a collision with a real log would surface as a `unique_violation` that reads like a bug in the framework.

```sql
-- ============================================================
-- PART B — the rules. Submit BEGIN..ROLLBACK in one go.
--
--   1 approval        1 observation
--   2 re-approval     still 1 observation
--   3 withdrawal      0 observations
--   4 full level      current_level = 1
--   5 log re-save     task observation survived
--   6 out of scope    rejected NOT_IN_SCOPE
-- ============================================================

BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; men UUID; grp UUID; comp UUID;
  kpi1 UUID; kpi2 UUID; lg UUID;
  asg UUID; sub UUID; n INT; lvl INT; log TEXT := '';
  t RECORD;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT sp.id, sp.mentor_id INTO stu, men
  FROM student_profiles sp
  WHERE sp.mentor_id IS NOT NULL
  LIMIT 1;

  IF adv IS NULL OR stu IS NULL OR men IS NULL THEN
    PERFORM set_config('probe.results',
      '1-6 assignment' || E'\t' || 'SKIP: needs an advisor and a student with a mentor' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name)
  VALUES (adv, 'Probe assignment') RETURNING id INTO grp;

  DELETE FROM group_memberships m WHERE m.student_id = stu;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);

  SELECT c.id INTO comp FROM competencies c ORDER BY c.display_order LIMIT 1;
  SELECT k.id INTO kpi1 FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 1 AND k.kpi_index = 1;
  SELECT k.id INTO kpi2 FROM competency_kpis k
    WHERE k.competency_id = comp AND k.level = 1 AND k.kpi_index = 2;

  -- 1-3 run on a single assignment built from the first triplet of kpi1.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe 1', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi1 ORDER BY tr.triplet_index LIMIT 1
  RETURNING id INTO asg;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  SELECT submit_assignment(asg, 'probe', NULL) INTO sub;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', men)::text, true);
  PERFORM review_assignment(sub, true, 'ok');

  SELECT count(*) INTO n FROM kpi_observations o WHERE o.assignment_submission_id = sub;
  log := log || '1 approval' || E'\t'
      || CASE WHEN n = 1 THEN '1 observation' ELSE 'FAIL: ' || n END || E'\n';

  PERFORM review_assignment(sub, true, 'ok again');
  SELECT count(*) INTO n FROM kpi_observations o WHERE o.assignment_submission_id = sub;
  log := log || '2 re-approval' || E'\t'
      || CASE WHEN n = 1 THEN 'still 1 observation' ELSE 'FAIL: ' || n END || E'\n';

  PERFORM review_assignment(sub, false, 'redo');
  SELECT count(*) INTO n FROM kpi_observations o WHERE o.assignment_submission_id = sub;
  log := log || '3 withdrawal' || E'\t'
      || CASE WHEN n = 0 THEN '0 observations' ELSE 'FAIL: ' || n END || E'\n';

  -- 4. A level needs BOTH its KPIs demonstrated twice, so reaching level 1
  --    through tasks alone takes four approved assignments: two triplets from
  --    each of the level's two KPIs.
  DELETE FROM kpi_observations o WHERE o.student_id = stu;
  FOR t IN
    SELECT tr.id, tr.objective, tr.criterion
    FROM kpi_triplets tr WHERE tr.kpi_id IN (kpi1, kpi2)
    ORDER BY tr.kpi_id, tr.triplet_index
  LOOP
    CONTINUE WHEN (SELECT count(*) FROM group_assignments a
                   WHERE a.group_id = grp AND a.triplet_id = t.id) > 0;
    EXIT WHEN (SELECT count(*) FROM kpi_observations o
               WHERE o.student_id = stu AND o.assignment_submission_id IS NOT NULL) >= 4;

    INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
    VALUES (grp, t.id, 'Probe level', t.objective, t.criterion, adv) RETURNING id INTO asg;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
    SELECT submit_assignment(asg, 'probe', NULL) INTO sub;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', men)::text, true);
    PERFORM review_assignment(sub, true, 'ok');
  END LOOP;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  SELECT p.current_level INTO lvl
  FROM get_competency_progress(stu) AS p WHERE p.competency_id = comp;
  log := log || '4 full level' || E'\t'
      || CASE WHEN lvl = 1 THEN 'current_level = 1'
              ELSE 'FAIL: current_level = ' || coalesce(lvl, -1) END || E'\n';

  -- 5. Saving a daily log must not sweep away task observations. This is the
  --    only thing asserting the `assignment_submission_id IS NULL` clause in
  --    record_kpi_observations; without it that clause could be deleted and
  --    nothing would fail.
  INSERT INTO daily_logs (student_id, date, title, content)
  VALUES (stu, DATE '1900-01-01', 'Probe log', 'Probe log') RETURNING id INTO lg;
  PERFORM record_kpi_observations(stu, lg, ARRAY[kpi1]);
  SELECT count(*) INTO n FROM kpi_observations o
  WHERE o.student_id = stu AND o.assignment_submission_id IS NOT NULL;
  log := log || '5 log re-save' || E'\t'
      || CASE WHEN n >= 4 THEN 'task observation survived'
              ELSE 'FAIL: only ' || n || ' task observations left' END || E'\n';

  -- 6. A competency outside the group's scope must be refused at review time,
  --    or the student is approved and nothing moves.
  DELETE FROM group_competency_targets gt
  WHERE gt.group_id = grp AND gt.competency_id = comp;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe scope', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi1 ORDER BY tr.triplet_index DESC LIMIT 1
  RETURNING id INTO asg;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);
  SELECT submit_assignment(asg, 'probe', NULL) INTO sub;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', men)::text, true);
  BEGIN
    PERFORM review_assignment(sub, true, 'ok');
    log := log || '6 out of scope' || E'\t' || 'FAIL: approval accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '6 out of scope' || E'\t'
        || CASE WHEN SQLERRM = 'NOT_IN_SCOPE' THEN 'rejected NOT_IN_SCOPE'
                ELSE 'FAIL (wrong error): ' || SQLERRM END || E'\n';
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

- [ ] **Step 3: Commit**

```bash
git add docs/task-assignment-verification.sql
git commit -m "docs: verification for task assignment

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After this plan

The migrations are applied by hand in this order, each verified before the next:

1. `docs/task-triplets-migration.sql`
2. `docs/task-assignment-migration.sql`
3. `docs/task-assignment-rpcs.sql`

Then Part A and Part B of the verification.

**C1 is not done until Part B passes against the live database.** Every RLS assertion in Part A is structural only — the Supabase SQL editor runs as the table owner and bypasses RLS entirely, which is exactly how a `42P17` recursion hid behind two green verification runs on 2026-08-20. C2's device checklist is what tests the policies.
