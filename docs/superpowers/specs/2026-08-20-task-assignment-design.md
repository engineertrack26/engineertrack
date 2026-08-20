# Subsystem C — Task assignment and the learning triplets

Date: 2026-08-20
Status: approved for planning
Depends on: subsystem B (competency framework), complete and verified 2026-08-20

## Why

The internship content document defines the project's pedagogical unit, and it is
not the KPI:

> Öğrenme Hedefi → Görev/Sorumluluk → Değerlendirme Kriterleri

Each of the 48 KPIs expands into roughly ten of these triplets — 478 in total.
The document calls the chain "yapıcı uyum": the learning objective states what the
student should acquire, the task is the real workplace activity that develops it,
and the criterion is the transparent, measurable evidence that it happened.

Subsystem B built the measurement half of this. The app can say *"this student is
at level 2 in Technical Documentation."* It cannot say *"this task was assigned,
it serves this objective, and it will be judged by this criterion."* There is no
task concept anywhere: none of the 27 tables is an assignment, and the 478
triplets exist only as `.tmp/triplets.json`, which is gitignored.

Subsystem C builds that half.

## Decisions taken

| Question | Decision |
|---|---|
| Fidelity to the document's KPI → triplet hierarchy | Full. Every triplet links to its KPI. |
| Relationship to the existing tick mechanism | Task approval **produces** a KPI observation. Free ticking on the daily log stays, for unplanned behaviour. Both feed the same two-observation threshold. |
| Assignment target | To the group, with per-student state. The Classroom model. |
| Who evaluates a submission | The workplace mentor. The observation is attributed to them. |
| How to obtain the KPI↔triplet mapping | Re-extract from the PDF with position anchoring, verify by sampling. |
| Assignable unit | The **task**, created from a triplet which stays referenced. Not the triplet itself. |

The last one deserves its reasoning recorded. The document insists the content
adapts to different workplaces and different internship durations. A fixed
sentence cannot do that — the same triplet does not read the same way on a
construction site and in a software office. If the advisor cannot adjust the
wording, they will either not assign the task or tell the student verbally what
to actually do; both are escapes from the system, and neither leaves a record.

## 1. Reference data: the triplets and their KPI link

### Schema

```sql
CREATE TABLE IF NOT EXISTS kpi_triplets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id        UUID NOT NULL REFERENCES competency_kpis(id) ON DELETE CASCADE,
  triplet_index INT  NOT NULL,
  objective     TEXT NOT NULL,
  task          TEXT NOT NULL,
  criterion     TEXT NOT NULL,
  UNIQUE (kpi_id, triplet_index)
);
```

Read-only, exactly like `competencies` and `competency_kpis`: a SELECT policy for
`authenticated` and no write policy at all. This is a project deliverable. An
advisor derives tasks from it; nobody edits it from the app.

### Extraction

`scripts/extract-internship-content.py` is rewritten. Today it reads KPI headings
from the text layer with pypdf and triplets from the tables with camelot, keeping
only a page number for the latter, so the two cannot be joined — which is why the
mapping does not exist.

The fix is simpler than page geometry, and was found by probing rather than
assumed. **The KPI heading is itself a row inside the triplet table.** A section's
table reads:

```
row 0   L1
row 1   KPI1: Identifies key communication channels (meetings, email)...
row 2   LEARNING OBJECTIVES | TASKS AND RESPONSIBILITIES | SKILL ASSESSMENT CRITERIA
row 3+  the triplets
```

So a triplet belongs to the KPI heading in its own table. Verified across the
document: 48 heading rows, each in its own table, 48 distinct tables, and 499 raw
triplet rows that merge to 478 once rows split across a page break are rejoined.

No page coordinates, no ambiguous pages, no boundary to resolve by hand. Walk the
tables in `(page, order)` sequence and attach each triplet row to the heading row
above it in the same table.

The competency name is not in the table — only the level and the KPI index are.
It comes from `kpis.json`, which already holds the 48 KPIs in document order. The
Nth table carrying a heading is the Nth KPI. That assumption is not taken on
faith: the heading row's statement text is matched against the corresponding
entry's statement, and a mismatch fails the run. This turns the ordering
assumption into a per-KPI proof of alignment.

### Verification

A boundary error is silent. A triplet attached to the wrong KPI leaves no gap and
raises nothing — just a plausible sentence in the wrong place. So the check
targets the *shape* of that failure rather than its symptom:

- all 478 assigned, none orphaned
- each of the 48 KPIs has at least one triplet
- **every KPI holds between 8 and 12 triplets, and the run fails otherwise.**
  The document says ten each; 478 across 48 averages 9.96. When a boundary slips,
  one KPI takes about twenty and its neighbour takes none, so a band this tight
  catches exactly that and tolerates the small genuine variation. Any KPI not
  holding exactly ten is additionally listed for the human pass — within the band
  it is not a failure, but it is where a missing triplet would hide.
- no triplet is assigned to a KPI whose position follows it

Then a human step: one random triplet per KPI, printed with its assignment, for
comparison against the PDF. Forty-eight samples, one sitting.

Output is a generated migration, `docs/task-triplets-migration.sql`, 478 rows,
not hand-edited — same discipline as the competency seed.

### Sequencing

**This section is a precondition for everything else and must be finished and
verified alone.** If the mapping is wrong, every screen built on it counts the
wrong task toward the wrong competency, and nothing surfaces that as an error.

## 2. Assignment schema

```sql
CREATE TABLE IF NOT EXISTS group_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  triplet_id  UUID NOT NULL REFERENCES kpi_triplets(id),
  title       TEXT NOT NULL,
  description TEXT,
  objective   TEXT NOT NULL,   -- copied from the triplet at creation
  criterion   TEXT NOT NULL,   -- copied from the triplet at creation
  due_date    DATE,
  created_by  UUID NOT NULL REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
```

`objective` and `criterion` are copied rather than joined. If the reference text
is corrected next month, approvals granted last month must still mean what they
meant when they were granted.

`triplet_id` is NOT NULL. Every task traces to a triplet and therefore to a KPI,
which is the only thing that lets an approval produce an observation. An advisor
who wants to set work outside the framework already has a path — the free ticking
on the daily log — but that is not a task and does not enter the submit/approve
cycle.

### No pre-created rows

Submission rows are created on the student's first action. Their absence means
"not started", and the advisor's overview is a `LEFT JOIN` from group members.

This differs deliberately from subsystem B, where a trigger seeded
`group_competency_targets` on group creation — there, the row's existence *was*
the scope. Here there is nothing to seed, no trigger, and no backfill problem for
a student who joins later.

The consequence, stated plainly: a student who joins in week eight sees every
assignment made before they arrived. The alternative is to freeze each assignment
against the membership at its creation, which means a student joining on day two
silently receives nothing and somebody has to notice. **A visible backlog beats a
silent omission** — the advisor can see it and narrow the scope; nobody can see
the omission.

### Access

Two rules, both learned the hard way on 2026-08-20.

**Every policy goes through a `SECURITY DEFINER` helper.** These tables must
consult group ownership, group membership and the mentor link at once, which is
precisely the shape that produced `42P17` — `internship_groups` and
`group_memberships` had read policies that queried each other, and every
authenticated read of either failed. `owns_group` and `is_member_of_group` already
exist; a third is needed for "this mentor supervises some member of this group".

**`assignment_submissions` gets no write policy at all.** Submitting and reviewing
go through two `SECURITY DEFINER` RPCs, `submit_assignment` and
`review_assignment`, each taking the actor from `auth.uid()` rather than a
parameter. A mentor's approval writes a KPI observation, and a direct write path
would make that observation forgeable — the same reasoning that left
`kpi_observations` with no INSERT policy in subsystem B.

## 3. The bridge from approval to observation

When a mentor approves a submission, an observation is recorded for the KPI behind
the assignment's triplet, attributed to the mentor. Four collisions with
subsystem B's rules have to be handled.

### Provenance

`kpi_observations` gains `assignment_submission_id UUID REFERENCES
assignment_submissions(id) ON DELETE CASCADE`, nullable. A tick from a daily log
has `log_id` set and this null; a task observation has the reverse.

`record_kpi_observations` deletes the caller's prior ticks for a log before
inserting, matching on `o.log_id IS NOT DISTINCT FROM p_log_id`. Task
observations survive today only because the app always passes a real log id —
which is incidental, not structural. Add `AND o.assignment_submission_id IS NULL`
to that delete so the protection does not depend on the caller's good manners.

### Uniqueness

`UNIQUE (kpi_id, log_id, observed_by)` treats NULLs as distinct, so one mentor
approving two different tasks for the same KPI produces two observations. **That
is correct and intended** — two independent pieces of evidence is exactly what the
rule asks for.

But re-approving one submission would also produce two rows, manufacturing two
observations from a single piece of evidence. A partial unique index on
`assignment_submission_id` (where not null) caps it at one observation per
submission, so re-approval is idempotent. This is the sibling of subsystem B's
"the same observer cannot tick the same KPI twice on one log".

### Withdrawal

If a mentor moves an approved submission back to `needs_revision`, the observation
is **deleted** in the same transaction. Otherwise a withdrawn approval keeps
counting and a student is promoted on evidence that was taken back.

### Scope

An advisor may only create assignments from competencies in the group's scope.
Otherwise the observation is written but `get_competency_progress`, which reports
only competencies with a target row, never shows it: the student does the work,
receives approval, nothing moves, and nobody can explain why. Enforced twice — a
filter in the UI and a validation in the RPC.

### Consequence

After this bridge exists, a level can be completed by two task approvals, by two
log ticks, or by one of each. All three feed the same threshold. This is
deliberate: the document counts planned learning and spontaneous workplace
behaviour alike.

## 4. Screens

Tab bars are full — 8 visible for the student, 7 each for mentor and advisor. No
new tabs. Each screen is registered with `href: null` and reached from an existing
one, the pattern subsystem B used for the competency scope screen.

**Advisor — Assignments.** Reached from a group on the Groups screen. Existing
assignments with per-student submitted/approved counts, then creation: an in-scope
competency → a level → its two KPIs → their triplets → pick one → title, objective
and criterion arrive prefilled and editable → optional due date → assign. The
scope rule from section 3 lives here as a filter: out-of-scope competencies never
appear.

**Student — My Tasks.** Reached from the dashboard. Grouped by status. Opening a
task shows the objective, the task and **the criterion** — not a choice, but the
document's explicit requirement that criteria make expectations clear to student
and mentor alike. Submitting takes a note and optionally links the daily log where
the work was done.

**Mentor — Pending reviews.** Reached from the dashboard. Task text, criterion,
the student's note and any linked log side by side; approve or request revision,
note optional. Approval produces the observation from section 3.

**Unchanged:** the daily log's KPI checklist stays exactly as built. It is the
path for behaviour that was never assigned.

**XP:** task approval awards XP, server-side by trigger, like the existing log
approval. The distinction from subsystem B holds — ticking earned no XP because a
tick is a claim, while an approved task is the student's work confirmed by someone
else, the same kind of thing as an approved log.

## Decomposition

This is larger than subsystem B. It splits in two, each with its own plan:

**C1 — Reference data and schema.** The rewritten extractor, its verification, the
seed migration, both tables, the RLS helpers and policies, the two RPCs, the
observation bridge, the XP trigger. Verifiable end to end without any screen.

**C2 — The three screens.** Advisor assignment, student tasks, mentor review.

C1 must be proven before C2 starts. Subsystem B's lesson stands: building screens
on an unverified foundation spreads a single fault across two layers, and the
device pass then cannot tell you which layer is wrong.

## Verification

Following the pattern that worked for subsystem B:

- **Part A**, schema assertions: 478 triplets, every KPI covered, the distribution
  band, no write policy on `kpi_triplets` or `assignment_submissions`.
- **Part B**, the rules, inside a transaction that rolls back: an approval writes
  exactly one observation; re-approval writes no second one; withdrawal removes
  it; two approvals of different tasks for one KPI reach level 1; a log re-save
  does not delete a task observation; an out-of-scope assignment is refused.
- **A device checklist**, because the SQL editor runs as the table owner and
  bypasses RLS entirely. Every RLS assertion written in a verification script is
  structural only — it proves a policy exists, never that it can be evaluated.
  That blind spot is what hid `42P17` behind two green verification runs.

## Risks and open items

- **The extraction is the whole foundation.** A quarter of the KPI statements were
  silently truncated by the first version of this extractor and nothing downstream
  noticed. The distribution band and the 48-sample human pass are the answer, and
  they are not optional.
- **478, not 480.** Either two triplets are missing from the extraction or the
  document genuinely has 478. This cannot be settled from the PDF alone; the
  structured source from the project team would settle it. Worth requesting in
  parallel even though the decision was to proceed from the PDF.
- **`join_group_by_code` sets `student_profiles.advisor_id` with an UPDATE that
  silently affects zero rows** if the student has not completed the internship
  form. The dashboard gate forces the form first, so the order holds today by
  accident rather than by construction. The advisor's screens should key on group
  membership instead. Not part of C, but C adds more advisor screens that would
  inherit the same assumption.
- **The daily log's burden is a content question for the project team.** Five
  prose fields plus a reflection box, one with a 50-character minimum, every day.
  "Skills learned" now duplicates the KPI ticks in prose, and "activities
  performed" is the field C turns into assigned tasks. If the log stops being
  written, nothing the framework measures accumulates.
