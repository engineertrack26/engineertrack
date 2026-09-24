# Advisor Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move task review and approval from the workplace mentor to the group's advisor, leaving the mentor a read-only follower who still confirms attendance.

**Architecture:** One SQL file becomes the new home of `submit_assignment` and `review_assignment` (they move out of `docs/internship-closure-guards.sql`, which keeps a note); `review_assignment`'s role gate becomes `is_group_advisor_of` and the submission notification goes to the advisor. On the client the two proven review screens move from `app/(mentor)/` to `app/(advisor)/` unchanged, the dashboards swap their featured cards, and the copy the student reads stops saying "mentor".

**Tech Stack:** Supabase (PostgreSQL, `SECURITY DEFINER` RPCs, RLS), Expo Router, React Native, TypeScript, i18next, Jest.

**Spec:** `docs/superpowers/specs/2026-09-24-advisor-review-design.md`

## Global Constraints

- SQL files are idempotent, anonymous `$$` only, one file per submission; the owner applies them by hand in the Supabase SQL editor.
- A verification file has Part A (structural), Part B (behaviour, inside `BEGIN .. ROLLBACK`), Part C (policies under `SET LOCAL ROLE authenticated`). **Every part returns a result set** — the Supabase editor does not show `NOTICE`, and it shows only the last statement's result, so Part A is one query.
- Never re-run `docs/internship-closure-guards.sql` after this change: it would put the mentor gate back. The file gets a note saying so.
- `npx tsc --noEmit` must be silent (`noUnusedLocals` / `noUnusedParameters` are on). `npx jest --silent` and `npx eslint .` must pass.
- New locale keys go to `en.json` and `tr.json`. **Exception — these sections are compared across all seven locales by parity tests and must be complete in en, tr, de, it, ro, sr, el:** `advisorHome` (`advisorHomeTranslations.test.ts`), `mentorHome`, `mentorFlow`, `mentorStudents` (`mentorReviewTranslations.test.ts`), `taskFlow` (`taskFlowTranslations.test.ts`), `authUi`, `recoveryUi` (`authFormTranslations.test.ts`).
- Commit by explicit path only (`git add <paths>` and `git commit -- <paths>`); never `git add -A`, never `git stash`, never `git checkout --`. A parallel session owns other uncommitted files.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- The simulation group is `58MMWL`; its advisor and students are the actors Part B uses. Never re-run `sim/phases/*`.

---

### Task 1: Server — the advisor reviews

**Files:**
- Create: `docs/review-by-advisor.sql`
- Create: `docs/review-by-advisor-verification.sql`
- Modify: `docs/internship-closure-guards.sql:1-22` (header note only)

**Interfaces:**
- Consumes: `is_group_advisor_of(UUID)` (`docs/internship-groups-migration.sql:229`), `internship_closed`, `award_xp_internal`.
- Produces: `submit_assignment(UUID, TEXT, TEXT, JSONB, JSONB, SMALLINT) RETURNS UUID` and `review_assignment(UUID, BOOLEAN, TEXT, SMALLINT) RETURNS VOID` with unchanged signatures — the client calls them exactly as it does today.

- [ ] **Step 1: Copy both function bodies into the new file**

`docs/review-by-advisor.sql` starts with this header, then contains the **verbatim** current text of `submit_assignment` (`docs/internship-closure-guards.sql` lines 22–373, from the `-- ===` banner through its `GRANT`) and `review_assignment` (lines 375–545), with only the three edits in steps 2–4. Copy them from the file rather than retyping: they are ~500 lines of guards whose comments carry the reasons.

```sql
-- docs/review-by-advisor.sql — idempotent. Apply after
-- docs/internship-closure-guards.sql.
--
-- NEW HOME of submit_assignment and review_assignment. They lived in
-- docs/internship-closure-guards.sql, which took them from
-- docs/self-assessment-migration.sql; that file now carries a note pointing
-- here. RE-RUNNING IT PUTS THE MENTOR GATE BACK.
--
-- Change (spec docs/superpowers/specs/2026-09-24-advisor-review-design.md):
-- the group's advisor reviews and approves, not the workplace mentor. The
-- advisor draws the task from the framework and assigns it, so the owners want
-- the same person to judge it. The mentor keeps attendance confirmation
-- (internship_review), messaging and read-only access to the work.
```

- [ ] **Step 2: Switch the role gate in `review_assignment`**

Replace:

```sql
  -- The workplace mentor evaluates. The advisor assigns and watches.
  IF NOT is_mentor_of(the_student) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;
```

with:

```sql
  -- The advisor evaluates: they draw the task from the framework and assign
  -- it, so they judge whether it was done (2026-09-24 spec). The mentor still
  -- reads the submission and still confirms attendance, but cannot decide.
  IF NOT is_group_advisor_of(the_student) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;
```

- [ ] **Step 3: Fix the decision notification's fallback name**

In `review_assignment`, the notification reads the caller's name into `mentor_name` (the variable keeps its name; it is now the advisor's). Only the fallback text is wrong. Replace `'Your mentor'` with `'Your advisor'`:

```sql
          left(coalesce(nullif(mentor_name, ''), 'Your advisor')
```

- [ ] **Step 4: Send the submission notification to the advisor**

In `submit_assignment`, replace the mentor lookup and its `IF` with the advisor lookup. The surrounding `BEGIN … EXCEPTION WHEN OTHERS … RAISE WARNING` block and its comments stay exactly as they are; only these lines change:

```sql
    SELECT g.advisor_id INTO the_reviewer
    FROM group_memberships m
    JOIN internship_groups g ON g.id = m.group_id
    WHERE m.student_id = auth.uid() AND m.left_at IS NULL
    LIMIT 1;

    -- A student not in a group cannot have an assignment to submit, so this is
    -- belt and braces; it leaves through the ordinary path, never the handler.
    IF the_reviewer IS NOT NULL THEN
```

Rename the declaration `the_mentor UUID;` to `the_reviewer UUID;`, and change the warning text to `'submit_assignment: advisor notification failed: %'`. The notification's `title`, `body`, `type` (`task_submitted`) and `data` stay as they are — `routeForNotification` keys on that type.

- [ ] **Step 5: Add the note to the old home**

In `docs/internship-closure-guards.sql`, directly under the existing header comment block, add:

```sql
-- NOTE 2026-09-24: submit_assignment and review_assignment now live in
-- docs/review-by-advisor.sql, where the reviewer is the ADVISOR. RE-RUNNING
-- THIS FILE RESTORES THE MENTOR GATE -- re-apply that file afterwards.
```

- [ ] **Step 6: Write the verification file**

`docs/review-by-advisor-verification.sql`. Part A is one query:

```sql
SELECT * FROM (
  VALUES
    ('A1 both functions exist',
     to_regprocedure('public.review_assignment(uuid,boolean,text,smallint)') IS NOT NULL
       AND to_regprocedure('public.submit_assignment(uuid,text,text,jsonb,jsonb,smallint)') IS NOT NULL),
    ('A2 review_assignment gates on the advisor, not the mentor',
     pg_get_functiondef(to_regprocedure('public.review_assignment(uuid,boolean,text,smallint)')) LIKE '%is_group_advisor_of(the_student)%'
       AND pg_get_functiondef(to_regprocedure('public.review_assignment(uuid,boolean,text,smallint)')) NOT LIKE '%NOT is_mentor_of(the_student)%'),
    ('A3 submit_assignment notifies the advisor',
     pg_get_functiondef(to_regprocedure('public.submit_assignment(uuid,text,text,jsonb,jsonb,smallint)')) LIKE '%g.advisor_id INTO the_reviewer%'),
    ('A4 both are SECURITY DEFINER with a fixed search_path',
     (SELECT bool_and(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%'))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('submit_assignment', 'review_assignment'))),
    ('A5 callable by authenticated, not by anon',
     has_function_privilege('authenticated', 'review_assignment(uuid,boolean,text,smallint)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'review_assignment(uuid,boolean,text,smallint)', 'EXECUTE'))
) AS t(check_name, ok)
ORDER BY check_name;
```

Part B runs inside `BEGIN; … ROLLBACK;`, impersonates with
`PERFORM set_config('request.jwt.claims', json_build_object('sub', <uuid>)::text, true);`, collects lines into a `v_log TEXT` and ends with
`PERFORM set_config('probe.results', v_log, true);` followed by

```sql
SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';
```

It checks, each recorded as `PASS …` / `FAIL …` rather than raised, against a student of group `58MMWL` who has a submitted (not yet approved) assignment:

- **B1** the group's advisor calls `review_assignment(submission, true, 'Tebrikler', 2)` → the row's status is `approved`, `mentor_level` is 2, and a `kpi_observations` row exists for that submission with `observed_by` = the advisor.
- **B2** the student's mentor calls `review_assignment(...)` on a fresh submitted row → `ROLE_NOT_ALLOWED` (this is the rule that changed; assert the code).
- **B3** a second approval by the advisor → `ALREADY_APPROVED`.
- **B4** `submit_assignment` by a student with a published unsubmitted assignment → a `notifications` row of type `task_submitted` whose `user_id` is the **advisor**, and none for the mentor.
- **B5** a student whose internship is closed → `INTERNSHIP_CLOSED` on review.

Part C, under `SET LOCAL ROLE authenticated` with the mentor's claims: `SELECT` on `assignment_submissions` for their student returns a row (the mentor still reads), and `UPDATE assignment_submissions SET status = 'approved'` affects 0 rows / is refused (no write policy).

- [ ] **Step 7: Hand the files to the owner and record the results**

The owner applies `docs/review-by-advisor.sql`, then each verification part separately, and pastes the result sets back. Every row must read `PASS`/`true`. Do not proceed to Task 2 until B2 shows the mentor refused.

- [ ] **Step 8: Commit**

```bash
git add docs/review-by-advisor.sql docs/review-by-advisor-verification.sql docs/internship-closure-guards.sql
git commit -m "feat(review): the advisor reviews and approves, not the mentor

review_assignment gates on is_group_advisor_of; submit_assignment notifies
the group's advisor. Both move to docs/review-by-advisor.sql, their new home;
internship-closure-guards.sql keeps the note. Verified live: A 5/5, B 5/5, C 2/2.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- docs/review-by-advisor.sql docs/review-by-advisor-verification.sql docs/internship-closure-guards.sql
```

---

### Task 2: The review screens move to the advisor

**Files:**
- Move: `app/(mentor)/pending-reviews.tsx` → `app/(advisor)/pending-reviews.tsx`
- Move: `app/(mentor)/review-detail.tsx` → `app/(advisor)/review-detail.tsx`
- Modify: `app/(mentor)/_layout.tsx:70-85` (drop both screens)
- Modify: `app/(advisor)/_layout.tsx:62-66` (add both screens)
- Modify: `src/utils/notificationRoutes.ts:67-73`
- Test: `src/utils/__tests__/notificationRoutes.test.ts`

**Interfaces:**
- Consumes: Task 1's `review_assignment` (unchanged signature), `mentorReviewStore`, `src/components/mentor/*` (`ReviewUI`, `ReviewNoteSheet`, `ReviewEvidence`) — all reused as they are, no rename.
- Produces: the routes `/(advisor)/pending-reviews` and `/(advisor)/review-detail`, which Task 3's dashboard card pushes to.

- [ ] **Step 1: Write the failing test**

In `src/utils/__tests__/notificationRoutes.test.ts` add:

```ts
test('a submitted task sends the advisor to their review queue', () => {
  expect(routeForNotification('task_submitted', { submissionId: 's1' }, 'advisor'))
    .toEqual({ pathname: '/(advisor)/review-detail', params: { id: 's1', studentId: '', assignmentId: '' } });
  expect(routeForNotification('task_submitted', { assignmentId: 'a1' }, 'advisor'))
    .toEqual({ pathname: '/(advisor)/pending-reviews', params: { assignmentId: 'a1', studentId: '' } });
});

test('a mentor no longer has a review queue to open', () => {
  expect(routeForNotification('task_submitted', { submissionId: 's1' }, 'mentor')).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/utils/__tests__/notificationRoutes.test.ts`
Expected: FAIL — the advisor case returns `null`, the mentor case returns the old mentor route.

- [ ] **Step 3: Move the two files with git**

```bash
git mv "app/(mentor)/pending-reviews.tsx" "app/(advisor)/pending-reviews.tsx"
git mv "app/(mentor)/review-detail.tsx" "app/(advisor)/review-detail.tsx"
```

Then inside both files replace every `/(mentor)/` route string with `/(advisor)/` (they push to `review-detail`, `pending-reviews` and `student-list`; the last one becomes `/(advisor)/student-monitor`, which is the advisor's equivalent screen).

- [ ] **Step 4: Move the tab entries**

In `app/(mentor)/_layout.tsx` delete the `pending-reviews` `Tabs.Screen` (with its `tabBarBadge`) and the hidden `review-detail` one. In `app/(advisor)/_layout.tsx` add, next to the other hidden screens:

```tsx
      <Tabs.Screen
        name="pending-reviews"
        options={{
          title: t('tabs.reviews'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="review-detail" options={{ href: null }} />
```

Copy the badge logic verbatim from the mentor layout if it had one, so the advisor sees the same waiting count.

- [ ] **Step 5: Move the notification route**

In `src/utils/notificationRoutes.ts`, delete `case 'task_submitted'` from the `'mentor'` branch and add it to the `'advisor'` branch with `/(advisor)/` paths, keeping the same submissionId/assignmentId fallback comment.

- [ ] **Step 6: Give the queue a group chip**

A mentor's queue held one group's students; an advisor may run several, so
`app/(advisor)/pending-reviews.tsx` filters by group. Reuse the chip row the
messages screen already has (`src/components/screens/MessagesScreen.tsx`,
styles `chipRow` / `chip` / `chipActive`): load the advisor's groups with
`groupService.listMyGroups(user.id)`, render a chip per group **only when
there is more than one**, and filter the queue to the selected group's
students. Default to the first group that is not archived.

- [ ] **Step 7: Run the checks**

Run: `npx jest src/utils/__tests__/notificationRoutes.test.ts` → PASS
Run: `npx tsc --noEmit` → silent
Run: `npx jest --silent` → all pass (fix any test that names the old mentor routes)
Run: `npx eslint .` → exit 0

- [ ] **Step 8: Commit**

```bash
git add "app/(advisor)/pending-reviews.tsx" "app/(advisor)/review-detail.tsx" "app/(mentor)/_layout.tsx" "app/(advisor)/_layout.tsx" src/utils/notificationRoutes.ts src/utils/__tests__/notificationRoutes.test.ts
git commit -m "feat(review): the review queue and detail move to the advisor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- "app/(advisor)/pending-reviews.tsx" "app/(advisor)/review-detail.tsx" "app/(mentor)/pending-reviews.tsx" "app/(mentor)/review-detail.tsx" "app/(mentor)/_layout.tsx" "app/(advisor)/_layout.tsx" src/utils/notificationRoutes.ts src/utils/__tests__/notificationRoutes.test.ts
```

---

### Task 3: The two dashboards swap their featured card

**Files:**
- Modify: `app/(advisor)/dashboard.tsx` (add the next-review card)
- Modify: `app/(mentor)/dashboard.tsx:108-135` (replace the review card with attendance)
- Modify: `src/i18n/locales/{en,tr,de,it,ro,sr,el}.json` — `advisorHome` and `mentorHome` are parity-tested across all seven
- Test: `src/utils/__tests__/advisorHomeTranslations.test.ts` and `mentorReviewTranslations.test.ts` cover the keys automatically

**Interfaces:**
- Consumes: `useMentorReviewStore` (queue + names, reused unchanged), `internshipDayService` for the mentor's attendance count, the routes from Task 2.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Move the advisor's card in**

Copy the mentor dashboard's featured block (`app/(mentor)/dashboard.tsx:108-135`: `ReviewIdentity`, the task title, the competency/due fact table, the `Stamp kind="pending"`, the primary "Review" button and the "all pending (N)" link) into `app/(advisor)/dashboard.tsx`, above the tools list, pushing to `/(advisor)/review-detail` and `/(advisor)/pending-reviews`.

- [ ] **Step 2: Give the mentor's card its new job**

Replace the mentor's featured block with the attendance one: the number of internship days waiting for confirmation, and a primary button to `/(mentor)/internship-days`. Empty state uses `mentorHome.emptyHint`.

- [ ] **Step 3: Add the copy in all seven locales**

New keys (`advisorHome.nextReview`, `advisorHome.allPending`, `mentorHome.daysWaiting`, `mentorHome.confirmDays`) must exist in **en, tr, de, it, ro, sr, el** — the parity tests compare key sets and `{{placeholders}}`.

- [ ] **Step 4: Run the checks**

Run: `npx jest --silent` → all pass, including the two translation parity tests
Run: `npx tsc --noEmit` → silent
Run: `npx eslint .` → exit 0

- [ ] **Step 5: Commit**

```bash
git add "app/(advisor)/dashboard.tsx" "app/(mentor)/dashboard.tsx" src/i18n/locales
git commit -m "feat(review): the advisor's home leads with the next review, the mentor's with attendance

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- "app/(advisor)/dashboard.tsx" "app/(mentor)/dashboard.tsx" src/i18n/locales
```

---

### Task 4: The copy stops saying "mentor" where the advisor now decides

**Files:**
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/tr.json` (and all seven for `mentorFlow` / `taskFlow`, which are parity-tested)
- Test: `src/utils/__tests__/studentTurkishTranslations.test.ts` (add the assertions below)

**Interfaces:**
- Consumes: nothing. Produces: nothing. Pure copy.

- [ ] **Step 1: Write the failing test**

In `src/utils/__tests__/studentTurkishTranslations.test.ts`:

```ts
test('the student is told the advisor reviews, not the mentor', () => {
  expect(instance.t('studentFlow.mentorNote')).toBe('Danışman notu');
  expect(instance.t('studentFlow.reviewHint')).toBe('Gönderdiğinde danışmanın çalışmanı inceleyecek.');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/utils/__tests__/studentTurkishTranslations.test.ts`
Expected: FAIL — the strings still say "Mentor notu" / "mentorun".

- [ ] **Step 3: Change the strings**

| key | en | tr |
|---|---|---|
| `studentFlow.mentorNote` | `Advisor note` | `Danışman notu` |
| `studentFlow.reviewHint` | `Your advisor will review your work after you submit.` | `Gönderdiğinde danışmanın çalışmanı inceleyecek.` |
| `mentorFlow.optionalNote` | `Add a note (optional)` | `Not ekle (isteğe bağlı)` |
| `mentorFlow.previousNote` | `Previous note` | `Önceki not` |
| `student.whatIDidTodayHint` | `Tick the behaviours you showed. Your advisor rates separately — the two are compared, not merged.` | `Gösterdiğin davranışları işaretle. Danışmanın ayrı değerlendirme yapar; iki değerlendirme birleştirilmez, karşılaştırılır.` |

The JSON **keys** stay as they are (`mentorNote`, `mentorFlow.*`): renaming them would touch every reader for no behavioural gain, exactly as the spec says about `mentor_note` in SQL. `mentorFlow` is parity-tested, so change those two strings in all seven locales; the rest go to en and tr.

- [ ] **Step 4: Run the checks**

Run: `npx jest --silent` → all pass
Run: `npx tsc --noEmit` → silent

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales src/utils/__tests__/studentTurkishTranslations.test.ts
git commit -m "feat(review): the student reads 'advisor note', because the advisor decides now

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- src/i18n/locales src/utils/__tests__/studentTurkishTranslations.test.ts
```

---

### Task 5: Documentation

**Files:**
- Modify: `CLAUDE.md` (Domain Model item 3, Route Groups)
- Modify: `docs/superpowers/specs/2026-08-20-task-assignment-design.md` (amendment note at the top)
- Modify: `PROGRESS.md` (session row)

**Interfaces:** none.

- [ ] **Step 1: Update CLAUDE.md**

Domain Model item 3 becomes: advisor drafts and publishes; student submits; **the advisor** reviews (`review_assignment`) and an approval writes the KPI observation; the mentor confirms attendance, messages and follows the work read-only. Route Groups: `pending-reviews` and `review-detail` move from the mentor's list to the advisor's.

- [ ] **Step 2: Note the amendment on the old spec**

At the top of `docs/superpowers/specs/2026-08-20-task-assignment-design.md`:

```markdown
> **Amended 2026-09-24:** review and approval moved from the workplace mentor
> to the group's advisor — see `2026-09-24-advisor-review-design.md`. The rest
> of this document still describes what is built.
```

- [ ] **Step 3: Add the PROGRESS.md row**

One row in the session log naming the change, the spec, the SQL file, the verification result and the screens that moved.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-20-task-assignment-design.md PROGRESS.md
git commit -m "docs: review and approval belong to the advisor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- CLAUDE.md docs/superpowers/specs/2026-08-20-task-assignment-design.md PROGRESS.md
```

---

## Device check before calling it done

On the emulator, as the simulation's advisor (`selin.aydin@sim.engineertrack.test` / `Sim-Selin-2026!`): the home shows the next review, the queue lists the waiting submissions with the group chip, and approving one moves it out of the queue. As a mentor (`hakan.demir@sim.engineertrack.test` / `Sim-Hakan-2026!`): no review tab, the home leads with attendance, and the student's submission is still visible from the student list.
