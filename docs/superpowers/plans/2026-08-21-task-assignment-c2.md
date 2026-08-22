# Task Assignment C2 — The Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the task-assignment flow in front of its three actors — the advisor who assigns, the student who submits, the mentor who evaluates — on top of a schema and service layer that are already live and verified.

**Architecture:** Three screens, each registered `href: null` and reached from an existing one, because every tab bar is full. The advisor's screens hang off a group; the student's and mentor's off their dashboards. All data goes through `assignmentService`; the two write paths that matter (`submitAssignment`, `reviewAssignment`) are `SECURITY DEFINER` RPCs whose refusals arrive as stable error codes that must be mapped, not swallowed. Notifications follow the pattern the daily-log flow already uses: the screen that causes the event raises it.

**Tech Stack:** Expo SDK 54, React Native, TypeScript, Expo Router, Supabase, i18next, Jest for pure helpers.

**Spec:** `docs/superpowers/specs/2026-08-20-task-assignment-design.md` (section 4 is this plan; sections 1–3 shipped as C1)

## Global Constraints

- Path aliases (`@/…`) for anything outside the current directory; never a relative path out of `src/`.
- `npx tsc --noEmit` silent at the end of every task.
- `npx jest --silent` green. Baseline is 3 suites / 21 tests; only Task 3 changes that count.
- Only `src/i18n/locales/en.json` among the seven locale files. Translation is paused project-wide and `fallbackLng` is `'en'`.
- No new tabs. Every new screen is `<Tabs.Screen name="…" options={{ href: null }} />` and reached by `router.push`.
- Every `catch` around an `assignmentService` RPC call maps the error through `mapRpcError` from `@/utils/rpcErrors` and shows the translated key. A raw `err.message` in an Alert is a defect — the RPCs raise stable codes precisely so the user sees a sentence.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## What C1 left you

Read `src/services/assignments.ts` before starting. It exposes:

```ts
listTriplets(kpiId: string): Promise<KpiTriplet[]>
createAssignment(input: { groupId, tripletId, title, description?, objective, criterion, dueDate?, createdBy }): Promise<GroupAssignment>
listGroupAssignments(groupId: string): Promise<GroupAssignment[]>
listMyAssignments(groupId: string, studentId: string): Promise<MyAssignment[]>
listPendingReviews(): Promise<Array<AssignmentSubmission & { assignment: GroupAssignment }>>
submitAssignment(assignmentId: string, note: string, logId: string | null): Promise<string>
reviewAssignment(submissionId: string, approved: boolean, note: string): Promise<void>
```

`listPendingReviews` takes no mentor id on purpose — RLS already scopes those rows to `is_mentor_of(student_id)`, and a parameter would invite passing someone else's.

**There is no update or delete function. Task 2 adds them.**

The server refuses in six ways you must surface, all already mapped in `src/utils/rpcErrors.ts` to `errors.*` keys that exist in `en.json`: `ASSIGNMENT_NOT_FOUND`, `SUBMISSION_NOT_FOUND`, `NOT_IN_SCOPE`, `ALREADY_APPROVED`, `STUDENT_LEFT_GROUP`, `ASSIGNMENT_LOCKED`.

Two server rules shape the UI and are not negotiable from here:

- **`trg_assignment_within_scope`** refuses an assignment whose competency is not in the group's `group_competency_targets`. The picker must filter to in-scope competencies so this never fires in normal use — the trigger is the backstop, not the interface.
- **`trg_freeze_assessed_assignment`** refuses a change to `objective`, `criterion`, `triplet_id` or `group_id` once any submission exists, raising `ASSIGNMENT_LOCKED`. `title`, `description` and `due_date` stay editable forever.

---

### Task 1: The advisor's assignments screen — list and create

**Files:**
- Create: `app/(advisor)/group-assignments.tsx`
- Modify: `app/(advisor)/_layout.tsx` (register the screen)
- Modify: `app/(advisor)/groups.tsx` (entry point)
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `assignmentService.listGroupAssignments`, `listTriplets`, `createAssignment`; `competencyService.listFramework`, `getGroupTargets`.
- Produces: the route `/(advisor)/group-assignments?groupId=…`, which Task 2 extends.

`app/(advisor)/group-competencies.tsx` is the sibling to copy from: same `useLocalSearchParams<{ groupId?: string }>`, same `useFocusEffect` + `loadData` shape, same `SafeAreaView` / `ScrollView` / `RefreshControl` skeleton, and `const ADVISOR_COLOR = colors.info;` at the top. Read it first and match it.

- [ ] **Step 1: Register the route and the entry point**

In `app/(advisor)/_layout.tsx`, beside the two that are already hidden:

```tsx
      <Tabs.Screen name="group-assignments" options={{ href: null }} />
```

In `app/(advisor)/groups.tsx`, next to the button that opens `group-competencies` (around line 182), add one in the same style:

```tsx
                onPress={() => router.push(`/(advisor)/group-assignments?groupId=${g.id}`)}
```

Label it `t('advisor.assignments')`. Match the surrounding button's markup exactly — same component, same style prop, same icon size.

- [ ] **Step 2: Load the three things the screen needs**

The picker must offer only competencies in the group's scope, so it needs the framework and the group's targets together with the existing assignments:

```tsx
  const loadData = useCallback(async () => {
    if (!groupId) return;
    try {
      const [existing, framework, targets] = await Promise.all([
        assignmentService.listGroupAssignments(groupId),
        competencyService.listFramework(),
        competencyService.getGroupTargets(groupId),
      ]);
      setAssignments(existing);
      const inScope = new Set(targets.map((t) => t.competencyId));
      setCompetencies(framework.competencies.filter((c) => inScope.has(c.id)));
      setKpis(framework.kpis);
    } catch (err) {
      console.error('Load assignments error:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);
```

`listFramework()` returns `{ competencies, kpis }`; `getGroupTargets` returns `GroupCompetencyTarget[]` with `competencyId` and `targetLevel`. Both are in `src/services/competency.ts` — read their return types rather than guessing.

- [ ] **Step 3: The creation cascade**

Four dependent selections. Keep them in four pieces of state and clear the ones below whenever one above changes, or the screen will offer a triplet from a competency the advisor has since switched away from:

```tsx
  const [pickedCompetency, setPickedCompetency] = useState<string | null>(null);
  const [pickedLevel, setPickedLevel] = useState<number | null>(null);
  const [pickedTriplet, setPickedTriplet] = useState<KpiTriplet | null>(null);
  const [triplets, setTriplets] = useState<KpiTriplet[]>([]);

  function chooseCompetency(id: string) {
    setPickedCompetency(id);
    setPickedLevel(null);
    setPickedTriplet(null);
    setTriplets([]);
  }

  async function chooseLevel(level: number) {
    setPickedLevel(level);
    setPickedTriplet(null);
    const levelKpis = kpis.filter(
      (k) => k.competencyId === pickedCompetency && k.level === level,
    );
    const lists = await Promise.all(levelKpis.map((k) => assignmentService.listTriplets(k.id)));
    setTriplets(lists.flat());
  }
```

A level has two KPIs and each holds ten triplets, so the picker shows twenty. Group them under their KPI's `statement` so the advisor reads "for this behaviour, these ten tasks" rather than a flat list — `kpis.find(k => k.id === triplet.kpiId)?.statement` gives the heading.

Offer levels 1–4. Do not filter by the group's target level: the target is where the group is heading, not a ceiling on what may be assigned today.

- [ ] **Step 4: Prefill, edit, assign**

Choosing a triplet fills three editable fields:

```tsx
  function chooseTriplet(t: KpiTriplet) {
    setPickedTriplet(t);
    setTitle(t.task);
    setObjective(t.objective);
    setCriterion(t.criterion);
  }
```

`title` starts from the triplet's `task` because that is the instruction; `objective` and `criterion` are shown as editable multi-line fields beneath it. All three are copied into the row at creation and the criterion is what the mentor will judge against, so the advisor must see it now, not discover it later.

The save:

```tsx
  async function handleAssign() {
    if (!groupId || !pickedTriplet || !user) return;
    if (!title.trim()) {
      Alert.alert(t('common.error'), t('advisor.assignmentTitleRequired'));
      return;
    }
    setSaving(true);
    try {
      await assignmentService.createAssignment({
        groupId,
        tripletId: pickedTriplet.id,
        title: title.trim(),
        description: description.trim() || undefined,
        objective: objective.trim(),
        criterion: criterion.trim(),
        dueDate: dueDate || undefined,
        createdBy: user.id,
      });
      Alert.alert(t('common.done'), t('advisor.assignmentCreated'));
      resetForm();
      await loadData();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setSaving(false);
    }
  }
```

`createAssignment` throws `RpcError` specifically so `NOT_IN_SCOPE` from the trigger reaches `mapRpcError` — do not replace this with a raw message.

`dueDate` uses the same picker `app/(student)/internship-form.tsx` uses: `@react-native-community/datetimepicker`, stored as `YYYY-MM-DD`, displayed with `toLocaleDateString(i18n.language)`. Read that file's `toIsoDate` and `fromIsoDate` helpers and copy them — they work in local time deliberately, because `toISOString()` shifts the date by a day at any positive offset.

- [ ] **Step 5: The list, with per-student counts**

Above the form, each existing assignment with how far the group has got. `listGroupAssignments` returns only the assignments, so fetch the submissions alongside and count in the client:

```tsx
  const { data } = await supabase
    .from('assignment_submissions')
    .select('assignment_id, status')
    .in('assignment_id', existing.map((a) => a.id));
```

Guard the empty case: `.in()` with an empty array returns nothing, but building the query at all when `existing` is empty is wasted work — skip it.

Show `approved / submitted / total members` per assignment. Member count comes from `groupService.listMembers(groupId)`.

- [ ] **Step 6: Keys, typecheck, commit**

Add to the `advisor` object in `src/i18n/locales/en.json` ONLY: `assignments`, `assignmentCreated`, `assignmentTitleRequired`, `pickCompetency`, `pickLevel`, `pickTriplet`, `assignmentTitle`, `assignmentObjective`, `assignmentCriterion`, `assignmentDescription`, `assignmentDueDate`, `assign`, `noAssignments`, `submittedCount`, `approvedCount`.

```bash
npx tsc --noEmit && npx jest --silent
```

Then verify every style name the JSX uses exists in the file's own `StyleSheet.create` — a missing style is `undefined` at runtime, renders silently, and `tsc` cannot see it:

```bash
python -c "
import re
src = open('app/(advisor)/group-assignments.tsx', encoding='utf-8').read()
used = set(re.findall(r'styles\.(\w+)', src))
declared = set(re.findall(r'^  (\w+):\s*\{', src, re.M))
print('missing:', sorted(used - declared) or 'none')
"
```

Commit with a message explaining that the picker filters to in-scope competencies so the trigger stays a backstop rather than the interface.

---

### Task 2: The advisor can edit and withdraw an assignment

**Files:**
- Modify: `src/services/assignments.ts`
- Modify: `app/(advisor)/group-assignments.tsx`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: Task 1's screen.
- Produces: `assignmentService.updateAssignment(id, patch)` and `assignmentService.deleteAssignment(id)`.

- [ ] **Step 1: Add the two service functions**

In `src/services/assignments.ts`, matching the file's conventions — sibling-relative imports, `RpcError` for anything that can raise a domain code:

```ts
  /** title, description and due_date are always editable. objective, criterion
   *  and triplet_id are frozen by trg_freeze_assessed_assignment once any
   *  submission exists, and the attempt comes back as ASSIGNMENT_LOCKED. */
  async updateAssignment(
    id: string,
    patch: {
      title?: string; description?: string | null; dueDate?: string | null;
      objective?: string; criterion?: string;
    },
  ): Promise<GroupAssignment> {
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
    if (patch.objective !== undefined) row.objective = patch.objective;
    if (patch.criterion !== undefined) row.criterion = patch.criterion;

    const { data, error } = await supabase
      .from('group_assignments')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new RpcError(error.message);
    return toAssignment(data as Record<string, unknown>);
  },

  /** Permitted only while no student has acted on it — the DELETE policy
   *  carries `NOT assignment_has_submissions(id)`, so a withdrawal of an
   *  assessed assignment silently affects zero rows rather than raising. */
  async deleteAssignment(id: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('group_assignments')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new RpcError(error.message);
    return (data || []).length > 0;
  },
```

`deleteAssignment` returns a boolean because **RLS filters rather than raises**. The DELETE policy's `USING` clause excludes an assignment that has submissions, so the statement succeeds having deleted nothing. A screen that assumes success would tell the advisor the assignment is gone while it is still there. That distinction — `USING` filters, `WITH CHECK` raises — is why this returns a boolean and `updateAssignment` does not.

Export the two through `src/services/index.ts` if the barrel lists individual functions; it exports the service object, so nothing to add.

- [ ] **Step 2: The edit sheet**

Tapping an assignment in Task 1's list opens an editor with `title`, `description` and `dueDate` always enabled, and `objective` and `criterion` enabled only when that assignment has no submissions. Compute that from the counts Task 1 already fetched: `submitted + approved === 0`.

Disable rather than hide the two frozen fields, and show `t('advisor.assignmentTermsLocked')` beneath them. Hiding them would leave the advisor wondering where the criterion went; disabling them says the terms are settled because someone has already worked to them.

The server is still the authority. Send only what changed, and map the refusal:

```tsx
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    }
```

`ASSIGNMENT_LOCKED` already maps to `errors.assignmentLocked`.

- [ ] **Step 3: Withdraw**

A destructive action, so confirm first with `Alert.alert` and a cancel. Then:

```tsx
      const removed = await assignmentService.deleteAssignment(a.id);
      if (!removed) {
        Alert.alert(t('common.error'), t('advisor.assignmentHasSubmissions'));
        return;
      }
```

That branch is the whole point of the boolean. Do not collapse it into a success path.

- [ ] **Step 4: Keys, typecheck, commit**

New `advisor` keys: `editAssignment`, `assignmentUpdated`, `assignmentTermsLocked`, `withdrawAssignment`, `withdrawConfirm`, `assignmentHasSubmissions`, `assignmentWithdrawn`.

```bash
npx tsc --noEmit && npx jest --silent
```

---

### Task 3: The student's My Tasks screen

**Files:**
- Create: `app/(student)/my-tasks.tsx`
- Create: `src/utils/assignmentGrouping.ts`
- Create: `src/utils/__tests__/assignmentGrouping.test.ts`
- Modify: `app/(student)/_layout.tsx`, `app/(student)/dashboard.tsx`, `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `assignmentService.listMyAssignments(groupId, studentId)`, `submitAssignment`; `groupService.getMyGroup(studentId)`.
- Produces: `groupAssignmentsByState(items: MyAssignment[]): { todo: MyAssignment[]; waiting: MyAssignment[]; done: MyAssignment[]; revise: MyAssignment[] }`.

This is the only task that changes the test count, because the grouping rule is pure and worth pinning: a task with no submission row is "to do", and the absence — not a status value — is what says so.

- [ ] **Step 1: Write the failing test**

`src/utils/__tests__/assignmentGrouping.test.ts`:

```ts
import { groupAssignmentsByState } from '@/utils/assignmentGrouping';
import type { MyAssignment } from '@/types/assignment';

const base = {
  groupId: 'g', tripletId: 't', title: 'T', objective: 'O',
  criterion: 'C', createdAt: '2026-01-01',
};

function make(id: string, status?: 'submitted' | 'approved' | 'needs_revision'): MyAssignment {
  return {
    ...base,
    id,
    submission: status
      ? { id: `s-${id}`, assignmentId: id, studentId: 'me', status, submittedAt: '2026-01-02' }
      : undefined,
  };
}

describe('groupAssignmentsByState', () => {
  it('treats a missing submission as not started', () => {
    const out = groupAssignmentsByState([make('a')]);
    expect(out.todo.map((x) => x.id)).toEqual(['a']);
    expect(out.waiting).toHaveLength(0);
  });

  it('separates the three submission states', () => {
    const out = groupAssignmentsByState([
      make('a'), make('b', 'submitted'), make('c', 'approved'), make('d', 'needs_revision'),
    ]);
    expect(out.todo.map((x) => x.id)).toEqual(['a']);
    expect(out.waiting.map((x) => x.id)).toEqual(['b']);
    expect(out.done.map((x) => x.id)).toEqual(['c']);
    expect(out.revise.map((x) => x.id)).toEqual(['d']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest src/utils/__tests__/assignmentGrouping.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the helper**

`src/utils/assignmentGrouping.ts`:

```ts
import type { MyAssignment } from '@/types/assignment';

export interface AssignmentGroups {
  revise: MyAssignment[];
  todo: MyAssignment[];
  waiting: MyAssignment[];
  done: MyAssignment[];
}

/** A task the student has not acted on has NO submission row at all — the
 *  absence is the state, which is why there is no 'assigned' status in the
 *  database. Anything that reads a status field to decide "not started" is
 *  reading a value that never exists. */
export function groupAssignmentsByState(items: MyAssignment[]): AssignmentGroups {
  const out: AssignmentGroups = { revise: [], todo: [], waiting: [], done: [] };
  for (const item of items) {
    const status = item.submission?.status;
    if (status === 'needs_revision') out.revise.push(item);
    else if (status === 'submitted') out.waiting.push(item);
    else if (status === 'approved') out.done.push(item);
    else out.todo.push(item);
  }
  return out;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx jest --silent
```

Expected: 4 suites / 23 tests.

- [ ] **Step 5: The screen**

Register `<Tabs.Screen name="my-tasks" options={{ href: null }} />` in `app/(student)/_layout.tsx` and add a card on the dashboard that pushes `/(student)/my-tasks`, in the style of the existing dashboard cards around line 206.

The screen needs the student's group first, because `listMyAssignments` takes a group id:

```tsx
      const group = await groupService.getMyGroup(user.id);
      if (!group) { setAssignments([]); return; }
      setAssignments(await assignmentService.listMyAssignments(group.id, user.id));
```

A student in no group gets an empty list and a plain message — not an error, not a spinner. The leaderboard and the achievements screen both already handle that case that way.

Render the four groups in the order `revise, todo, waiting, done`: what the mentor sent back is the most urgent thing on the screen.

Opening one shows the objective, the task and **the criterion**. The criterion is not optional detail — the spec requires the student to see what they will be judged against, and it is half the reason the triplet exists.

- [ ] **Step 6: Submitting**

A note field and an optional link to today's log:

```tsx
      await assignmentService.submitAssignment(a.id, note.trim(), logId);
```

Get `logId` from `logService.getLogByDate(user.id, todayIso)` — the same call `app/(student)/dashboard.tsx` already makes. Offer it as a toggle, defaulting off, labelled with the log's title. If there is no log today, do not show the toggle at all.

Map every refusal. `ALREADY_APPROVED` is the one the student will actually hit — tapping Submit on a task their mentor approved while the screen was open.

- [ ] **Step 7: Keys, typecheck, commit**

New `student` keys: `myTasks`, `noTasks`, `noGroupTasks`, `taskObjective`, `taskCriterion`, `taskNote`, `attachTodaysLog`, `submitTask`, `taskSubmitted`, `stateRevise`, `stateTodo`, `stateWaiting`, `stateDone`.

---

### Task 4: The mentor's pending reviews screen

**Files:**
- Create: `app/(mentor)/pending-reviews.tsx`
- Modify: `app/(mentor)/_layout.tsx`, `app/(mentor)/dashboard.tsx`, `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `assignmentService.listPendingReviews()`, `reviewAssignment`.
- Produces: nothing later depends on it.

- [ ] **Step 1: Register and enter**

`<Tabs.Screen name="pending-reviews" options={{ href: null }} />` in the mentor layout; a dashboard card pushing `/(mentor)/pending-reviews`, in the style of the review-log card around line 213, showing the count.

- [ ] **Step 2: The list**

```tsx
      setPending(await assignmentService.listPendingReviews());
```

No argument, and do not add one. RLS scopes the rows to this mentor's students; a parameter would be decoration over a rule the database enforces, and an invitation to pass someone else's id.

Each row: the student's name, the assignment title, the due date if set.

The student's name is not on the returned shape. Fetch it with a second query keyed by the `studentId` values you already have — the precedent is `src/services/group.ts:150-165`, which does exactly this and whose comment explains why an embed will not work there. Do **not** copy `app/(advisor)/validation.tsx`: it gets names from a PostgREST embed on a foreign key that exists for daily logs and does not exist here.

Read `profiles`, not `profiles_public`: `profiles_select` admits `is_mentor_of(id)`, so a mentor can read their own students' rows directly, and `profiles` carries the names. `profiles_public` is the fallback for readers who have no such relationship, which is not this case.

- [ ] **Step 3: The review sheet**

Side by side, because the mentor is comparing one against the other:

- the task and the **criterion** — this is what they judge against;
- the student's note;
- the linked log, if `submission.logId` is set, fetched with `logService.getLogWithDetails`.

Then approve or request revision, note optional, and one submit per branch:

```tsx
      await assignmentService.reviewAssignment(submissionId, approved, note.trim());
```

Map the refusals. Two are reachable here and both are worth their own sentence: `STUDENT_LEFT_GROUP` when the student changed groups between submitting and now, and `NOT_IN_SCOPE` when the advisor narrowed the group's scope in the meantime. Neither is the mentor's fault and neither is fixable by them, so the message must point at who can fix it — the advisor.

- [ ] **Step 4: Keys, typecheck, commit**

New `mentor` keys: `pendingReviews`, `noPendingReviews`, `taskCriterion`, `studentNote`, `linkedLog`, `approveTask`, `requestTaskRevision`, `reviewNote`, `taskApproved`, `taskRevisionRequested`.

---

### Task 5: Notifications on the three events

**Files:**
- Modify: `src/types/notification.ts`
- Modify: `app/(advisor)/group-assignments.tsx`, `app/(student)/my-tasks.tsx`, `app/(mentor)/pending-reviews.tsx`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `notificationService.create(userId, title, body, type, data?)`.
- Produces: nothing.

The daily-log flow raises its notifications from the screen that causes the event (`app/(mentor)/review-log.tsx:327`), not from the service. Follow that — the screen has the names and titles the body needs.

- [ ] **Step 1: Extend the type union**

`src/types/notification.ts`:

```ts
  | 'task_assigned'
  | 'task_submitted'
  | 'task_reviewed'
```

The database column is free `TEXT` with no CHECK, so this union is the only thing keeping the values honest.

- [ ] **Step 2: On assign — to every active member**

In `handleAssign`, after `createAssignment` succeeds. The recipients are the group's members, from `groupService.listMembers(groupId)`:

```tsx
`groupService.listMembers` returns `GroupMember[]`, whose student profile id is
`id` — **not** `studentId`. `membershipId` is the membership row's id and is the
wrong thing to notify.

```tsx
      await Promise.all(
        members.map((m) =>
          notificationService.create(
            m.id,
            t('notifications.taskAssignedTitle'),
            t('notifications.taskAssignedBody', { title: title.trim() }),
            'task_assigned',
            { assignmentId: created.id },
          ).catch((e) => console.warn('notify failed:', e)),
        ),
      );
```

Each `.catch` is deliberate: a failed notification must never make a successful assignment look failed. The same reasoning the mentor's KPI observation save already follows.

- [ ] **Step 3: On submit — to the student's mentor**

The mentor id is on `student_profiles.mentor_id`. The student's own screen can read its own row:

```tsx
      const { data } = await supabase
        .from('student_profiles').select('mentor_id').eq('id', user.id).single();
```

Skip silently when it is null — a student with no mentor linked yet is a normal state, not an error.

- [ ] **Step 4: On review — to the student**

In the mentor's review handler, mirroring `review-log.tsx`'s two-branch body: approved or revision requested, naming the task.

- [ ] **Step 5: Keys, typecheck, commit**

New `notifications` keys: `taskAssignedTitle`, `taskAssignedBody`, `taskSubmittedTitle`, `taskSubmittedBody`, `taskApprovedTitle`, `taskApprovedBody`, `taskRevisionTitle`, `taskRevisionBody`.

---

### Task 6: Verification, the session log and the device checklist

**Files:**
- Create: `docs/task-assignment-c2-device-checklist.md`
- Modify: `PROGRESS.md`

**Interfaces:** none.

- [ ] **Step 1: Sweep for the failure classes that `tsc` cannot see**

```bash
npx tsc --noEmit
npx jest --silent
```

Then, for each of the three new screens, the style check from Task 1 Step 6, and an i18n key check:

```bash
python -c "
import json, re
d = json.load(open('src/i18n/locales/en.json', encoding='utf-8'))
miss = []
for f in ['app/(advisor)/group-assignments.tsx','app/(student)/my-tasks.tsx','app/(mentor)/pending-reviews.tsx']:
    for k in set(re.findall(r\"t\('([a-zA-Z]+\.[a-zA-Z.]+)'\", open(f, encoding='utf-8').read())):
        cur = d
        for p in k.split('.'): cur = cur.get(p) if isinstance(cur, dict) else None
        if not isinstance(cur, str): miss.append((f, k))
print('missing keys:', miss or 'OK')
"
```

Then confirm no locale file but `en.json` moved, and that the three tab bars still show the counts they did before — 8 for the student, 7 each for mentor and advisor:

```bash
git diff --stat -- src/i18n/locales/
for r in student mentor advisor; do
  echo "$r: $(grep -c 'Tabs.Screen' "app/($r)/_layout.tsx") screens, $(grep -c 'href: null' "app/($r)/_layout.tsx") hidden"
done
```

- [ ] **Step 2: Write the device checklist**

`docs/task-assignment-c2-device-checklist.md`, twelve items across the three accounts, ordered so later ones use what earlier ones create. It must cover, each as its own item: the picker offering only in-scope competencies; assigning a task; the student seeing it under "to do"; submitting with a note and a linked log; the mentor seeing it with its criterion; approving it; the student's competency level moving as a result; requesting a revision instead and the student resubmitting; editing a title on an assessed assignment succeeding while editing its criterion is refused; withdrawing an unused assignment succeeding and an assessed one being refused; a student in no group seeing a plain message; and all three notifications arriving.

Add a section naming what only a device can settle here: whether the twenty-triplet picker is usable on a phone screen, and whether the criterion is readable in the mentor's review sheet without scrolling past the student's note.

- [ ] **Step 3: PROGRESS row and commit**

Append a Session row to `PROGRESS.md` in the established format, naming the three screens, the edit path, the notifications, and the device checklist file.

---

## After this plan

C2 adds no migration. The database is unchanged from C1, which is already live and verified — Part A, Part B's thirteen rows and Part C's four all green.

What remains after this is the device pass. Every RLS policy these screens depend on has been evaluated by Part C under `SET LOCAL ROLE authenticated`, so the class of failure that hid `42P17` behind two green runs is closed for these tables — but a screen that renders the wrong thing, or a picker nobody can use on a phone, is still only findable by holding one.
