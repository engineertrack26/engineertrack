# Subsystem D3 — the mentor's and advisor's side of the retirement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish retiring the daily log. D2 did the student's side; this does the mentor's and the advisor's — repointing what they read, rewriting the reports around competencies, fixing the tab bars, and deleting the two screens that are left.

**Architecture:** No new tables and no migration. Every query this plan writes reads what already exists: `assignment_submissions` for volume, `get_competency_progress` for attainment, `group_memberships.left_at` for who still counts. The reports become group-scoped through a selector; the mentor's screens swap `daily_logs` for the task path.

**Tech Stack:** Expo SDK 57, React Native, TypeScript, Expo Router, Supabase JS, i18next (`en.json` only).

**Spec:** `docs/superpowers/specs/2026-08-23-daily-log-retirement-design.md` — see especially section 5 and the three settled report decisions recorded under it.

---

## Do not break the work that came after D2

D3's scope was written into the D2 plan **before the assignment-drafts feature existed**. Since then the advisor gained a draft stage, per-task descriptions, document briefs, batch assignment, and inline editing. None of it is D3's to touch, and two collisions are real rather than hypothetical.

**The advisor's assignment screens are off limits.** `app/(advisor)/group-assignments.tsx` and `src/components/cards/AssignmentCard.tsx` carry the picker, the draft tray, the inline title/description editing and the document control. This plan changes the advisor's **tab bar** and **reports**, and nothing else of theirs. If a task seems to need an edit in either file, stop and say so rather than making it.

**A draft is not assigned work.** This is the one that can silently produce wrong numbers. `src/services/advisor.ts` does not read `group_assignments` at all today — the reports are built entirely on `daily_logs`. Task 3 adds the first assignment queries that file has ever had, and every one of them **must filter `published_at IS NOT NULL`**. A draft is preparation the advisor has not sent; counting it as assigned work inflates every figure on the screen and there is no error to notice. The RLS read policy hides drafts from students and mentors but **not from the advisor**, who is the very person reading this report — so the policy will not save you here. The filter has to be in the query.

Also unchanged by this plan: `submit_assignment`, `publish_assignments`, `review_assignment`, the `assignment-docs` bucket and everything in `src/services/evidenceUrls.ts`.

## Global Constraints

- **No migration and no database connection.** Every table, column and RPC this plan needs already exists.
- Only `src/i18n/locales/en.json` among the seven locale files. All user-facing strings through `t()`.
- Every RPC refusal reaches the user through `mapRpcError`, never a raw `err.message`.
- Imports use path aliases (`@/...`), never relative paths out of `src/`.
- **Tab bars end at: mentor 7 visible, advisor 7 visible.** Count them.
- `npx tsc --noEmit` silent; `npx jest --silent` green at **6 suites / 36 tests**, plus whatever Task 2 adds.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` — that exact model name — followed by the `Claude-Session:` line if your tooling adds one.

## File Structure

- **Modify** `src/services/mentor.ts` — the mentor's dashboard and feedback queries (Task 1).
- **Modify** `app/(mentor)/dashboard.tsx`, `app/(mentor)/student-list.tsx`, `app/(mentor)/feedback.tsx` (Task 1).
- **Create** `src/utils/reportMetrics.ts` + `src/utils/__tests__/reportMetrics.test.ts` — the completion arithmetic, tested (Task 2).
- **Modify** `src/services/advisor.ts` — `getReportsData` rebuilt, group-scoped (Task 3).
- **Modify** `app/(advisor)/reports.tsx` — the group selector and the new sections (Task 4).
- **Modify** `app/(mentor)/_layout.tsx`, `app/(advisor)/_layout.tsx` (Task 5).
- **Delete** `app/(mentor)/review-log.tsx`, `app/(advisor)/validation.tsx`, `src/components/competency/KpiChecklist.tsx`; **modify** `src/components/competency/index.ts`, `src/services/competency.ts`, `src/services/advisor.ts` (Task 5).

---

### Task 1: The mentor's screens read tasks, not logs

**Files:**
- Modify: `src/services/mentor.ts`
- Modify: `app/(mentor)/dashboard.tsx`, `app/(mentor)/student-list.tsx`, `app/(mentor)/feedback.tsx`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `assignmentService.listPendingReviews()` (already used by the mentor dashboard), `assignment_submissions`.
- Produces: `mentorService.getDashboardData` returning task-based counts; `getFeedbackHistory` reading `assignment_submissions`.

- [ ] **Step 1: Rebuild `getDashboardData`'s four numbers**

`src/services/mentor.ts:39-95` builds them from `daily_logs` and `mentor_feedbacks`. Map each onto the task path:

| Card | Was | Becomes |
|---|---|---|
| assigned | count of assigned students | unchanged — still `student_profiles` by `mentor_id` |
| pending | `daily_logs` awaiting review | `assignment_submissions` with `status = 'submitted'` |
| reviewed this week | `mentor_feedbacks` in the last 7 days | `assignment_submissions` with `reviewed_at` in the last 7 days |
| average rating | `avg(mentor_feedbacks.rating)` | **there is no equivalent** — see step 2 |

`pendingLogs` becomes the pending submissions the dashboard already fetches separately through `listPendingReviews`. Fetch it **once**: the screen currently calls both `getDashboardData` and `listPendingReviews`, and after this change they would be asking the same question twice and could disagree.

- [ ] **Step 2: Retire the rating card honestly**

`mentor_feedbacks.rating` is a 1–5 star score. The task path has no rating at all — the mentor approves or sends back. There is no number to substitute.

Replace the card with **approval rate**: approved ÷ reviewed, over that mentor's submissions. It answers a question the mentor actually has, and unlike a fabricated average it is derived from data that exists. Add `mentor.approvalRate` to `en.json`.

Do **not** keep the "Avg. Rating" label over a different number. A card whose title no longer matches its contents is worse than a card that changed.

- [ ] **Step 3: `student-list.tsx`**

Line 104 calls `logService.getLogsByStudent(student.id)` for a per-student count. Replace with that student's submission count. Keep whatever the row displays otherwise.

- [ ] **Step 4: `feedback.tsx`**

It reads `mentor_feedbacks` joined to `daily_logs` and renders a star column (`StarDisplay`, `{item.rating}/5`).

Point it at `assignment_submissions` where `reviewed_by = <mentor>` and `mentor_note` is present, showing the task title, the note, and the outcome (approved / sent back) instead of stars.

**The old rows still exist and are still real feedback.** Do not silently drop them and do not render them with an empty star column. Either show them in a clearly-labelled "earlier feedback" group with their rating intact, or leave them out and say in the empty state that older log feedback is not shown here. Choose one, and say in your report which and why — this is the "present the history honestly" the D2 plan carried forward.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npx jest --silent
```

Expected: silent; green at 6 suites / 36 tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/mentor.ts "app/(mentor)/" src/i18n/locales/en.json
git commit -m "feat(d3): the mentor's screens read tasks

Pending and reviewed-this-week come from assignment_submissions. The
rating card becomes approval rate: mentor_feedbacks holds a 1-5 score the
task path has no equivalent for, and a card whose title no longer matches
its number is worse than one that changed.

The dashboard asks for its pending list once rather than twice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The completion arithmetic, as a tested helper

**Files:**
- Create: `src/utils/reportMetrics.ts`
- Test: `src/utils/__tests__/reportMetrics.test.ts`

**Interfaces:**
- Consumes: `CompetencyProgress` from `@/types/competency` (`get_competency_progress` returns `competencyId`, `competencyCode`, `competencyName`, `currentLevel`, `targetLevel`).
- Produces:
  - `competencyCompletion(progress: CompetencyProgress[]): { atTarget: number; targeted: number; percent: number }`
  - `averageCompletion(students: Array<{ percent: number }>): number`

The spec settles that completion is **level reached against target**, not a task count. That arithmetic is the one part of the reports worth testing on its own: it is pure, it is where an off-by-one silently misreports every student, and the screen around it is not unit-testable.

- [ ] **Step 1: Write the failing tests**

```typescript
import { competencyCompletion, averageCompletion } from '@/utils/reportMetrics';

const at = (current: number, target: number) => ({
  competencyId: `c${current}${target}`, competencyCode: 'X', competencyName: 'X',
  currentLevel: current, targetLevel: target,
});

describe('competencyCompletion', () => {
  it('counts a competency at its target as complete', () => {
    expect(competencyCompletion([at(2, 2)])).toEqual({ atTarget: 1, targeted: 1, percent: 100 });
  });

  // Overshooting the target is still complete. A student who reached level 3
  // against a target of 2 has not done 150% of the work -- the target is a
  // floor, and percent must never exceed 100.
  it('treats exceeding the target as complete, not as more than complete', () => {
    expect(competencyCompletion([at(3, 2)])).toEqual({ atTarget: 1, targeted: 1, percent: 100 });
  });

  it('counts a competency below its target as incomplete', () => {
    expect(competencyCompletion([at(1, 2)])).toEqual({ atTarget: 0, targeted: 1, percent: 0 });
  });

  it('rounds a partial result', () => {
    expect(competencyCompletion([at(2, 2), at(1, 2), at(1, 2)]).percent).toBe(33);
  });

  // A group with nothing targeted is 0% done, not NaN and not 100%.
  // get_competency_progress returns only competencies that HAVE a target row,
  // so an empty array means the advisor has set no scope at all.
  it('returns zero for a student with no targeted competencies', () => {
    expect(competencyCompletion([])).toEqual({ atTarget: 0, targeted: 0, percent: 0 });
  });
});

describe('averageCompletion', () => {
  it('averages the students', () => {
    expect(averageCompletion([{ percent: 100 }, { percent: 50 }])).toBe(75);
  });

  it('returns zero for an empty group rather than NaN', () => {
    expect(averageCompletion([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx jest src/utils/__tests__/reportMetrics.test.ts
```

Expected: FAIL — `Cannot find module '@/utils/reportMetrics'`.

- [ ] **Step 3: Write the module**

Both functions guard their empty case explicitly; a bare division produces `NaN`, which renders as "NaN%" on the card rather than failing anywhere a developer would see it.

- [ ] **Step 4: Verify and commit**

```bash
npx jest src/utils/__tests__/reportMetrics.test.ts && npx tsc --noEmit
git add src/utils/reportMetrics.ts src/utils/__tests__/reportMetrics.test.ts
git commit -m "feat(d3): tested completion arithmetic for the reports

Completion is level reached against target, per the spec. Exceeding a
target is complete, not more than complete; an empty target set is 0%,
not NaN -- which would render as NaN% rather than failing anywhere
visible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `getReportsData`, group-scoped

**Files:**
- Modify: `src/services/advisor.ts`
- Modify: `src/types/` as needed for the returned shape

**Interfaces:**
- Consumes: `competencyService.getProgress(studentId)`, `groupService`, `assignment_submissions`, `group_memberships`, `reportMetrics` from Task 2.
- Produces: `advisorService.getReportsData(groupId: string)` — note the parameter change from `advisorId` — returning exactly this shape, which Task 4 renders:

```typescript
export interface CompetencyBreakdown {
  competencyId: string;
  competencyName: string;
  targetLevel: number;
  /** Active students in this group who have reached targetLevel. */
  studentsAtTarget: number;
}

export interface StudentReportRow {
  id: string;
  name: string;
  /** From competencyCompletion(...).percent — level reached against target. */
  completionPercent: number;
  submitted: number;
  approved: number;
}

export interface GroupReportData {
  groupId: string;
  groupName: string;
  studentCount: number;
  /** averageCompletion across studentProgress. */
  averageCompletion: number;
  submitted: number;
  approved: number;
  needsRevision: number;
  competencyBreakdown: CompetencyBreakdown[];
  studentProgress: StudentReportRow[];
}
```

`groupName` is on the payload rather than looked up again by the screen, because Task 4's CSV has to name the group and the two must not be able to disagree about which group the numbers describe.

- [ ] **Step 1: Change what "my students" means**

Today `getAssignedStudents(advisorId)` filters `student_profiles.advisor_id`. That column is a **single value** that `join_group_by_code` overwrites whenever a student joins any of that advisor's groups, so it cannot distinguish two groups, and **it is never cleared when a student leaves**.

Replace it, for the reports only, with the group's active membership:

```
group_memberships where group_id = <the group> and left_at IS NULL
```

Leave `getAssignedStudents` itself alone — `student-monitor.tsx` and others still use it. Add a new query rather than changing that one out from under its other callers.

- [ ] **Step 2: Build the figures**

For the selected group:

- **Students** — count of active memberships.
- **Competency completion** — `getProgress` per student, through `competencyCompletion`, and `averageCompletion` across them. This is the headline the spec settles on.
- **Task volume** — from `assignment_submissions` for those students: submitted, approved, needs-revision.
- **Per student** — name, their completion percent, and their submitted/approved counts.

**Every assignment query filters `published_at IS NOT NULL`.** A draft is preparation the advisor has not sent. The read policy does not hide drafts from the advisor — who is exactly who is reading this screen — so this filter is the only thing separating "assigned" from "being prepared", and getting it wrong inflates every number silently.

- [ ] **Step 3: Delete what the logs fed**

`totalLogs`, `approvedRate` over log statuses, `avgMentorScore` from `mentor_feedbacks`, and the day-based `completionPct` all go. That last one counted distinct submitted log dates against the internship's calendar length — an attendance measure, which is not what this app now claims to measure.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit && npx jest --silent
```

tsc will fail on `reports.tsx` until Task 4 — that is expected and is the same deliberate break D2 used between its service and screen tasks. Record the failing output in your report; do not edit `reports.tsx` here.

---

### Task 4: The reports screen

**Files:**
- Modify: `app/(advisor)/reports.tsx`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `advisorService.getReportsData(groupId)` from Task 3.

- [ ] **Step 1: The group selector**

A row of the advisor's groups at the top; the report is for the selected one. Default to the first group. An advisor with one group sees a single chip and no change in meaning.

When the advisor has **no** groups, say so and render nothing else — do not show a report of zeros, which reads as "your students have done nothing".

- [ ] **Step 2: The sections**

- Four stat cards: students, average completion, submitted, approved.
- **Competency completion** replaces "Log Status Breakdown": for the group, how many students have reached the target level in each targeted competency.
- **Student completion** keeps its shape but its bar is now competency completion, and its subtitle shows submitted/approved rather than log count.

- [ ] **Step 3: The CSV export**

The export at `reports.tsx:106` writes the log-status rows. Rewrite it for the new figures, and put the **group name** in it — an exported file that does not say which group it describes is a trap the moment an advisor exports two.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit && npx jest --silent
```

Expected: **both clean now** — this task closes Task 3's deliberate break. Green at 7 suites / 43 tests (the 36 that existed plus Task 2's seven).

---

### Task 5: The tab bars, and deleting what is left

**Files:**
- Modify: `app/(mentor)/_layout.tsx`, `app/(advisor)/_layout.tsx`
- Delete: `app/(mentor)/review-log.tsx`, `app/(advisor)/validation.tsx`, `src/components/competency/KpiChecklist.tsx`
- Modify: `src/components/competency/index.ts`, `src/services/competency.ts`, `src/services/advisor.ts`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: Fix the inversion**

Both bars still show the retiring screen and hide the new one — the same inversion D2 fixed for the student.

**Mentor:** `review-log` out; `pending-reviews` promoted to a visible tab in its place, titled "Review". Ends at 7 visible.

**Advisor:** `validation` out. `group-assignments` and `group-competencies` are reached from `groups.tsx` and stay `href: null` — they are per-group screens and need a group id, so they cannot be top-level tabs. Ends at 7 visible; if removing `validation` leaves 6, say so in your report rather than inventing a tab to fill it.

- [ ] **Step 2: Delete the two screens**

```bash
git rm "app/(mentor)/review-log.tsx" "app/(advisor)/validation.tsx"
```

Expo Router is file-based: a file under `app/` is a route whether or not it appears in the tab bar. Left on disk they stay reachable by deep link and still function, because `daily_logs` still exists — and `validation.tsx` in particular would let an advisor keep validating logs in a model where the mentor's approval is final. Git is the archive.

- [ ] **Step 3: Delete what loses its last caller**

`review-log.tsx` was the last caller of `KpiChecklist` and of `competencyService.recordObservations` — the mentor's free KPI ticking, which decision 8 retired because every observation should be born from a criterion. Delete both, and the `KpiChecklist` export in `src/components/competency/index.ts`.

**Leave the `record_kpi_observations` RPC in the database.** Dropping a `SECURITY DEFINER` function that the observation guard is written around is a database change with no benefit, and this plan applies no SQL.

`validation.tsx` was the last caller of `advisorService.validateLog`; delete that too.

- [ ] **Step 4: Grep for dangling references**

```bash
grep -rn "review-log\|validation\|KpiChecklist\|recordObservations\|validateLog" app/ src/
```

Distinguish real navigation targets — which crash on tap — from comments and from the unrelated word "validation". Fix every real one. Report what you found.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit && npx jest --silent
```

Deleting two screens totalling 2,453 lines is exactly the change most likely to leave a dangling import somewhere else, so a silent tsc is meaningful evidence here.

---

### Task 6: Walk it on a device

**Files:** none.

No SQL to apply — this plan adds none. Straight to the device.

- [ ] **Step 1: The mentor**

1. Tab bar shows **Review**, not "Review Log". Seven tabs.
2. Dashboard: pending and reviewed-this-week reflect tasks. The rating card is gone, replaced by approval rate.
3. Feedback screen shows task feedback. If older log feedback is retained, it is clearly marked as older; if not, the empty state says so.
4. Student list shows task counts.

- [ ] **Step 2: The advisor**

5. Tab bar has no Validation. Seven tabs, or six with the count reported.
6. Reports: a group selector at the top. **Switch groups and confirm every number changes** — that is the whole point of the change, and a selector that does not re-query is indistinguishable from one that does until you look.
7. **Create a draft and do not send it. It must not appear anywhere in the reports.** The single most important check in this walk: the advisor can see their own drafts, so nothing but the query's filter keeps them out of the figures.
8. A student who left the group is not counted.
9. Export the CSV: it names the group.

- [ ] **Step 3: Confirm nothing earlier broke**

10. The advisor's assignment screen still works end to end: pick, add to draft, edit the title inline, attach a document, send. This plan did not touch it — step 10 is how you know that is true rather than assumed.

---

## Risks

- **The draft filter is the highest-consequence line in this plan**, and it fails silently. The advisor sees their own drafts by policy, so a missing `published_at IS NOT NULL` inflates every figure with work nobody has been assigned, and nothing errors. Device step 7 is the only check that catches it.
- **Task 3 deliberately leaves `npx tsc --noEmit` failing** until Task 4. Anyone treating a red build as a blocker will stall.
- **`mentor_feedbacks` rows outlive their screen.** Whatever Task 1 step 4 chooses, the choice must be visible to the mentor rather than inferred from an empty column.
- **Deleting `validation.tsx` removes a workflow some advisor may still be using.** It has been non-functional in the new model since the mentor's approval became final, but this is the commit that makes that irreversible from the app.
