# Review and approval move to the advisor — 2026-09-24

**Status:** approved by the owner on 2026-09-24, on the project owners' request.
**Amends:** `2026-08-20-task-assignment-design.md`, whose rule "the workplace
mentor evaluates, mentor approval is final" this design replaces. That document
stays as the record of what was built; this one governs from here.

## Why

The advisor draws the task from the competency framework and assigns it, so the
owners want the same person to judge whether it was done. In practice the
simulation also showed the cost of the old rule: a slow mentor (Emre Aksoy) left
a submission pending until the advisor tried to close the internship, and a
student whose mentor has not linked yet had nobody to review them at all.

**The trade-off, stated once so it is on the record:** a KPI observation was
evidence written by someone who watched the work at the workplace. With the
advisor as the only assessor it becomes a judgement of the submitted evidence —
the photo, the document and the reflection. The competency rule still holds
(two observations per KPI from someone other than the student), but what an
observation *means* is narrower. The owners have chosen this knowingly.

## Decisions

1. **Only the advisor reviews.** The mentor cannot approve or request a
   revision any more.
2. **The mentor keeps seeing the work.** Their queue and review screen go away;
   through the student list they still read submissions, evidence and the
   advisor's decision, so they can talk about it at the workplace. This needs no
   policy change: `assignment_submissions` already admits `is_mentor_of`.
3. **The mentor keeps attendance.** `internship_review` (the working-day
   confirmation) and messaging stay exactly as they are.
4. **History is left alone.** The simulation's 24 mentor approvals and their KPI
   observations stay valid: the rule has always been "someone other than the
   student", and that is still true of a mentor.

## Server

New file `docs/review-by-advisor.sql`, which becomes the **home** of
`submit_assignment` and `review_assignment` (they live in
`docs/internship-closure-guards.sql` today; that file gets the note, the way it
took them from `docs/task-assignment-rpcs.sql`). Re-running the old file would
put the mentor gate back, so the note has to be explicit.

- `review_assignment`: the role gate becomes `is_group_advisor_of(the_student)`
  instead of `is_mentor_of(the_student)`; the refusal stays `ROLE_NOT_ALLOWED`.
  Everything else is unchanged — the closure guard, `ALREADY_APPROVED` on a
  second approval, the KPI observation, the in-transaction notification to the
  student. Only the notification's wording changes, from the mentor's name to
  the advisor's.
- `submit_assignment`: the "Task Submitted" notification goes to the **group's
  advisor** rather than `student_profiles.mentor_id`. A student with no mentor
  linked is no longer a silent dead end.
- Unchanged: the `assignment_submissions` read policy (mentor stays a reader),
  the absence of any write policy, `kpi_observations`, `internship_review`.
- Column names `mentor_note`, `mentor_level` and the RPC
  `competency_self_vs_mentor` keep their names — renaming them would touch
  every reader for no behavioural gain. They now hold the advisor's decision;
  the UI copy says so.

## Client

- `app/(mentor)/pending-reviews.tsx` and `app/(mentor)/review-detail.tsx` move
  to `app/(advisor)/`. The components behind them (`ReviewUI`,
  `ReviewNoteSheet`, `ReviewEvidence`, `AssignmentReview`, `mentorReviewStore`)
  are reused as they are; only the route, the tab and the store's owner change.
- The advisor's queue is multi-group, so it gets the group chip the messages
  screen already uses.
- **Advisor dashboard**: gains the "next review" featured card the mentor home
  had — student, task, competency, how long it has waited, and "Review".
- **Mentor dashboard**: the featured card becomes the attendance one (days
  waiting for confirmation); the review queue tab goes.
- **Student**: "Mentor's note" becomes "Advisor's note" in the task detail, and
  the self-vs-mentor comparison is relabelled to the advisor. Turkish and
  English; the other five locales fall back.
- `routeForNotification`: `task_submitted` opens the advisor's queue.

## Verification

`docs/review-by-advisor-verification.sql`, results as result sets:

- **A** structural: both functions exist, `SECURITY DEFINER` with a fixed
  `search_path`, callable by `authenticated`, not by `anon`.
- **B** behaviour, as simulation actors, inside `BEGIN .. ROLLBACK`: the
  advisor can approve; **the mentor is now refused with `ROLE_NOT_ALLOWED`**; a
  submission notifies the advisor and not the mentor; a closed internship still
  refuses; a second approval still raises `ALREADY_APPROVED`; an approval still
  writes its KPI observation.
- **C** policies under `SET LOCAL ROLE authenticated`: the mentor still reads
  the submission, and still cannot write it.

Jest: the route and label tests that name the mentor's queue are updated.

## Out of scope

The mentor's remaining job is attendance confirmation, messaging and read-only
follow-up. Whether they should be given more (a workplace note on the
submission, for instance) is a product question the owners have not answered
yet; the door is left open by keeping the mentor's read access.
