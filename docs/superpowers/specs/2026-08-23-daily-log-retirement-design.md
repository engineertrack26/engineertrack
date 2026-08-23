# Subsystem D — retiring the daily log

Date: 2026-08-23. Branch `feature/competency-framework`.

## Why

The app was built around a daily log: one row per student per day, five prose
fields, photos, documents, mentor feedback, advisor validation, XP and a
consecutive-day streak. Subsystems B and C then built a different spine — a
competency framework of 6 competencies x 4 levels x 2 KPIs, and 480
objective/task/criterion triplets that a student demonstrates one task at a
time, assessed against a criterion.

Both spines are now live and they do not agree. The record that carries
assessment is the task submission; the record the app puts in front of the
student is the daily log. Every role shows the same inversion: the retiring
screen is a visible tab and the new model's screen is hidden behind
`href: null`.

| Role | Visible tab (retiring) | `href: null` (the new model) |
|---|---|---|
| Student | `create-log` | `my-tasks` |
| Mentor | `review-log` | `pending-reviews` |
| Advisor | `validation` | `group-assignments`, `group-competencies` |

D removes the daily log from every flow, moves what it carried onto the task
record, and leaves its tables in place.

## Settled decisions

From the model review that preceded this spec:

1. Triplet text is immutable. Adaptation happens by selection, not by rewriting.
2. The student selects which of the ten tasks fits their workplace.
3. The advisor sets competencies, levels, a timeframe, and a minimum number of
   tasks per KPI.
4. The record attaches to a task with evidence, not to a day.
5. Self-assessment is a measurement instrument, so the student's free KPI
   ticking goes.

Decided while designing D:

6. **Reflection belongs to the task.** The daily log is removed entirely rather
   than kept as an optional non-daily reflection. One record type.
7. **The advisor's validation step goes.** The mentor's approval is final — the
   mentor is the one in the workplace. This matches what task review already
   does; the advisor monitors and reports but does not gate assessment.
8. **The mentor's free KPI observation goes.** Every observation is born from a
   criterion. A free tick has neither criterion nor evidence behind it, and the
   framework is built on "transparent and measurable evidence". The gap it
   filled also narrowed once the student can choose among ten tasks per KPI.
9. **The database is retired, not deleted.** Tables, rows and storage stay.
   Screen files do not — see "Retirement" below.

## Out of scope

- **The student's catalogue pick (decision 2) is not built.** `assignments.ts`
  has no path for it; the student sees only `group_assignments` the advisor
  created. D does not add it and does not block it: when it arrives, the
  student's pick creates its own assignment row rather than bypassing
  `assignment_submissions`, so nothing in this spec changes.
- **Self-assessment as an instrument (decision 5).** `self_assessments` hangs
  off `daily_logs` and goes dormant here — D removes the per-log
  self-assessment flow and writes nothing to the table. The periodic
  start/end-of-internship instrument is separate work.

Both belong to a later subsystem E.

---

## 1. The student's flow

| Today | After D |
|---|---|
| `create-log` — visible tab | file deleted |
| `log-history` — visible tab | `href: null`, read-only archive |
| `my-tasks` — hidden | **Tasks** tab, next to the dashboard |

There is no separate task-history screen. `my-tasks` already groups by state —
to do / waiting for review / needs revision / approved — and that listing is the
history.

Old logs stay readable: the `log-history` route survives, reachable from the
dashboard, with its "new log" affordance removed. The student tab bar goes from
8 to 7.

## 2. The task record's shape

`assignment_submissions` carries one prose field today, `student_note`. The
daily log carried five (`title`, `content`, `activities_performed`,
`skills_learned`, `challenges_faced`) and that bloat is part of what did not
fit. The task record gets two:

- **`student_note`** (exists) — UI label *"What I did"*. The account of the work
  against this task. No title field: the advisor already wrote the task's title.
- **`reflection`** (new `TEXT`) — *"What I learned"*. This is where the
  reflection removed with the daily log lands. **Required** at the app layer and
  in the RPC: made optional it would go empty, and the reason for removing the
  daily log would evaporate with it.

`challenges_faced` gets no field of its own; it belongs inside the reflection.
Three fields would repeat the five-field mistake at a smaller scale.

```sql
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS reflection TEXT;
```

The column stays **nullable**. Existing submissions genuinely have no
reflection, and a `NOT NULL DEFAULT ''` would satisfy the constraint while
meaning nothing. The requirement is enforced where it can actually be checked:
`submit_assignment` raises when `btrim(p_reflection)` is empty — whitespace is
not a reflection, and a client-side check alone would be bypassable.

`log_id` stays on the table and stops being written. `submit_assignment` no
longer accepts it and the mentor's "linked log" panel is removed.

## 3. Evidence

Photos and documents move onto the submission by giving the existing tables a
second possible owner. The upload service, the picker components and both
storage buckets are reused unchanged.

```sql
ALTER TABLE log_photos ALTER COLUMN log_id DROP NOT NULL;
ALTER TABLE log_photos ADD COLUMN IF NOT EXISTS submission_id UUID
  REFERENCES assignment_submissions(id) ON DELETE CASCADE;
ALTER TABLE log_photos ADD CONSTRAINT log_photos_one_owner
  CHECK (num_nonnulls(log_id, submission_id) = 1);
CREATE INDEX IF NOT EXISTS idx_log_photos_submission ON log_photos(submission_id);
```

The same three steps for `log_documents`. Existing rows have `log_id` set and
`submission_id` null, so they already satisfy the CHECK — no backfill.

**Storage needs no change at all.** Both bucket policies key on
`(storage.foldername(name))[1] = auth.uid()::text`; they never mention logs.

### Policies

Each of the six table policies gains a second branch:

```sql
EXISTS (SELECT 1 FROM assignment_submissions s WHERE s.id = submission_id)
```

A policy subquery is evaluated under the referenced table's own RLS — the
behaviour that produced `42P17` earlier on this branch. Here it works in our
favour: the rule reads "you can see the evidence if you can see the submission",
with no duplicated role logic. There is no recursion, because
`assignment_submissions`' policies never look at `log_photos` or
`log_documents`.

INSERT and DELETE additionally require `s.student_id = auth.uid()` and a status
other than `approved`.

### Ordering: no draft state

The log flow created a `draft` row, attached evidence to it, then submitted.
`assignment_submissions` has no draft state — `submit_assignment` inserts
directly as `submitted`. Three ways to close the gap were considered:

- add a `draft` status — a new state machine touching the review queue and RLS;
- submit first and attach after — leaves a window where the mentor sees an
  evidence-less submission;
- **upload to the bucket client-side, pass the URIs into `submit_assignment`,
  and let the RPC write the rows.**

The third is chosen: no new state, no evidence-less window, and the RPC is
already `SECURITY DEFINER`. On a resubmission the RPC **deletes that
submission's evidence and rewrites it** from what the client sent, because the
client holds the full list. The pattern is taken from the delete-then-insert
guard in `record_kpi_observations`.

### Signature change

`submit_assignment(UUID, TEXT, UUID)` becomes
`submit_assignment(p_assignment_id UUID, p_note TEXT, p_reflection TEXT,
p_photos JSONB, p_documents JSONB)`.

The old signature must be dropped explicitly:

```sql
DROP FUNCTION IF EXISTS submit_assignment(UUID, TEXT, UUID);
```

`CREATE OR REPLACE` alone would leave both as overloads, and PostgREST resolves
overloads by the argument names a caller sends — an ambiguity that would surface
as an intermittent failure rather than an error at deploy time. The drop is not
optional and must run before the create.

## 4. Gamification

The task path awards one thing today: 20 XP on approval. The daily log's other
four sources have no equivalent.

| Source | Daily log | Task |
|---|---|---|
| Submit | `daily_log_submit` 10 XP | `assignment_submitted:<id>` 10 XP |
| Photos | 3 x up to 5 | same, `assignment_photo:<id>` |
| Approval | 20 XP | already built |
| Self-assessment | 5 XP | **dropped** — reflection is required now, and a bonus earned on every submission is not a bonus |
| First record | `first_log` badge | new `first_task` badge |

### Where the awards live

Submit XP, photo XP, the `first_task` badge and the streak go **inside
`submit_assignment`**, after the evidence rows are written. Approval XP stays in
the `award_assignment_xp` trigger.

This split is not stylistic. A trigger on `assignment_submissions` fires when
the submission row is written, which is *before* the RPC inserts the evidence —
a photo count read from the trigger is always zero. Putting the submit-side
awards after the evidence write in the same function is what makes the count
correct.

Doing it in the RPC is safe because the RPC is the only way a submission row can
exist: `assignment_submissions` has no write policy at all, so RLS forbids
direct inserts and only `SECURITY DEFINER` functions can write.

Duplicate protection is the submission id inside `reason`. The id is stable
across resubmissions (the RPC upserts), so a resubmit cannot earn submit XP
twice — the same mechanism the log version used.

### The weekly streak

The streak counts consecutive **ISO weeks containing at least one submission**,
replacing consecutive days.

The streak moves **only on a first submission**, gated by the same
`assignment_submitted:<id>` guard that protects the submit XP. Without that gate
a student could resubmit an old task in a quiet week and keep a streak alive
without doing new work.

```
v_week      := date_trunc('week', now())::date
v_prev_week := MAX(date_trunc('week', s.submitted_at)::date)
                 FROM assignment_submissions s
                WHERE s.student_id = <student> AND s.id <> <this submission>

IF    v_prev_week = v_week      THEN leave the streak alone
ELSIF v_prev_week = v_week - 7  THEN streak := current_streak + 1
ELSE                                 streak := 1
```

A null `v_prev_week` — the student's first ever submission — falls to the last
branch and yields 1, which is right.

The first branch is the one that matters. A second task in the same week must
not increment. Under the daily version `UNIQUE(student_id, date)` made this
impossible by construction; here it has to be written, and it has to be tested.

Thresholds drop from 7 and 30 days to **4 and 8 weeks**. The badge ids
`streak_7` and `streak_30` are kept and only their display text changes ("4
weeks running", "8 weeks running"). Changing the ids would orphan badge rows
students already hold; the cost of keeping them is that an existing holder's
badge now reads as something else.

## 5. Retirement and affected surfaces

Three screens retire completely — 3,747 lines:

- `app/(student)/create-log.tsx` (1,294)
- `app/(mentor)/review-log.tsx` (1,308)
- `app/(advisor)/validation.tsx` (1,145)

**The files are deleted, not left in place.** Expo Router is file-based: a file
under `app/` is a route whether or not it appears in the tab bar. Left on disk
these stay reachable by deep link and still functional, because their tables
still exist — a student could write a log that earns the old XP and appears
nowhere in the new model. Git is the archive:
`git show <sha>:"app/(student)/create-log.tsx"`. "Retire the infrastructure"
means the database, and the database is untouched.

`advisorService.validateLog` and the mentor's `mentor_feedbacks` write path go
with them.

Decisions 5 and 8 land here too, and they need no work of their own. Free KPI
ticking has exactly four call sites: `review-log.tsx:311` (the mentor's tick,
decision 8) and `create-log.tsx:339,359,443` (the student's own, decision 5).
Both screens are deleted, so both mechanisms go with them.

That leaves `competencyService.recordObservations` and the `KpiChecklist`
component with no callers. Both are deleted. The `record_kpi_observations` RPC
is **left in place and unreferenced**: dropping a `SECURITY DEFINER` function
that the observation guard is written around is a database change with no
benefit, and the tables it writes stay.

Five surfaces do not retire; their data source changes:

| Surface | Reads today | New source |
|---|---|---|
| Student dashboard | `getLogsByStudent`, `getLogByDate`, `daily_logs` realtime | task counts by state, `assignment_submissions` realtime |
| Mentor student-list | per-student log count | per-student task count |
| Mentor feedback | `mentor_feedbacks` join `daily_logs` | `assignment_submissions.mentor_note` |
| Advisor dashboard | `daily_logs` realtime | `assignment_submissions` realtime |
| **Advisor reports** | 7+ `daily_logs` queries in `advisor.ts` | task and competency progress |

The advisor's reports are the largest single piece of this. They are built
entirely on daily logs, and reporting is one of the advisor's four documented
duties — left alone they would show zeros for every new student.

`src/services/logs.ts` stays: the read paths still serve the `log-history`
archive.

## 6. Verification

Three assertions must be capable of failing. This branch has produced four
assertions that could not, and each was caught only because someone was asked to
verify a specific claim rather than read the code.

1. **The new evidence policy branch**, evaluated with
   `SET LOCAL ROLE authenticated` as a real student and a real mentor. A script
   run as table owner bypasses RLS and proves only that a policy exists, never
   that it can be evaluated — the lesson of `42P17`.
2. **The weekly streak**, with a case that submits two tasks in the same week
   and asserts the streak did **not** increment. Free under the daily version;
   silently broken here if untested.
3. **The CHECK constraint**, as two separate cases: a row with both owners set,
   and a row with neither. Writing only one leaves half the constraint untried.

On device, the mentor notification from the C2 checklist — still unverified —
closes in this round, since rebuilding the task form goes through that path.

## 7. Split

**D1 — data layer.** Schema (dual-owner evidence tables, `reflection`),
`submit_assignment`'s new signature with evidence and delete-then-rewrite,
gamification (submit and photo XP, `first_task`, the weekly streak), and the
verification script.

**D2 — screens.** The task form, three tab bars, two dashboards, student-list,
feedback, the advisor's reports, and the retirement of the three screens.

If D2 proves too large during planning, the reports split off as D3 — but not
before, because the reports and the dashboard counters share their queries.

## 8. Risks

- **The reports rewrite is the least specified part of D.** What an advisor
  needs from a task-based report is not the same shape as a log count, and this
  spec does not settle it. D2's plan must settle it before any code.
- **Dropping the old `submit_assignment` signature is a live-database change on
  a function the app already calls.** Deploy order matters: the SQL and the
  client change land together, or the client breaks.
- **`mentor_feedbacks` becomes unreachable** while its rows remain. The mentor's
  feedback screen must show the archive honestly rather than appear empty.
