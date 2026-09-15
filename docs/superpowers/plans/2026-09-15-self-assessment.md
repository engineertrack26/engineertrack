# Self-Assessment and Mentor Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The student rates each task submission on the four-step supervision scale, the mentor rates it on approval, and student / mentor / advisor see the gap per competency — without touching how competency levels are earned.

**Architecture:** Two nullable `SMALLINT` columns on `assignment_submissions`; `submit_assignment` and `review_assignment` gain one trailing parameter each (old overloads dropped so nothing bypasses the rule); one new SECURITY DEFINER RPC aggregates the gap per competency for the student, their mentor or their advisor; the stream's read RPC is asserted not to project the ratings. Client: a segmented control on the student's task form, the same control on the mentor's review screen, two bars on the growth screen, a gap column + CSV section in the advisor's report.

**Tech Stack:** Expo SDK 57 / RN 0.86 / TS 6 / Supabase (Postgres, RLS, SECURITY DEFINER RPCs) / i18next / jest.

**Spec:** `docs/superpowers/specs/2026-09-15-self-assessment-design.md`

## Global Constraints

- SQL applied by the owner in the Supabase SQL editor, one file per submission: `docs/self-assessment-migration.sql`, then `docs/self-assessment-verification.sql` Parts A / B / C separately. Anonymous `$$` only; `grep -o '\$\$' <file> | wc -l` even; idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP FUNCTION IF EXISTS`).
- The scale is `0 observed · 1 heavy support · 2 partial support · 3 independent`; CHECK `BETWEEN 0 AND 3` on both columns.
- `submit_assignment` refuses `SELF_LEVEL_REQUIRED`; `review_assignment` refuses `LEVEL_REQUIRED` on approval only; `competency_self_vs_mentor` refuses `SELF_ASSESSMENT_FORBIDDEN`. Codes mapped in `src/utils/rpcErrors.ts`, English copy in `en.json` `errors.*`.
- **The observation rule is untouched**: approval still writes the `kpi_observations` row exactly as today; the rating never gates it (spec decision 3).
- `list_feed_posts` is not edited; Part A asserts `pg_get_functiondef` of it contains neither `self_level` nor `mentor_level`.
- Comparison row shape: `{ competencyId, code, name, tasks, avgSelf, avgMentor, gap, overRated, underRated }`; averages rounded to one decimal; `gap = avgMentor − avgSelf`; only approved submissions with both ratings count.
- Shared working tree with a parallel Codex session: stage by explicit path only; never `git add -A`/`.`, stash, checkout, reset; `git status --porcelain <file>` before editing each file and STOP with BLOCKED if it is already modified. Locale: `en.json` and `tr.json` for new keys (a Codex parity test requires `tr` for some sections; add both), no other locale; `t(key, 'Default')` everywhere.
- `noUnusedLocals`/`noUnusedParameters`; path aliases; `mapRpcError` for refusals; no bare `catch {}`; `LoadFailedBanner` on failed loads; request counters where a screen already uses them.
- Gates per task: `npx tsc --noEmit` silent; `npx jest --silent` green (baseline 48 suites / 409 tests).
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` (+ the session line the tooling adds).

---

## File Structure

**SQL (create)**
- `docs/self-assessment-migration.sql` — columns, `submit_assignment` (6 args), `review_assignment` (4 args), old overloads dropped, `competency_self_vs_mentor`.
- `docs/self-assessment-verification.sql` — Parts A / B / C.
- Modify (one header line each): `docs/daily-log-retirement-rpcs.sql`, `docs/task-assignment-rpcs.sql` — "superseded by docs/self-assessment-migration.sql for submit_assignment / review_assignment".

**Client**
- Modify: `src/types/assignment.ts`, `src/services/assignments.ts`, `src/services/competency.ts`, `src/types/competency.ts`, `src/utils/rpcErrors.ts`, `src/utils/taskDrafts.ts`, `src/i18n/locales/en.json`, `src/i18n/locales/tr.json`.
- Create: `src/utils/selfAssessment.ts` + `src/utils/__tests__/selfAssessment.test.ts`, `src/components/common/LevelPicker.tsx`.
- Modify (student): `app/(student)/task-detail.tsx`, `app/(student)/achievements.tsx`, `src/services/studentGrowthView.ts`.
- Modify (mentor, Codex-owned — Task 4 checks cleanliness first): `app/(mentor)/review-detail.tsx`, `src/services/mentorReviews.ts`.
- Modify (advisor): `src/services/advisor.ts`, `src/types/report.ts`, `src/utils/advisorReportView.ts` (+ test), `app/(advisor)/reports.tsx`.

---

### Task 1: SQL — columns, RPC overloads, comparison RPC, verification

**Files:**
- Create: `docs/self-assessment-migration.sql`, `docs/self-assessment-verification.sql`
- Modify: `docs/daily-log-retirement-rpcs.sql` (line 1 note), `docs/task-assignment-rpcs.sql` (line 1 note)

**Interfaces:**
- Produces: `assignment_submissions.self_level`, `.mentor_level`; `submit_assignment(p_assignment_id UUID, p_note TEXT, p_reflection TEXT, p_photos JSONB, p_documents JSONB, p_self_level SMALLINT DEFAULT NULL) RETURNS UUID`; `review_assignment(p_submission_id UUID, p_approved BOOLEAN, p_note TEXT DEFAULT NULL, p_level SMALLINT DEFAULT NULL) RETURNS VOID`; `competency_self_vs_mentor(p_student_id UUID) RETURNS SETOF JSONB`.

- [ ] **Step 1: Migration file** — header, then:

```sql
-- ---- columns ----
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS self_level SMALLINT;
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS mentor_level SMALLINT;
ALTER TABLE assignment_submissions DROP CONSTRAINT IF EXISTS assignment_submissions_self_level_range;
ALTER TABLE assignment_submissions ADD CONSTRAINT assignment_submissions_self_level_range CHECK (self_level IS NULL OR self_level BETWEEN 0 AND 3);
ALTER TABLE assignment_submissions DROP CONSTRAINT IF EXISTS assignment_submissions_mentor_level_range;
ALTER TABLE assignment_submissions ADD CONSTRAINT assignment_submissions_mentor_level_range CHECK (mentor_level IS NULL OR mentor_level BETWEEN 0 AND 3);
```

Then **`submit_assignment` (6 args)**: copy the CURRENT definition verbatim from `docs/daily-log-retirement-rpcs.sql` (from `CREATE OR REPLACE FUNCTION submit_assignment(` through its closing `$$;`) and make exactly these edits:
1. Signature: add a sixth parameter `p_self_level SMALLINT DEFAULT NULL` after `p_documents`.
2. Immediately after the `REFLECTION_REQUIRED` guard add:
   ```sql
   -- The student's own rating on the supervision scale (spec decision 1). Required.
   IF p_self_level IS NULL OR p_self_level NOT BETWEEN 0 AND 3 THEN
     RAISE EXCEPTION 'SELF_LEVEL_REQUIRED';
   END IF;
   ```
3. The INSERT column list gains `self_level` and the VALUES gain `p_self_level` (after `reflection`); the `DO UPDATE SET` gains `self_level = EXCLUDED.self_level,` and **also** `mentor_level = NULL,` (a resubmission invalidates the previous mentor rating; the status reset already does the same for the review).
4. After the function: `DROP FUNCTION IF EXISTS submit_assignment(UUID, TEXT, TEXT, JSONB, JSONB);` and `GRANT EXECUTE ON FUNCTION submit_assignment(UUID, TEXT, TEXT, JSONB, JSONB, SMALLINT) TO authenticated;`.

Then **`review_assignment` (4 args)**: copy the CURRENT definition verbatim from `docs/task-assignment-rpcs.sql` and edit:
1. Signature: add `p_level SMALLINT DEFAULT NULL` after `p_note`.
2. Inside the existing `IF p_approved THEN … END IF;` guard block (the one with `STUDENT_LEFT_GROUP` / `NOT_IN_SCOPE`), as its FIRST statement:
   ```sql
   -- The mentor's rating on the same scale (spec decision 2). Required on approval,
   -- meaningless on a revision request. It never gates the observation below.
   IF p_level IS NULL OR p_level NOT BETWEEN 0 AND 3 THEN
     RAISE EXCEPTION 'LEVEL_REQUIRED';
   END IF;
   ```
3. The `UPDATE assignment_submissions s SET …` gains `mentor_level = CASE WHEN p_approved THEN p_level ELSE NULL END,`.
4. After the function: `DROP FUNCTION IF EXISTS review_assignment(UUID, BOOLEAN, TEXT);` and `GRANT EXECUTE ON FUNCTION review_assignment(UUID, BOOLEAN, TEXT, SMALLINT) TO authenticated;`.

Then the comparison RPC:

```sql
-- ---- competency_self_vs_mentor ----
-- The gap between what the student thought and what the mentor saw, per
-- competency. Readable by the student, their mentor, and the advisor of a
-- group they are an active member of. Approved submissions with both
-- ratings only (legacy rows have NULLs and are ignored).
CREATE OR REPLACE FUNCTION competency_self_vs_mentor(p_student_id UUID)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (p_student_id = auth.uid() OR is_mentor_of(p_student_id)
          OR EXISTS (SELECT 1 FROM group_memberships m JOIN internship_groups g ON g.id = m.group_id
                     WHERE m.student_id = p_student_id AND m.left_at IS NULL AND g.advisor_id = auth.uid())) THEN
    RAISE EXCEPTION 'SELF_ASSESSMENT_FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'competencyId', c.id, 'code', c.code, 'name', c.name,
    'tasks', count(*),
    'avgSelf', round(avg(s.self_level)::numeric, 1),
    'avgMentor', round(avg(s.mentor_level)::numeric, 1),
    'gap', round((avg(s.mentor_level) - avg(s.self_level))::numeric, 1),
    'overRated', count(*) FILTER (WHERE s.self_level > s.mentor_level),
    'underRated', count(*) FILTER (WHERE s.self_level < s.mentor_level))
  FROM assignment_submissions s
  JOIN group_assignments a ON a.id = s.assignment_id
  JOIN kpi_triplets t ON t.id = a.triplet_id
  JOIN competency_kpis k ON k.id = t.kpi_id
  JOIN competencies c ON c.id = k.competency_id
  WHERE s.student_id = p_student_id AND s.status = 'approved'
    AND s.self_level IS NOT NULL AND s.mentor_level IS NOT NULL
  GROUP BY c.id, c.code, c.name
  ORDER BY c.code;
END;
$$;
GRANT EXECUTE ON FUNCTION competency_self_vs_mentor(UUID) TO authenticated;
```
(`competencies.code` — confirm the column name in `docs/competency-framework-migration.sql`; if it is `code`, keep; if not, use the actual name and report it.)

- [ ] **Step 2: Header notes** — first line of `docs/daily-log-retirement-rpcs.sql`: `-- NOTE 2026-09-15: submit_assignment is now defined in docs/self-assessment-migration.sql (6 args); the 5-arg body below is history.` Same for `docs/task-assignment-rpcs.sql` and `review_assignment`.

- [ ] **Step 3: Verification file** — house pattern (see `docs/direct-messages-verification.sql`): Part A DO-block with RAISE on failure and a final `SELECT 'PASS: …'`; Part B `BEGIN…ROLLBACK`, impersonation via `set_config('request.jwt.claims', …, true)`, one `BEGIN…EXCEPTION` per case, results via the `probe.results` GUC and a split SELECT; Part C under `SET LOCAL ROLE authenticated`.

Part A asserts: both columns exist with the two CHECK constraints (by name); `submit_assignment` exists with `pg_get_function_identity_arguments` ending in `smallint` and NO 5-argument overload (`SELECT count(*) FROM pg_proc WHERE proname='submit_assignment'` = 1); likewise `review_assignment` count = 1 and 4 args; `competency_self_vs_mentor` exists and `has_function_privilege('authenticated', …, 'EXECUTE')`; `pg_get_functiondef('list_feed_posts'::regproc)` — resolve via `pg_proc` by name — contains neither `self_level` nor `mentor_level`.

Part B fixture: advisor, student (active member of a fresh probe group), mentor linked; a published assignment on a KPI whose competency is in the group's targets (copy the fixture from `docs/group-feed-verification.sql` Part B — it builds exactly this: group, membership, `group_competency_targets`, `group_assignments` with `published_at`, and a second task under the same KPI). Cases:
- B1 submit without a level → `SELF_LEVEL_REQUIRED`;
- B2 submit with `p_self_level = 1` → row `self_level = 1`, `mentor_level IS NULL`;
- B3 approve without a level → `LEVEL_REQUIRED` and status still `submitted`;
- B4 approve with 3 → `mentor_level = 3`, `status = 'approved'`, exactly 1 `kpi_observations` row for the submission (observation rule unchanged);
- B5 revision request (`review_assignment(id, false, 'redo')`) → `mentor_level IS NULL`, observation gone;
- B6 resubmit with 2 then approve with 2 → `competency_self_vs_mentor(stu)` has one row with `tasks = 1, avgSelf = 2.0, avgMentor = 2.0, gap = 0.0`;
- B7 second task self 3 / mentor 1 → that competency row `tasks = 2, gap = -1.5, overRated = 1, underRated = 0`;
- B8 a second mentor (SKIP if none) → `SELF_ASSESSMENT_FORBIDDEN`; also the student themself → rows returned;
- B9 the advisor reads it → rows returned;
- B10 `list_feed_posts(grp)` output (as the student, after B4's approval created a task post) `::text` contains neither `"selfLevel"` nor `"mentorLevel"` nor `self_level`.

Part C (authenticated): C1 the student reads own comparison → ≥1 row; C2 the advisor reads it → ≥1 row; C3 a second student (SKIP without one) → `SELF_ASSESSMENT_FORBIDDEN`; C4 direct `SELECT self_level FROM assignment_submissions WHERE id = <sub>` as the advisor → 0 rows (the advisor's existing policies do not read submissions directly; if they do, print the count and let the controller judge — say so in the row text).

- [ ] **Step 4: Lint** (even `$$` in both files), commit `feat(assessment): self and mentor ratings on submissions, comparison RPC, verification`.

---

### Task 2: Client core — types, services, error codes, helpers, i18n

**Files:**
- Modify: `src/types/assignment.ts`, `src/services/assignments.ts`, `src/types/competency.ts`, `src/services/competency.ts`, `src/utils/rpcErrors.ts`, `src/utils/taskDrafts.ts`, `src/i18n/locales/en.json`, `src/i18n/locales/tr.json`
- Create: `src/utils/selfAssessment.ts`, `src/utils/__tests__/selfAssessment.test.ts`, `src/components/common/LevelPicker.tsx` (+ export from `src/components/common/index.ts`)

**Interfaces:**
- Produces: `AssignmentSubmission.selfLevel?: SupervisionLevel; mentorLevel?: SupervisionLevel` (`SupervisionLevel = 0|1|2|3`); `assignmentService.submitAssignment(assignmentId, note, reflection, photos, documents, selfLevel)`; `assignmentService.reviewAssignment(submissionId, approved, note, level?)`; `competencyService.selfVsMentor(studentId): Promise<SelfVsMentorRow[]>`; `SelfVsMentorRow { competencyId, code, name, tasks, avgSelf, avgMentor, gap, overRated, underRated }`; helpers `levelLabel(level, t)`, `gapTag(gap) → 'high' | 'low' | null` (|gap| ≥ 1), `selfVsMentorCsvRows(rows)`; `TaskDraft.selfLevel: SupervisionLevel | null`; `<LevelPicker value onChange disabled? />`.

- [ ] **Step 1: Failing tests**
```ts
import { gapTag, levelLabel, selfVsMentorCsvRows } from '@/utils/selfAssessment';
const t = (k: string, d?: string) => d ?? k;
test('levelLabel names the four steps and nothing else', () => {
  expect([0, 1, 2, 3].map((l) => levelLabel(l as 0 | 1 | 2 | 3, t))).toEqual(['Observed', 'Heavy support', 'Partial support', 'Independent']);
});
test('gapTag flags a full point either way and stays quiet in between', () => {
  expect(gapTag(1)).toBe('low'); expect(gapTag(-1)).toBe('high'); expect(gapTag(0.9)).toBeNull(); expect(gapTag(-0.9)).toBeNull(); expect(gapTag(0)).toBeNull();
});
test('csv rows are one per competency in code order with the three numbers', () => {
  const rows = selfVsMentorCsvRows([
    { competencyId: 'b', code: 'C2', name: 'Two', tasks: 3, avgSelf: 2.3, avgMentor: 1.7, gap: -0.6, overRated: 2, underRated: 0 },
    { competencyId: 'a', code: 'C1', name: 'One', tasks: 1, avgSelf: 1, avgMentor: 3, gap: 2, overRated: 0, underRated: 1 },
  ]);
  expect(rows).toEqual([['One', 1, 1, 3, 2], ['Two', 3, 2.3, 1.7, -0.6]]);
});
```
`gapTag`: mentor − self ≥ 1 → the student rated themself **low** → `'low'`; ≤ −1 → `'high'`.

- [ ] **Step 2: Implement helpers**
```ts
import type { TFunction } from 'i18next';
export type SupervisionLevel = 0 | 1 | 2 | 3;
export const SUPERVISION_LEVELS: SupervisionLevel[] = [0, 1, 2, 3];
export function levelLabel(level: SupervisionLevel, t: TFunction | ((k: string, d?: string) => string)): string {
  const defaults = ['Observed', 'Heavy support', 'Partial support', 'Independent'];
  return (t as (k: string, d?: string) => string)(`assessment.level_${level}`, defaults[level]);
}
export interface SelfVsMentorRow { competencyId: string; code: string; name: string; tasks: number; avgSelf: number; avgMentor: number; gap: number; overRated: number; underRated: number }
/** |gap| >= 1 is a full step on a four-step scale: worth a word. gap = mentor - self. */
export function gapTag(gap: number): 'high' | 'low' | null {
  if (gap >= 1) return 'low';
  if (gap <= -1) return 'high';
  return null;
}
export function selfVsMentorCsvRows(rows: SelfVsMentorRow[]): Array<Array<string | number>> {
  return [...rows].sort((a, b) => a.code.localeCompare(b.code)).map((r) => [r.name, r.tasks, r.avgSelf, r.avgMentor, r.gap]);
}
```

- [ ] **Step 3: Types/services** — `AssignmentSubmission` + `selfLevel?`, `mentorLevel?` (mapper: `typeof r.self_level === 'number' ? r.self_level as SupervisionLevel : undefined`); `submitAssignment(...)` sends `p_self_level`; `reviewAssignment(submissionId, approved, note, level?: SupervisionLevel)` sends `p_level: level ?? null`; `competencyService.selfVsMentor(studentId)` → `supabase.rpc('competency_self_vs_mentor', { p_student_id })`, map numbers with `Number(...)`; `rpcErrors`: `SELF_LEVEL_REQUIRED: 'errors.selfLevelRequired'`, `LEVEL_REQUIRED: 'errors.levelRequired'`, `SELF_ASSESSMENT_FORBIDDEN: 'errors.selfAssessmentForbidden'`; `TaskDraft.selfLevel: SupervisionLevel | null` (default `null`; the draft store's read tolerates a missing field → null).

- [ ] **Step 4: `LevelPicker`** — a row of four `Pressable` chips (`accessibilityRole="radio"`, `accessibilityState={{ selected }}`), labels from `levelLabel`, wraps on narrow screens (`flexWrap`), `disabled` dims; props `{ value: SupervisionLevel | null; onChange: (v: SupervisionLevel) => void; disabled?: boolean; label?: string }`.

- [ ] **Step 5: i18n** — `en.json`: `errors.selfLevelRequired: "Choose how you did this task before submitting."`, `errors.levelRequired: "Choose the level you observed before approving."`, `errors.selfAssessmentForbidden: "You can't view this student's self-assessment."`; new block `assessment`: `level_0 "Observed", level_1 "Heavy support", level_2 "Partial support", level_3 "Independent", selfQuestion "How did you do this task?", mentorQuestion "How did the student do this task?", studentSaid "Student's own rating", you "You", mentor "Mentor", theySawMore "Your mentor saw more", theySawLess "Your mentor saw less", ratesHigh "Rates self high", ratesLow "Rates self low", gapHint "Mentor rating minus self-rating, averaged per competency. Around zero means you see your work the way your mentor does."`, `csvHeader "Self-assessment by competency"`, `csvColTasks "Rated tasks"`, `csvColSelf "Self (avg)"`, `csvColMentor "Mentor (avg)"`, `csvColGap "Gap"`. `tr.json`: the same keys in Turkish (`level_0 "Gözlemledim"`, `level_1 "Yoğun destekle"`, `level_2 "Kısmi destekle"`, `level_3 "Bağımsız"`, `selfQuestion "Bu görevi nasıl yaptın?"`, `mentorQuestion "Öğrenci bu görevi nasıl yaptı?"`, `studentSaid "Öğrencinin kendi puanı"`, `you "Sen"`, `mentor "Mentor"`, `theySawMore "Mentorun daha fazlasını gördü"`, `theySawLess "Mentorun daha azını gördü"`, `ratesHigh "Kendini yüksek görüyor"`, `ratesLow "Kendini düşük görüyor"`, `gapHint "Mentor puanı eksi öz puan, yetkinlik başına ortalama. Sıfıra yakın olması işini mentorunla aynı gördüğün anlamına gelir."`, `csvHeader "Yetkinlik başına öz değerlendirme"`, `csvColTasks "Puanlanan görev"`, `csvColSelf "Öz (ort.)"`, `csvColMentor "Mentor (ort.)"`, `csvColGap "Fark"`; `errors` in Turkish: `"Göndermeden önce bu görevi nasıl yaptığını seç."`, `"Onaylamadan önce gözlemlediğin düzeyi seç."`, `"Bu öğrencinin öz değerlendirmesini göremezsin."`).

- [ ] **Step 6: Gates and commit** `feat(assessment): client core — levels, services, error codes, LevelPicker, copy`.

---

### Task 3: Student — task form rating, approved card, growth bars

**Files:**
- Modify: `app/(student)/task-detail.tsx`, `app/(student)/achievements.tsx`, `src/services/studentGrowthView.ts`

- [ ] **Step 1: task-detail** — in the submit form (the `actionable` branch), directly above the submit button: `<LevelPicker label={t('assessment.selfQuestion','How did you do this task?')} value={draft.selfLevel} onChange={(selfLevel) => edit({ selfLevel })} />`; `submit()` refuses with a highlighted picker (state `levelError`, same pattern as `reflectionError`) when `currentDraft.current.selfLevel === null`; pass `value.selfLevel` as the sixth argument. On a resubmission the draft is seeded from `task.submission.selfLevel ?? null` (where the draft is first built from the submission). On an approved task (the read-only card) render a line `t('assessment.you','You')`: `levelLabel(selfLevel)` · `t('assessment.mentor','Mentor')`: `levelLabel(mentorLevel)` when both exist, plus `theySawMore` / `theySawLess` when they differ (mentor > self → more).

- [ ] **Step 2: growth** — `studentGrowthViewService.load` adds a fifth `allSettled` entry `competencyService.selfVsMentor(studentId)`; the competencies tab card gains, when a row exists for that competency, two thin bars labelled You / Mentor (width = avg/3 × 100%) and the `gapHint` once above the list; no row → nothing extra.

- [ ] **Step 3: Gates and commit** `feat(assessment): student rates each task; growth shows self vs mentor`.

---

### Task 4: Mentor — review screen rating (Codex-owned files)

**Files:**
- Modify: `app/(mentor)/review-detail.tsx`, `src/services/mentorReviews.ts`

Before editing, `git status --porcelain` both files; if either is modified, STOP and report `BLOCKED: <file>` (the controller will route the change to the parallel session).

- [ ] **Step 1** — `mentorReviewService.submit(item, approved, note, notification, level?)` passes `level` to `assignmentService.reviewAssignment`. In `review-detail.tsx`: above the "optional note" pressable, when `canReview`: a card `t('assessment.studentSaid')`: `levelLabel(item.selfLevel)` (or `t('mentorFlow.notProvided')`), then `<LevelPicker label={t('assessment.mentorQuestion')} value={level} onChange={setLevel} />`; `decide(true)` refuses with the picker highlighted when `level === null` (no server round-trip); the Approve button's `disabled` also includes `level === null`; `decide(false)` ignores the level. Keep everything else as is.

- [ ] **Step 2: Gates and commit** `feat(assessment): mentor rates on approval, sees the student's rating`.

---

### Task 5: Advisor — report gap column and CSV section

**Files:**
- Modify: `src/services/advisor.ts` (`getReportsData`), `src/types/report.ts`, `src/utils/advisorReportView.ts` (+ `__tests__/advisorReportView.test.ts` or a new test), `app/(advisor)/reports.tsx`

- [ ] **Step 1** — `StudentReportRow` gains `selfVsMentor: SelfVsMentorRow[]` (empty when none); `getReportsData` fetches `competencyService.selfVsMentor(id)` in the same `Promise.all` fan-out as `getProgress` (a failure for one student → `[]` for that student, logged with `console.warn`, not a report failure); `GroupReportData.selfVsMentorGap: number | null` per student = mean of the rows' `gap` weighted by `tasks` (helper `weightedGap(rows)` with a test: `[{gap:1,tasks:1},{gap:-1,tasks:3}] → -0.5`; `[] → null`).
- [ ] **Step 2** — Students tab card: `Self vs mentor: +0.4` (sign always shown, one decimal) or `—`; tag from `gapTag` (`ratesHigh`/`ratesLow`) in `colors.warning`. CSV: student table gains `csvColSelf`, `csvColMentor`, `csvColGap` (weighted averages; `''` when none); new section `assessment.csvHeader` with columns `csvColName`, competency, `csvColTasks`, `csvColSelf`, `csvColMentor`, `csvColGap`, one row per student × competency via `selfVsMentorCsvRows` prefixed with the student's name.
- [ ] **Step 3: Gates and commit** `feat(assessment): advisor report shows the self/mentor gap`.

---

### Task 6: Device walk

1. Student opens a task, fills the form, tries to submit without a rating → picker highlighted, no request; picks "Partial support", submits.
2. Mentor opens the review: sees "Student's own rating: Partial support"; Approve is disabled until a level is chosen; picks "Independent", approves → student's card shows You: Partial support · Mentor: Independent · "Your mentor saw more"; competency level advanced exactly as before.
3. Mentor requests revision on another task without choosing a level → works; student resubmits (rating pre-filled, changeable).
4. Growth → Competencies: two bars on the rated competency; none on others.
5. Advisor → Reports → Students: gap value and tag; CSV has the new columns and the section.
6. Stream: the approved task card shows no rating.

## Risks

- **Overload drop**: any caller still sending 5 / 3 arguments gets `PGRST202`. The only callers are `assignmentService.submitAssignment` / `reviewAssignment` (Task 2 updates them) — apply the SQL and the client together.
- **Codex-owned mentor files** (Task 4): if dirty, the controller hands the two-file change to the parallel session as a written request instead.
- `competencies.code` column name — Task 1 verifies.
