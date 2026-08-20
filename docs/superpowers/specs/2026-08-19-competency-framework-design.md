# The competency framework: from a hardcoded list to the project's own model

**Date:** 2026-08-19
**Status:** approved, ready for planning
**Scope:** subsystem B of three (see "What this spec is not")
**Source:** `INTERNSHIP-CONTENT-DRAFT.pdf`, 80 pages, supplied by the project team

## Why

Two things are wrong today, and they are the same thing seen from two sides.

The app assesses students against eight competencies on a five-level rubric,
hardcoded in `src/utils/constants.ts`:

```
technical_skills, problem_solving, communication, teamwork,
time_management, adaptability, initiative, professional_ethics
```

The project has since produced an **Engineering Internship Competency
Framework**, described in the source document as "the pedagogical foundation of
the EngineerTrack platform" and "developed through a rigorous research-based
process… informed by data collected from multiple stakeholder groups, including
engineering students, faculty members, and industry representatives, through
surveys and semi-structured interviews conducted across the project partner
countries."

That framework has **six** competencies on **four** levels, and the two sets do
not agree. The framework has `Digital Tool Proficiency` and `Technical
Documentation`, which the app lacks; the app has `time_management`,
`adaptability` and `initiative`, which the framework does not carry. So every
rating the app has recorded so far — `self_assessments.competency_ratings` and
`mentor_feedbacks.competency_ratings`, both JSONB keyed on the old eight — is
keyed to a model the project replaced.

The framework wins. The hardcoded eight were never research-based, and the
document is explicit about what the app is supposed to be built on.

## What this spec is not

Subsystem **B** of three.

| | Subsystem | Status |
|---|---|---|
| **A** | Advisor-owned internship groups replacing the admin/institution model | done, applied live |
| **B** | The competency framework, group scoping, and assessment against it | **this spec** |
| **C** | The 480 learning triplets as missions | its own spec; data now extractable (see below) |

### Why B stops at the KPIs

The framework is not just six names. Each competency has four levels, each level
has two KPIs, and **each KPI expands into ten triplets** of *Learning Objective →
Task/Responsibility → Assessment Criterion*. That is 6 × 4 × 2 × 10 = **480
triplets**, and the document says what C should do with them: "Learning
objectives become achievable missions, workplace tasks become real-world
challenges, assessment criteria support instant feedback and progress tracking."

B stops before that because turning 480 triplets into missions is a subsystem of
its own, not because the data is unavailable. **It is available.**

An earlier draft of this spec claimed the triplets could not be extracted from
the PDF. That was wrong, and the correction matters enough to record: the first
attempt used the raw text layer and then `pdfplumber`, and both fail badly here —
raw text runs the objective and task together in the numbered sections and
interleaves all three columns in the unnumbered ones, while `pdfplumber`, across
four different `table_settings`, shreds each cell into one row per visual line
(a 10-triplet page came back as 22 fragments averaging 24 characters).

The document's tables are **ruled**, and camelot's `lattice` flavour reads ruled
tables. It returns whole cells — 74 / 153 / 138 characters where `pdfplumber`
gave 24 — at 99.4% reported accuracy. `scripts/extract-internship-content.py`
does this and yields **48 KPIs and 478 triplets**, with every structural
assertion passing: exactly 8 KPIs per competency, exactly 12 per level, none
unlabelled, no stunted task or criterion.

Two details are worth carrying forward to C:

- **478, not 480.** Two triplets are unaccounted for. The gap is small and
  bounded, and closing it is a reconciliation pass per KPI, not a rewrite.
- **A triplet whose text crosses a page break arrives as two rows** and must be
  rejoined. The rule is deliberately narrow — the previous objective does not end
  in a period *and* the next row is on a different page. A looser rule was tried
  and collapsed 499 rows into 160, gluing one objective into 16857 characters.

**The Word or Excel source is still worth asking the team for**, but as a
cross-check rather than a blocker: 478 machine-extracted triplets are far easier
to diff against an authoritative file than to hand-verify from a PDF.

## The framework as data

```sql
CREATE TABLE competencies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  display_order INT  NOT NULL
);

CREATE TABLE competency_kpis (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_id UUID NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
  level         INT  NOT NULL CHECK (level BETWEEN 1 AND 4),
  kpi_index     INT  NOT NULL CHECK (kpi_index IN (1, 2)),
  statement     TEXT NOT NULL,
  UNIQUE (competency_id, level, kpi_index)
);
```

The six competencies, in document order: Engineering Problem Solving, Technical
Documentation, Professional Communication, Digital Tool Proficiency,
Responsibility & Ethics, Collaboration & Teamwork. The document states they are
non-hierarchical — "all six competencies are considered equally important and
complementary" — so `display_order` is presentation only and carries no meaning.

**No levels table.** A level is an integer property of a KPI. In the framework a
level has no identity of its own, only its two KPIs.

`UNIQUE (competency_id, level, kpi_index)` makes the shape unfalsifiable: 6 × 4 ×
2 = 48 rows, and no other count is physically insertable.

**Both tables are read-only reference data.** No write path; RLS grants SELECT to
`authenticated` and nothing else. The framework is a project deliverable — an
advisor does not edit it, only chooses which part of it applies.

**These tables live in the database rather than in `constants.ts`** because C's
480 triplets attach to KPIs as a child table, and a constants file cannot carry
them or be joined against. The cost is a 48-row seed, generated rather than
typed.

## The group's scope

```sql
CREATE TABLE group_competency_targets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  competency_id UUID NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
  target_level  INT  NOT NULL CHECK (target_level BETWEEN 1 AND 4),
  UNIQUE (group_id, competency_id)
);
```

This implements what the document asks for: "For shorter internships, selected
learning objective–task–assessment triplets may be used, focusing on essential
competencies. Longer internships can incorporate additional competencies, higher
proficiency levels, or more advanced tasks."

**The row's existence is the selection.** A competency applies to the group if it
has a row. There is no `enabled` flag, which makes "not selected but targeting
level 3" unrepresentable rather than merely discouraged.

RLS mirrors `internship_groups`: the group's advisor writes, its members read.

### The default

An advisor who never opens this screen must not leave their students with an
empty framework. Creating a group therefore seeds all six competencies at
**target level 2**, and the advisor narrows from there. Defaulting to all six
matches the document's own position that they are equally important.

**Level 2 is the one arbitrary number in this design.** L1 is described as
beginners needing close supervision and L4 as leadership behaviour; L2 looks
reasonable for a typical internship, but that is a guess and the team should
confirm it. It is a single constant.

## Observation and progression

```sql
CREATE TABLE kpi_observations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kpi_id      UUID NOT NULL REFERENCES competency_kpis(id) ON DELETE CASCADE,
  log_id      UUID REFERENCES daily_logs(id) ON DELETE SET NULL,
  observed_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kpi_id, log_id, observed_by)
);
```

The `UNIQUE` stops the same person ticking the same KPI twice on the same log,
which would otherwise let a level be inflated by re-saving one log.

### Why ticking, not scoring

The framework's levels are a development ladder, not a rating scale — "the
natural development of engineering students from beginners requiring close
supervision to interns capable of working independently and demonstrating
leadership behaviours." Asking "what level are you today" on every daily log
would empty that ladder of meaning.

So the daily act is observation: the mentor ticks the KPIs they actually saw.
Levels are derived from the accumulation. This also matches the document's own
description of the gamified target — "competency development is visualized
through levels, achievements, badges."

### Self-assessment stays, but does not promote

The student ticks the same KPI list on their own log, and the advisor's
validation screen compares the two sets. That comparison already exists in the
app for the numeric ratings and is worth keeping — it becomes more legible, not
less: "the student believes they demonstrated this, the mentor did not see it"
is a conversation, where "the student said 4 and the mentor said 3" is not.

**Only observations by someone other than the student count toward a level.**
Otherwise a student promotes themselves. This needs no extra column: a
self-observation is exactly one where `observed_by = student_id`.

### The rules

- A KPI is **demonstrated** when it has at least **two** observations from
  someone other than the student. One observation can be a one-off; two separate
  occasions are evidence of a behaviour. The `UNIQUE (kpi_id, log_id,
  observed_by)` constraint makes "separate occasions" literal: the same mentor
  reaching two counts as ticking the same KPI on two different logs, which is the
  ordinary path. A mentor and an advisor both ticking one log also counts as
  two — different observers, same occasion — and that is accepted rather than
  guarded against, since two supervisors independently seeing the behaviour is
  not weaker evidence than one seeing it twice.
- A level is **reached** when both its KPIs are demonstrated **and every lower
  level is reached.** L3 is not reachable by skipping L2 — the framework's claim
  to be a natural progression is enforced rather than assumed.

**Two is the other tunable constant**, alongside the default target level.

**Levels are computed on read, not stored.** A denormalized column would go stale
whenever an observation is added or removed; the computation is cheap.

### What this replaces

`self_assessments.competency_ratings` and `mentor_feedbacks.competency_ratings`
are dropped. Both tables survive — they still carry `reflection_notes`, `rating`,
`comments`, `is_approved` — only the old eight-competency scoring goes.
`COMPETENCIES` and `COMPETENCY_RUBRIC` are deleted from
`src/utils/constants.ts`.

### Deliberately out of scope

**Gamification is not wired to levels in this subsystem.** Levelling up should
plausibly earn XP, a badge and a notification, and the document asks for exactly
that — but the existing gamification runs in database triggers on `daily_logs`,
and reaching into it materially enlarges B. B computes the level correctly and
shows it; rewarding it is separate work.

## Screens

### Which KPIs are shown

The naive answer — every KPI up to the group's target — is 24 checkboxes at level
2, on every daily log. Unusable.

Instead each competency contributes only the two KPIs of the student's **working
level**: the lowest level not yet reached. At most 12, shrinking as the student
progresses, and a competency that has hit the group's target drops off the list
entirely. This is also the pedagogically correct question — the mentor marks what
the student demonstrated at the rung they are on, not L4 behaviours they have not
reached.

A **"show all levels"** expander reveals everything up to the group target, for
the case where a student demonstrates something early.

### Files

| Screen | Change |
|---|---|
| `app/(mentor)/review-log.tsx` | the eight 1-5 sliders become a KPI checklist |
| `app/(student)/create-log.tsx` | the self-assessment block becomes the same checklist |
| `app/(advisor)/validation.tsx` | comparison becomes set difference, not score difference |
| `app/(student)/achievements.tsx` | competency progress: current level / target per competency |
| `app/(advisor)/group-competencies.tsx` | **new** — the six toggles and their level pickers |

The student also sees the group's selected competencies and targets read-only.
The existing `groups.tsx` → `student-monitor` route is untouched; the new screen
is reached from a second action on the group card.

### Service

One new service, `src/services/competency.ts`:

- `listFramework()` — the six competencies and 48 KPIs
- `getGroupTargets(groupId)` / `setGroupTargets(groupId, targets)`
- `getWorkingKpis(studentId)` — what to show, filtered by group and progress
- `recordObservations(studentId, logId, kpiIds)`
- `getProgress(studentId)` — current and target level per competency

`getWorkingKpis` and `getProgress` are RPCs. Both join group targets, observation
counts and the level chain; doing that in the client would be slow and would
depend on RLS exposing more than it should.

## Testing

### Jest

Nothing new. The level derivation lives in SQL, and keeping a second copy in
TypeScript would create two sources of truth. The existing 20 tests must stay
green; `codes`, `consent` and `rpcErrors` are untouched by this work.

### Seed generation

The 48 rows are generated from the PDF, not typed, and the generator carries its
own assertions — the same checks already run against this document: exactly 48
KPIs, exactly 8 per competency, exactly 12 per level, no row missing a competency
or level label. It fails loudly rather than emitting a short seed.
`UNIQUE (competency_id, level, kpi_index)` is the second net.

### Database

| # | Scenario | Expected |
|---|---|---|
| 1 | Framework seeded | 6 competencies, 48 KPIs, 8 per competency, 12 per level |
| 2 | A new group is created | 6 targets, all at level 2 |
| 3 | Both L1 KPIs of a competency observed twice each, by the mentor | level 1 |
| 4 | The same observations, but made by the student themselves | **level 0** |
| 5 | Both L2 KPIs demonstrated, L1 not | **level 0**, not level 2 |
| 6 | The same KPI ticked twice on one log by one person | `unique_violation` |

**Rows 4 and 5 are the ones that cannot be skipped.** Both fail silently if the
rule is wrong: 4 lets students promote themselves with nothing on screen looking
broken, and 5 collapses the framework's progression claim while the system
continues to appear functional.

### On device

A mentor ticks KPIs on a log; the student ticks their own on the same log; the
advisor sees the difference on the validation screen; a second log carrying the
same KPIs raises the student's level; the new level appears on achievements.

## Order of work

Two migrations — the framework tables and their seed, then targets and
observations — followed by removing the old eight-competency model from
`constants.ts` and moving the four screens onto the new list. Deletion goes last,
as in subsystem A, so no task leaves the tree non-compiling.
