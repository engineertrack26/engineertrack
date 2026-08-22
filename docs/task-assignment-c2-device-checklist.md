# Task assignment (C2) — device checklist

Twelve checks that only a real device can settle. `tsc`, Jest and the i18n key sweep
between them cover the type surface and translation parity; none of them can see a
twenty-item picker on a five-inch screen, a criterion buried under a long student note,
or a notification that never arrived.

Run as three accounts: one advisor, one workplace mentor, one student already in that
advisor's group, plus a second student who has never joined a group (for item 11). Work
down in order — later items use the tasks, submissions and reviews earlier items create.
Two tasks carry the run:

- **Task 1** — assigned in item 2, submitted in item 4, approved in item 6, then reused
  in items 9 and 10 as the "assessed" assignment.
- **Task 2** — assigned by repeating item 2 for a second triplet, submitted the same way,
  sent back for revision in item 8 instead of approved.
- A third, throwaway assignment is created in item 10 purely to be withdrawn unused.

## Assigning and receiving

1. **Advisor opens Group Assignments and picks a competency.**
   Expect the competency chips to list only the competencies the advisor's Competency
   Scope screen has switched on for this group — not all six. Pick one, pick a level:
   expect the triplet list to show twenty items (two KPIs at that level, ten triplets
   each), grouped under each KPI's statement. Tapping a triplet fills the title,
   objective and criterion fields from it, editable before saving.

2. **Advisor fills in a due date and taps Assign (Task 1).**
   Expect a confirmation and the new assignment to appear in the list above the picker,
   with a submitted/approved count of 0 / (0) / [group size]. Repeat this step once more
   for a second triplet to create **Task 2** — needed for item 8.

3. **Student opens My Tasks.**
   Expect both Task 1 and Task 2 under **To do**, titled as the advisor set them. A task
   with no submission row has no status to read — this section is everything the student
   has not yet acted on, not a status value called "assigned".

4. **Student opens Task 1, writes a note, toggles on today's log, and submits.**
   Expect the objective and criterion both visible before submitting, a success
   confirmation, and the card to move out of **To do** into **Waiting**. Repeat with a
   note (no need to attach a log) for Task 2.

## Mentor review

5. **Mentor opens Pending Reviews and expands Task 1's card.**
   Expect the student's name, the assignment title, the **criterion** in its own
   highlighted block, the student's note, and — because a log was attached — the linked
   log's title and content, all before the mentor writes anything. The objective is not
   shown here; see "watch for" below for why that is deliberate rather than an omission.

6. **Mentor writes a short review note and taps Approve on Task 1.**
   Expect a success confirmation, the card to leave the pending list, and (on the
   student's side) Task 1 to move from **Waiting** into **Done**.

7. **Student's competency level moves as a result.**
   This needs the level's *other* KPI already satisfied — reaching a level requires two
   independent observations on **both** of its KPIs, which is subsystem B's ladder rule,
   not something this screen changes. Before this check: confirm (or create, via one
   ordinary log review) two observations on the level's other KPI, and one observation
   on Task 1's KPI from a source other than Task 1 itself (a prior log review works).
   Task 1's approval is then that KPI's second observation. Open the student's
   Achievements: expect the competency's current level to read one higher than before,
   proving a task approval feeds the exact same counter a daily-log review does.

8. **Mentor requests a revision on Task 2 instead of approving, and the student
   resubmits.**
   Expect Task 2 to leave the pending list with no error and no forced note. On the
   student's side, expect Task 2 to appear under **Revise**, with the mentor's note
   visible under "Comments" if one was given. Student edits the note and submits again:
   expect it to move back to **Waiting**, and to disappear from **Revise**.

## Editing and withdrawing

9. **Advisor edits Task 1 (now assessed).**
   Expect the title and description fields open for editing, the objective and criterion
   fields **disabled** with a note that assignment terms are locked, and a title-only
   save to succeed. This is `trg_freeze_assessed_assignment` firing once a submission
   exists — editing terms is refused, not silently ignored.

10. **Advisor withdraws an unused assignment, then tries to withdraw Task 1.**
    Create one more throwaway assignment (repeat item 2's flow, no submission against
    it) and withdraw it: expect it to disappear from the list immediately. Then try to
    withdraw Task 1: expect a refusal naming that it has submissions, and the card to
    remain. Same guard, opposite outcome, because only one of the two has a submission
    row.

## Edge cases and notifications

11. **A student in no group opens My Tasks.**
    Using the second student account (never joined a group), expect a plain message —
    not an empty list, not a spinner, not a crash. `listMyAssignments` needs a group id
    to query against; the screen resolves the group first and short-circuits before ever
    calling it.

12. **All the notifications from this run arrive.**
    Confirm, across the accounts already used above:
    - every group member (student included) got a "task assigned" notification after
      item 2 — sent once per assignment, so two arrive from Task 1 and Task 2 combined;
    - the mentor got a "task submitted" notification after each of item 4's two
      submissions;
    - the student got a "task approved" notification after item 6;
    - the student got a "task revision requested" notification after item 8 — a
      **different** notification kind from "approved", not the same one reused. The
      brief for this task called these "three notifications"; the review-response side
      split into two kinds (approved / revision requested) in the commit just before
      this task started, so a full run of this checklist produces four deliveries
      across three kinds of event (assigned, submitted, reviewed-either-way).

## What only a device can settle

- **Whether the twenty-triplet picker (item 1) is usable on a phone screen.** Two KPI
  statements, each followed by ten short rows, in a chip-and-card layout that was never
  tried against a real keyboard-open, one-handed, five-inch viewport.
- **Whether the criterion (item 5) is readable in the mentor's review sheet without
  scrolling past the student's note.** The criterion box is pinned above the note in the
  layout, but a long note or a small screen could still push the criterion off-screen
  before the mentor scrolls down to it, which would invert the order the layout intends.

## Known open items — worth watching, not new work

- **The mentor's review panel shows the criterion but not the objective** (item 5),
  while the student saw both when submitting (item 4). The criterion is what the mentor
  judges against, so nothing is missing from the decision itself — but the mentor has
  less context than the student did, and that is the kind of gap that reads fine in
  review and feels thin with a real card open in your hand.
- **`errors.notInScope` reads "Ask the advisor to review the group's targets."** That is
  correct when a mentor hits it reviewing a submission (`review_assignment`), and odd if
  an advisor ever sees it on their own create path (`createAssignment`, if the group's
  scope changes between opening the picker and tapping Assign) — the message would be
  telling the advisor to ask themselves.
- **Three cross-role i18n uses remain**: `app/(advisor)/group-assignments.tsx` calls
  `t('student.selectDate')` twice, and `app/(student)/my-tasks.tsx` calls
  `t('mentor.comments')` once. `mentor.comments` resolves fine — the text is generic
  enough that reusing it is harmless. `student.selectDate` does not resolve at all in
  `en.json`; both call sites carry an inline `'Select a date'` fallback, so nothing
  breaks, but it is a pre-existing gap (also called this way from
  `app/(student)/internship-form.tsx` since long before this plan) rather than something
  this plan introduced. Worth a follow-up key addition, not a blocker.
