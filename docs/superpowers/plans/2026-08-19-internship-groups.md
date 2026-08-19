# Internship Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin/institution/department hierarchy with advisor-owned internship groups, so an academic runs the process directly with their own interns.

**Architecture:** Two new tables (`internship_groups`, `group_memberships`) with a partial unique index carrying the one-active-group rule. Students join by group code; mentors keep linking by student code. The admin role, both institution tables and about half of partner-feedback package A are deleted. Tasks are ordered so the app compiles and runs after every one — the new data layer lands before anything is removed, and all deletion happens in a single late task once nothing references it.

**Tech Stack:** Expo SDK 54, React Native, TypeScript, Supabase (PostgREST + plpgsql RPCs), Zustand, i18next, Jest.

**Spec:** `docs/superpowers/specs/2026-08-19-internship-groups-design.md`

## Global Constraints

- **Path aliases only.** `@/…`, `@components/…`, `@services/…`. Never a relative path out of `src/`.
- **New user-facing strings go through `t()` but are written to `src/i18n/locales/en.json` ONLY.** Translation work is paused and `src/i18n/index.ts:30` sets `fallbackLng: 'en'`, so a Turkish user sees the English sentence rather than a raw key. Do not touch the other six locale files.
- **`en.json` is edited by round-tripping JSON with `json.dumps(indent=2, ensure_ascii=False)` plus a trailing newline.** Verified byte-identical to the current file, so the diff stays a pure addition.
- **RPC error codes are stable uppercase identifiers**, mapped in `src/utils/rpcErrors.ts` and parsed nowhere else.
- **Supabase SQL editor constraints** (found the hard way; the header of `docs/join-hardening-verification.sql` documents all three): only anonymous `$$` dollar tags parse — a named tag like `$probe$` fails with `42601 mismatched parentheses`; each submission gets its own connection, so a borrowed identity and the call under test must share one submission inside an explicit transaction with `is_local = true`; and a temp table is not visible to later statements in the same submission.
- **Every task ends `npx tsc --noEmit` clean and `npx jest` green.** Baseline is 4 suites / 31 tests; Task 4 reduces the count deliberately.
- **No task may leave the app non-compiling.** If a task's deletion would orphan a reference, that deletion belongs in Task 6.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `docs/internship-groups-migration.sql` | **create** — all DDL: new tables, RLS, drops, polls and leaderboard rework |
| `docs/internship-groups-rpcs.sql` | **create** — the five function definitions |
| `src/types/group.ts` | **create** — `InternshipGroup`, `GroupMembership`, `GroupMember` |
| `src/services/group.ts` | **create** — the only data layer for groups |
| `src/utils/rpcErrors.ts` | **modify** — four new codes, three removed |
| `src/utils/__tests__/rpcErrors.test.ts` | **modify** — cases for them |
| `src/utils/codes.ts` | **modify** — composite parsing removed |
| `src/utils/__tests__/codes.test.ts` | **modify** — composite cases removed |
| `src/store/groupStore.ts` | **create** — advisor's group list state |
| `app/(student)/profile.tsx` | **modify** — join by group code, plain student code |
| `app/(student)/leaderboard.tsx` | **modify** — group-scoped |
| `app/(advisor)/groups.tsx` | **create** — group list, creation, code sharing, archiving |
| `app/(advisor)/student-monitor.tsx` | **modify** — scoped to one group, off the tab bar |
| `app/(advisor)/_layout.tsx` | **modify** — `groups` takes the tab, `student-monitor` gets `href: null` |
| `app/(advisor)/profile.tsx` | **modify** — join/link block removed |
| `app/(auth)/register.tsx` | **modify** — admin role option removed |
| `src/services/gamification.ts` | **modify** — `getLeaderboard` → group-scoped RPC |
| `src/services/polls.ts` | **modify** — `institutionId` → `groupId` |
| **deleted in Task 6** | `app/(admin)/` (6 screens), `src/services/{admin,institutionCode,departmentCode,joinIssue}.ts`, `src/store/adminStore.ts`, `src/types/institution.ts`, `src/components/common/JoinIssueDialog.tsx`, `src/utils/{codeErrorAlert,emailDomain}.ts`, `src/utils/__tests__/emailDomain.test.ts` |
| `docs/internship-groups-verification.sql` | **create** — five behavioural checks |
| `PROGRESS.md` | **modify** — session log row |

---

### Task 1: Schema migration

**Files:**
- Create: `docs/internship-groups-migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `internship_groups(id, advisor_id, name, term, join_code, is_archived, created_at, updated_at)` and `group_memberships(id, group_id, student_id, joined_at, left_at)`; `polls.group_id`. Tasks 2, 3 and 7 depend on these exact column names.

You cannot run SQL against the database. Correctness is established by review and by the human applying it. Do not attempt to connect.

- [ ] **Step 1: Write the migration**

Create `docs/internship-groups-migration.sql`:

```sql
-- docs/internship-groups-migration.sql
-- Replaces the admin/institution/department hierarchy with advisor-owned
-- internship groups. See docs/superpowers/specs/2026-08-19-internship-groups-design.md
--
-- BEFORE RUNNING THIS: delete every admin account from the Supabase dashboard
-- (Authentication -> Users). profiles.id references auth.users ON DELETE
-- CASCADE and institutions.admin_id references profiles ON DELETE CASCADE, so
-- removing the auth user removes its profile, its institution and that
-- institution's departments in one step. The guard below refuses to run until
-- that is done. It deliberately does NOT delete accounts for you: a migration
-- that silently destroys user accounts is one nobody can safely re-run.
--
-- This migration is destructive by design — the project chose a clean start.
-- Existing institutions, departments, admin profiles and join-issue reports
-- are dropped along with their data.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'Admin profiles still exist. Delete those accounts in Supabase Auth first, then re-run.';
  END IF;
END $$;

-- ============================================
-- 1. Internship groups
-- ============================================
CREATE TABLE IF NOT EXISTS internship_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  term        TEXT,
  join_code   TEXT UNIQUE NOT NULL DEFAULT generate_random_code(6),
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No unique index on advisor_id. An advisor owns as many groups as they like,
-- one per term or course. This is the deliberate opposite of the dropped
-- institutions_admin_id_unique.
CREATE INDEX IF NOT EXISTS internship_groups_advisor_idx
  ON internship_groups(advisor_id);

CREATE TABLE IF NOT EXISTS group_memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at    TIMESTAMPTZ
);

-- The ENTIRE "one active group per student, history preserved" rule lives
-- here. A plain unique index would forbid history; no index at all would let
-- two active memberships exist and NOTHING would visibly break — the student
-- would simply appear in two advisors' lists. Verification row 3 exists
-- specifically to prove this index is present and correct.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_group_per_student
  ON group_memberships(student_id) WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS group_memberships_group_idx
  ON group_memberships(group_id) WHERE left_at IS NULL;

-- ============================================
-- 2. RLS
-- ============================================
ALTER TABLE internship_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group owner and members read" ON internship_groups;
CREATE POLICY "group owner and members read" ON internship_groups
  FOR SELECT TO authenticated USING (
    advisor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM group_memberships m
      WHERE m.group_id = internship_groups.id
        AND m.student_id = auth.uid()
        AND m.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "advisor creates own group" ON internship_groups;
CREATE POLICY "advisor creates own group" ON internship_groups
  FOR INSERT TO authenticated WITH CHECK (
    advisor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'advisor')
  );

DROP POLICY IF EXISTS "advisor updates own group" ON internship_groups;
CREATE POLICY "advisor updates own group" ON internship_groups
  FOR UPDATE TO authenticated USING (advisor_id = auth.uid());

-- No DELETE policy. Archiving (is_archived) is the retirement mechanism;
-- deleting a group would cascade its memberships away and orphan the term's
-- history, which is the one thing the membership table exists to keep.

-- No INSERT policy on group_memberships: join_group_by_code is the only write
-- path. It is SECURITY DEFINER and runs as the table owner, so it writes
-- regardless. A direct INSERT would let a client join any group by guessing a
-- UUID, skipping the archived-group check entirely.
DROP POLICY IF EXISTS "membership insert" ON group_memberships;

DROP POLICY IF EXISTS "membership read" ON group_memberships;
CREATE POLICY "membership read" ON group_memberships
  FOR SELECT TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM internship_groups g
      WHERE g.id = group_memberships.group_id AND g.advisor_id = auth.uid()
    )
  );

-- The advisor closes a membership by setting left_at. Never a delete: the
-- student's logs and their term history hang off this row.
DROP POLICY IF EXISTS "advisor closes membership" ON group_memberships;
CREATE POLICY "advisor closes membership" ON group_memberships
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM internship_groups g
      WHERE g.id = group_memberships.group_id AND g.advisor_id = auth.uid()
    )
  );

-- ============================================
-- 3. Polls move from institution scope to group scope
-- ============================================
ALTER TABLE polls DROP COLUMN IF EXISTS institution_id;
ALTER TABLE polls
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES internship_groups(id) ON DELETE CASCADE;

-- ============================================
-- 4. Leaderboard drops its free-text university scoping
-- ============================================
-- The columns were copied from student_profiles and matched as strings, so a
-- student who typed "BTU" never appeared alongside one who typed "Bursa
-- Teknik Universitesi". Group scoping replaces them (get_my_group_leaderboard
-- in docs/internship-groups-rpcs.sql). Replace the sync function BEFORE
-- dropping the columns it writes.
CREATE OR REPLACE FUNCTION sync_leaderboard_public_from_student()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO leaderboard_public (
    id, total_xp, current_level, current_streak,
    first_name, last_name, avatar_url, updated_at
  )
  SELECT
    NEW.id,
    NEW.total_xp,
    NEW.current_level,
    NEW.current_streak,
    COALESCE(p.first_name, ''),
    COALESCE(p.last_name, ''),
    p.avatar_url,
    NOW()
  FROM profiles_public p
  WHERE p.id = NEW.id
  ON CONFLICT (id) DO UPDATE SET
    total_xp       = EXCLUDED.total_xp,
    current_level  = EXCLUDED.current_level,
    current_streak = EXCLUDED.current_streak,
    first_name     = EXCLUDED.first_name,
    last_name      = EXCLUDED.last_name,
    avatar_url     = EXCLUDED.avatar_url,
    updated_at     = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE leaderboard_public DROP COLUMN IF EXISTS university;
ALTER TABLE leaderboard_public DROP COLUMN IF EXISTS faculty;
ALTER TABLE leaderboard_public DROP COLUMN IF EXISTS department;

-- ============================================
-- 5. Retire the institution hierarchy
-- ============================================
-- The profiles_select policy (docs/admin-migration.sql:433-439) calls
-- is_admin_of_institution(id). Postgres records a hard dependency from a
-- policy's qual to the functions it calls, so DROP FUNCTION without CASCADE
-- fails and halts the whole script before the table drops. Replace the policy
-- first, minus the admin disjunct — there are no admins any more.
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR is_mentor_of(id)
    OR is_advisor_of(id)
  );

-- These two read profiles.institution_id and join institutions/departments,
-- so they break the moment the columns below are dropped. Dropping rather
-- than leaving them broken also lets docs/internship-groups-rpcs.sql recreate
-- get_my_student_code with a one-column result: CREATE OR REPLACE cannot
-- change a function's return type, so it MUST be dropped first.
DROP FUNCTION IF EXISTS get_my_student_code();
DROP FUNCTION IF EXISTS link_student_by_code(TEXT, TEXT);

DROP FUNCTION IF EXISTS report_join_issue(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS join_institution_by_code(TEXT);
DROP FUNCTION IF EXISTS validate_institution_code(TEXT);
DROP FUNCTION IF EXISTS join_department_by_code(TEXT);
DROP FUNCTION IF EXISTS validate_department_code(TEXT);
DROP FUNCTION IF EXISTS regenerate_institution_code(UUID);
DROP FUNCTION IF EXISTS is_admin_of_institution(UUID);
DROP FUNCTION IF EXISTS is_admin();

ALTER TABLE profiles DROP COLUMN IF EXISTS institution_id;
ALTER TABLE profiles DROP COLUMN IF EXISTS department_id;

DROP TABLE IF EXISTS join_issue_reports;
DROP TABLE IF EXISTS admin_profiles;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS institutions;

-- Only now, with no admin rows and no admin-only objects left.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student', 'mentor', 'advisor'));
```

- [ ] **Step 2: Verify the drop order is internally consistent**

Every dropped table must be dropped after anything referencing it. Run:

```bash
grep -n "REFERENCES institutions\|REFERENCES departments" docs/admin-migration.sql docs/join-hardening-migration.sql docs/phase5-polls-realtime-migration.sql
```

Every hit must be a table this migration drops (`departments`, `admin_profiles`, `join_issue_reports`) or a column it drops first (`profiles.institution_id`, `profiles.department_id`, `polls.institution_id`). If a hit names something else, that reference will block `DROP TABLE institutions` — add its column drop above section 5 and report it.

- [ ] **Step 3: Confirm no named dollar tags**

Run:

```bash
grep -nE '\$[a-zA-Z_]+\$' docs/internship-groups-migration.sql
```

Expected: no output. A named tag fails in the Supabase editor with `42601`.

- [ ] **Step 4: Commit**

```bash
git add docs/internship-groups-migration.sql
git commit -m "feat: schema for advisor-owned internship groups

Two tables replace the institution/department hierarchy. The
one-active-group-per-student rule lives entirely in a partial unique
index, called out in a comment because a wrong index fails silently:
nothing visibly breaks, the student just appears in two advisors' lists.

The migration refuses to run while admin profiles exist rather than
deleting accounts itself. A migration that silently destroys user
accounts is one nobody can safely re-run.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**NOTE FOR THE CONTROLLER:** the human must delete admin accounts in the Supabase dashboard and apply this migration before Task 7's verification can run. Flag it; do not block Tasks 2-6 on it.

---

### Task 2: The RPCs

**Files:**
- Create: `docs/internship-groups-rpcs.sql`

**Interfaces:**
- Consumes: the tables from Task 1.
- Produces:
  - `validate_group_code(p_code TEXT)` → `TABLE(id UUID, name TEXT, term TEXT, advisor_name TEXT)`
  - `join_group_by_code(p_code TEXT)` → same shape; raises `INVALID_CODE`, `GROUP_ARCHIVED`, `NOT_AUTHENTICATED`, `ROLE_NOT_ALLOWED`
  - `link_student_by_code(p_code TEXT, p_role TEXT)` → `TABLE(student_id UUID, student_name TEXT)`, mentor-only
  - `get_my_student_code()` → `TABLE(code TEXT)`
  - `get_my_group_leaderboard(p_limit INT)` → `TABLE(id UUID, total_xp INT, current_level INT, current_streak INT, first_name TEXT, last_name TEXT, avatar_url TEXT)`

  Task 3 wraps all five.

- [ ] **Step 1: Write the file**

Create `docs/internship-groups-rpcs.sql`:

```sql
-- docs/internship-groups-rpcs.sql
-- Run AFTER docs/internship-groups-migration.sql. Idempotent.

-- ============================================
-- 1. Inspect a group code without joining
-- ============================================
CREATE OR REPLACE FUNCTION validate_group_code(p_code TEXT)
RETURNS TABLE (id UUID, name TEXT, term TEXT, advisor_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  RETURN QUERY
    SELECT g.id, g.name, g.term,
           trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    FROM internship_groups g
    JOIN profiles p ON p.id = g.advisor_id
    WHERE g.join_code = upper(trim(p_code))
      AND g.is_archived = false
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_group_code(TEXT) TO authenticated;

-- ============================================
-- 2. Join a group
-- ============================================
CREATE OR REPLACE FUNCTION join_group_by_code(p_code TEXT)
RETURNS TABLE (id UUID, name TEXT, term TEXT, advisor_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_group UUID;
  archived     BOOLEAN;
  target_advisor UUID;
  caller_role  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT role INTO caller_role FROM profiles WHERE profiles.id = auth.uid();
  IF caller_role <> 'student' THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  SELECT g.id, g.is_archived, g.advisor_id
  INTO target_group, archived, target_advisor
  FROM internship_groups g
  WHERE g.join_code = upper(trim(p_code))
  LIMIT 1;

  IF target_group IS NULL THEN
    RAISE EXCEPTION 'INVALID_CODE';
  END IF;

  IF archived THEN
    RAISE EXCEPTION 'GROUP_ARCHIVED';
  END IF;

  -- Close any current membership first. The partial unique index would
  -- reject the insert below otherwise, and closing rather than deleting is
  -- what preserves the previous term's logs and reviews.
  UPDATE group_memberships m
  SET left_at = now()
  WHERE m.student_id = auth.uid() AND m.left_at IS NULL;

  INSERT INTO group_memberships (group_id, student_id)
  VALUES (target_group, auth.uid());

  -- Everything the advisor's existing screens read hangs off advisor_id, so
  -- validation, student-monitor and reports keep working unchanged.
  UPDATE student_profiles sp
  SET advisor_id = target_advisor
  WHERE sp.id = auth.uid();

  RETURN QUERY
    SELECT g.id, g.name, g.term,
           trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    FROM internship_groups g
    JOIN profiles p ON p.id = g.advisor_id
    WHERE g.id = target_group;
END;
$$;

GRANT EXECUTE ON FUNCTION join_group_by_code(TEXT) TO authenticated;

-- ============================================
-- 3. Link a student — mentors only
-- ============================================
-- docs/internship-groups-migration.sql dropped the previous definitions of
-- this and get_my_student_code, so these are creates, not replaces. That drop
-- is required rather than tidy: get_my_student_code goes from five result
-- columns to one, and CREATE OR REPLACE cannot change a return type.
-- The advisor branch is gone: advisors acquire students through group
-- membership and never link individually. INSTITUTION_MISMATCH and the
-- composite-code segment checks went with the institution model.
CREATE OR REPLACE FUNCTION link_student_by_code(p_code TEXT, p_role TEXT)
RETURNS TABLE (student_id UUID, student_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_code     TEXT;
  student_uuid UUID;
  code_active  BOOLEAN;
  caller_role  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT role INTO caller_role FROM profiles WHERE profiles.id = auth.uid();

  IF caller_role <> 'mentor' THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  raw_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));

  IF length(raw_code) <> 6 THEN
    RAISE EXCEPTION 'INVALID_CODE_FORMAT';
  END IF;

  SELECT sc.student_id, sc.is_active
  INTO student_uuid, code_active
  FROM student_codes sc
  WHERE sc.code = raw_code
  ORDER BY sc.is_active DESC, sc.created_at DESC
  LIMIT 1;

  IF student_uuid IS NULL THEN
    RAISE EXCEPTION 'INVALID_CODE';
  END IF;

  IF code_active IS NOT TRUE THEN
    RAISE EXCEPTION 'EXPIRED_CODE';
  END IF;

  UPDATE student_profiles sp SET mentor_id = auth.uid() WHERE sp.id = student_uuid;

  RETURN QUERY
    SELECT p.id, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    FROM profiles p WHERE p.id = student_uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION link_student_by_code(TEXT, TEXT) TO authenticated;

-- ============================================
-- 4. The student's own code — no composite parts any more
-- ============================================
CREATE OR REPLACE FUNCTION get_my_student_code()
RETURNS TABLE (code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  RETURN QUERY
    SELECT sc.code
    FROM student_codes sc
    WHERE sc.student_id = auth.uid() AND sc.is_active = true
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_student_code() TO authenticated;

-- ============================================
-- 5. Leaderboard, scoped to the caller's active group
-- ============================================
-- The caller's group is resolved internally rather than passed in, so nobody
-- can read another group's ranking by supplying its id.
CREATE OR REPLACE FUNCTION get_my_group_leaderboard(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id             UUID,
  total_xp       INTEGER,
  current_level  INTEGER,
  current_streak INTEGER,
  first_name     TEXT,
  last_name      TEXT,
  avatar_url     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_group UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT m.group_id INTO my_group
  FROM group_memberships m
  WHERE m.student_id = auth.uid() AND m.left_at IS NULL
  LIMIT 1;

  -- A student who has not joined a group yet sees an empty board, not an
  -- error: the leaderboard is a dashboard tab, not an action they took.
  IF my_group IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT lp.id, lp.total_xp, lp.current_level, lp.current_streak,
           lp.first_name, lp.last_name, lp.avatar_url
    FROM leaderboard_public lp
    JOIN group_memberships m
      ON m.student_id = lp.id AND m.left_at IS NULL
    WHERE m.group_id = my_group
    ORDER BY lp.total_xp DESC
    LIMIT greatest(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_group_leaderboard(INT) TO authenticated;
```

- [ ] **Step 2: Confirm no named dollar tags**

Run:

```bash
grep -nE '\$[a-zA-Z_]+\$' docs/internship-groups-rpcs.sql
```

Expected: no output.

- [ ] **Step 3: Confirm every OUT parameter name is qualified in the body**

`RETURNS TABLE (id UUID, ...)` creates a PL/pgSQL variable named `id`. An unqualified `WHERE id = auth.uid()` is ambiguous against a table column and raises `42702` — a real bug that shipped in this codebase and went unnoticed for months, because every rejection path raised before reaching the ambiguous statement, so the functions only failed when they were supposed to *succeed*. Run:

```bash
grep -nE "WHERE (id|name|code|total_xp|current_level|current_streak|first_name|last_name|avatar_url|term|student_id|student_name) " docs/internship-groups-rpcs.sql
```

Expected: no output. Every such reference in the file above is written `p.id`, `sc.code`, `m.student_id`, `sp.id`, `g.id`, `profiles.id` or `lp.id`. If you add a statement, qualify it.

- [ ] **Step 4: Commit**

```bash
git add docs/internship-groups-rpcs.sql
git commit -m "feat: RPCs for joining groups and mentor-only student linking

join_group_by_code closes any current membership before opening the new
one — the partial unique index would reject the insert otherwise, and
closing rather than deleting is what preserves the previous term's logs.

link_student_by_code loses its advisor branch entirely. Advisors now
acquire students through group membership, so INSTITUTION_MISMATCH and
the composite-code segment checks go with the institution model.

get_my_group_leaderboard resolves the caller's group internally rather
than taking it as a parameter, so nobody can read another group's
ranking by supplying its id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Types, service and error codes

**Files:**
- Create: `src/types/group.ts`
- Create: `src/services/group.ts`
- Create: `src/store/groupStore.ts`
- Modify: `src/utils/rpcErrors.ts`
- Modify: `src/utils/__tests__/rpcErrors.test.ts`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: the RPCs from Task 2.
- Produces:
  - `InternshipGroup { id, advisorId, name, term?, joinCode, isArchived, createdAt, updatedAt }`
  - `GroupSummary { id, name, term?, advisorName }` — what the two code RPCs return
  - `GroupMember { id, firstName, lastName, email, avatarUrl?, joinedAt }`
  - `groupService.{ listMyGroups, createGroup, setArchived, listMembers, countMembersByGroup, closeMembership, validateCode, joinByCode, getMyGroup }`
  - `useGroupStore` with `{ groups, activeGroup, fetchGroups, setActiveGroup }`
  - error codes `GROUP_ARCHIVED`, `GROUP_NOT_FOUND`
  Tasks 4, 5 and 7 use these exact names.

This task is purely additive — nothing existing references it yet, so the app keeps compiling.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('mapRpcError', …)` block of `src/utils/__tests__/rpcErrors.test.ts`:

```ts
  it('maps GROUP_ARCHIVED', () => {
    expect(mapRpcError('GROUP_ARCHIVED')).toEqual({
      code: 'GROUP_ARCHIVED',
      key: 'errors.groupArchived',
    });
  });

  it('maps GROUP_NOT_FOUND', () => {
    expect(mapRpcError('GROUP_NOT_FOUND')).toEqual({
      code: 'GROUP_NOT_FOUND',
      key: 'errors.groupNotFound',
    });
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest rpcErrors -t GROUP_ARCHIVED`
Expected: FAIL — received `{ code: 'UNKNOWN', key: 'errors.unknown' }`.

- [ ] **Step 3: Add the codes**

In `src/utils/rpcErrors.ts`, add to `ERROR_KEYS` after `NOTE_TOO_LONG`:

```ts
  GROUP_ARCHIVED: 'errors.groupArchived',
  GROUP_NOT_FOUND: 'errors.groupNotFound',
```

Leave the existing entries alone; Task 6 removes the dead ones.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest`
Expected: 4 suites, 33 tests.

- [ ] **Step 5: Add the English strings**

Add to the `errors` object in `src/i18n/locales/en.json` only:

```
"groupArchived": "That group has been archived and is no longer accepting students.",
"groupNotFound": "No group found with that code. Check it with your advisor."
```

Add to the `advisor` object:

```
"myGroups": "My Groups",
"noGroups": "You have no groups yet. Create one and share its code with your students.",
"createGroup": "Create group",
"groupName": "Group name",
"groupNamePlaceholder": "e.g. Computer Eng. Summer Internship",
"groupTerm": "Term (optional)",
"groupTermPlaceholder": "e.g. 2026 Fall",
"groupNameRequired": "A group name is required.",
"joinCode": "Join code",
"joinCodeCopied": "Join code copied to clipboard.",
"joinCodeHint": "Share this code with your students so they can join this group.",
"memberCount": "{{count}} students",
"viewStudents": "View students",
"archive": "Archive",
"unarchive": "Unarchive",
"archived": "Archived",
"archiveConfirm": "Archive {{name}}? Its code stops working and no new students can join. Existing members and their history are kept.",
"removeStudent": "Remove from group",
"removeStudentConfirm": "Remove {{name}} from this group? Their logs and history are kept.",
"removeStudentDone": "Student removed from the group."
```

Add to the `student` object:

```
"joinGroup": "Join your advisor's group",
"joinGroupHint": "Enter the code your advisor gave you.",
"groupCodePlaceholder": "6-character code",
"join": "Join",
"joinedGroup": "You joined {{name}}.",
"myGroup": "My group",
"noGroupYet": "You have not joined a group yet."
```

- [ ] **Step 6: Write the types**

Create `src/types/group.ts`:

```ts
export interface InternshipGroup {
  id: string;
  advisorId: string;
  name: string;
  term?: string;
  joinCode: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What validate_group_code and join_group_by_code return — no join code,
 *  because a student who has not joined yet must not be handed one. */
export interface GroupSummary {
  id: string;
  name: string;
  term?: string;
  advisorName: string;
}

export interface GroupMember {
  membershipId: string;
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string;
  joinedAt: string;
}
```

Export them from `src/types/index.ts` following the existing barrel style in that file.

- [ ] **Step 7: Write the service**

Create `src/services/group.ts`:

```ts
import { supabase } from './supabase';
import { RpcError } from './rpcError';
import type { InternshipGroup, GroupSummary, GroupMember } from '@/types/group';

function mapGroup(row: Record<string, unknown>): InternshipGroup {
  return {
    id: row.id as string,
    advisorId: (row.advisor_id as string) || '',
    name: (row.name as string) || '',
    term: (row.term as string) || undefined,
    joinCode: (row.join_code as string) || '',
    isArchived: (row.is_archived as boolean) ?? false,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

function mapSummary(row: Record<string, unknown>): GroupSummary {
  return {
    id: row.id as string,
    name: (row.name as string) || '',
    term: (row.term as string) || undefined,
    advisorName: (row.advisor_name as string) || '',
  };
}

export const groupService = {
  async listMyGroups(advisorId: string): Promise<InternshipGroup[]> {
    const { data, error } = await supabase
      .from('internship_groups')
      .select('*')
      .eq('advisor_id', advisorId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => mapGroup(r as Record<string, unknown>));
  },

  async createGroup(
    advisorId: string,
    data: { name: string; term?: string },
  ): Promise<InternshipGroup> {
    const { data: row, error } = await supabase
      .from('internship_groups')
      .insert({ advisor_id: advisorId, name: data.name, term: data.term || null })
      .select()
      .single();
    if (error) throw error;
    return mapGroup(row as Record<string, unknown>);
  },

  async setArchived(groupId: string, isArchived: boolean): Promise<void> {
    const { error } = await supabase
      .from('internship_groups')
      .update({ is_archived: isArchived, updated_at: new Date().toISOString() })
      .eq('id', groupId);
    if (error) throw error;
  },

  async listMembers(groupId: string): Promise<GroupMember[]> {
    const { data, error } = await supabase
      .from('group_memberships')
      .select('id, joined_at, student:profiles!group_memberships_student_id_fkey(id, first_name, last_name, email, avatar_url)')
      .eq('group_id', groupId)
      .is('left_at', null)
      .order('joined_at', { ascending: true });
    if (error) throw error;

    return (data || []).map((row) => {
      const r = row as Record<string, unknown>;
      const s = (r.student || {}) as Record<string, unknown>;
      return {
        membershipId: r.id as string,
        id: (s.id as string) || '',
        firstName: (s.first_name as string) || '',
        lastName: (s.last_name as string) || '',
        email: (s.email as string) || '',
        avatarUrl: (s.avatar_url as string) || undefined,
        joinedAt: (r.joined_at as string) || '',
      };
    });
  },

  /** One query for the whole screen rather than one per group card. */
  async countMembersByGroup(): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('group_memberships')
      .select('group_id')
      .is('left_at', null);
    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const row of data || []) {
      const id = (row as Record<string, unknown>).group_id as string;
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  },

  /** Closing, never deleting: the student's logs and term history hang off
   *  this row. */
  async closeMembership(membershipId: string): Promise<void> {
    const { error } = await supabase
      .from('group_memberships')
      .update({ left_at: new Date().toISOString() })
      .eq('id', membershipId);
    if (error) throw error;
  },

  async validateCode(code: string): Promise<GroupSummary | null> {
    const { data, error } = await supabase.rpc('validate_group_code', {
      p_code: code.toUpperCase().trim(),
    });
    if (error) throw new RpcError(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return mapSummary(row as Record<string, unknown>);
  },

  async joinByCode(code: string): Promise<GroupSummary> {
    const { data, error } = await supabase.rpc('join_group_by_code', {
      p_code: code.toUpperCase().trim(),
    });
    if (error) throw new RpcError(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new RpcError('GROUP_NOT_FOUND');
    return mapSummary(row as Record<string, unknown>);
  },

  /** The student's own active group, or null before they have joined one. */
  async getMyGroup(studentId: string): Promise<GroupSummary | null> {
    const { data, error } = await supabase
      .from('group_memberships')
      .select('group:internship_groups(id, name, term, advisor:profiles!internship_groups_advisor_id_fkey(first_name, last_name))')
      .eq('student_id', studentId)
      .is('left_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const g = ((data as Record<string, unknown>).group || {}) as Record<string, unknown>;
    const a = (g.advisor || {}) as Record<string, unknown>;
    return {
      id: (g.id as string) || '',
      name: (g.name as string) || '',
      term: (g.term as string) || undefined,
      advisorName: `${(a.first_name as string) || ''} ${(a.last_name as string) || ''}`.trim(),
    };
  },
};
```

**If the PostgREST embed hints in `listMembers` or `getMyGroup` are rejected at runtime**, the constraint name differs from the guess. Do not fight it — read the real name with the SQL below and use it, then report which you used.

```sql
SELECT conname FROM pg_constraint
WHERE conrelid IN ('group_memberships'::regclass, 'internship_groups'::regclass)
  AND contype = 'f';
```

- [ ] **Step 8: Write the store**

Create `src/store/groupStore.ts`, following the shape of the existing stores in that directory:

```ts
import { create } from 'zustand';
import { groupService } from '@/services/group';
import type { InternshipGroup } from '@/types/group';

interface GroupState {
  groups: InternshipGroup[];
  activeGroup: InternshipGroup | null;
  isLoading: boolean;
  fetchGroups: (advisorId: string) => Promise<void>;
  setActiveGroup: (group: InternshipGroup | null) => void;
  reset: () => void;
}

export const useGroupStore = create<GroupState>((set) => ({
  groups: [],
  activeGroup: null,
  isLoading: false,

  fetchGroups: async (advisorId: string) => {
    set({ isLoading: true });
    try {
      const groups = await groupService.listMyGroups(advisorId);
      set({ groups });
    } finally {
      set({ isLoading: false });
    }
  },

  setActiveGroup: (group) => set({ activeGroup: group }),
  reset: () => set({ groups: [], activeGroup: null, isLoading: false }),
}));
```

Wire `reset()` into the SIGNED_OUT handler alongside the other stores. Find it with:

```bash
grep -rn "SIGNED_OUT" app/ src/
```

Every store reset there must gain `useGroupStore.getState().reset()`. Missing it leaks one advisor's groups into the next account signed in on the same device — the exact class of bug fixed in Session 11.

- [ ] **Step 9: Typecheck, test and commit**

```bash
npx tsc --noEmit && npx jest --silent
git add src/types/group.ts src/types/index.ts src/services/group.ts src/store/groupStore.ts src/utils/rpcErrors.ts src/utils/__tests__/rpcErrors.test.ts src/i18n/locales/en.json
git commit -m "feat: group types, service and store

Purely additive — nothing references these yet, so the app keeps
compiling while the old model is still in place.

GroupSummary deliberately omits the join code: it is what the two code
RPCs return, and a student who has not joined yet must not be handed a
code they could reshare.

closeMembership sets left_at rather than deleting, because the student's
logs and term history hang off that row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Student side and the student-code shape

**Files:**
- Modify: `app/(student)/profile.tsx` (join block around line 543, student-code block around lines 576-620, `JoinIssueDialog` at 819)
- Modify: `app/(student)/leaderboard.tsx`
- Modify: `src/services/gamification.ts:38-51`
- Modify: `src/services/studentCode.ts`
- Modify: `src/services/polls.ts:14,26,67`
- Modify: `src/utils/codes.ts`
- Modify: `src/utils/__tests__/codes.test.ts`
- Modify: `app/(mentor)/student-list.tsx:26,79`
- Modify: `app/(advisor)/profile.tsx:28,47` — the link block

**Interfaces:**
- Consumes: `groupService`, `GroupSummary` (Task 3).
- Produces: `parseStudentCode(input) → { kind: 'valid'; studentCode: string } | { kind: 'invalid'; reason: 'EMPTY' | 'LENGTH' }`; `gamificationService.getGroupLeaderboard(limit?)`; `pollsService` using `groupId`. Nothing later depends on these.

**This task owns every caller of `parseStudentCode`.** Changing its return shape without updating `app/(mentor)/student-list.tsx` and `app/(advisor)/profile.tsx` in the same commit leaves `tsc` broken between tasks, which Global Constraints forbid. Steps 6b and 6c handle them.

- [ ] **Step 1: Rewrite the code tests**

Replace the whole of `src/utils/__tests__/codes.test.ts` with:

```ts
import { normalizeCode, parseStudentCode, STUDENT_CODE_LENGTH } from '@/utils/codes';

describe('normalizeCode', () => {
  it('uppercases and strips every whitespace character', () => {
    expect(normalizeCode(' h94 fqv \n')).toBe('H94FQV');
  });

  it('returns an empty string for whitespace only', () => {
    expect(normalizeCode('   ')).toBe('');
  });
});

describe('parseStudentCode', () => {
  it('accepts a six-character code', () => {
    expect(parseStudentCode('H94FQV')).toEqual({ kind: 'valid', studentCode: 'H94FQV' });
  });

  it('normalises before validating', () => {
    expect(parseStudentCode(' h94 fqv ')).toEqual({ kind: 'valid', studentCode: 'H94FQV' });
  });

  it('rejects an empty code', () => {
    expect(parseStudentCode('')).toEqual({ kind: 'invalid', reason: 'EMPTY' });
  });

  it('rejects a short code', () => {
    expect(parseStudentCode('H94FQ')).toEqual({ kind: 'invalid', reason: 'LENGTH' });
  });

  it('rejects a long code', () => {
    expect(parseStudentCode('H94FQVX')).toEqual({ kind: 'invalid', reason: 'LENGTH' });
  });

  it('rejects a composite code, which no longer exists', () => {
    // The old INSTITUTION_DEPARTMENT_STUDENT format. Two of its three
    // segments were deleted with the institution model; anything still
    // carrying underscores is stale input, not a code.
    expect(parseStudentCode('7BW8HH29_H94FQV_ABC123')).toEqual({
      kind: 'invalid',
      reason: 'LENGTH',
    });
  });

  it('exposes the code length it enforces', () => {
    expect(STUDENT_CODE_LENGTH).toBe(6);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest codes`
Expected: FAIL — the current `parseStudentCode` returns `{ kind: 'short', … }`.

- [ ] **Step 3: Rewrite `src/utils/codes.ts`**

Replace the whole file with:

```ts
export const STUDENT_CODE_LENGTH = 6;

export type ParsedStudentCode =
  | { kind: 'valid'; studentCode: string }
  | { kind: 'invalid'; reason: 'EMPTY' | 'LENGTH' };

/** Uppercase, trim, and drop every whitespace character a paste may carry. */
export function normalizeCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/**
 * Validates the SHAPE of a student code only. Whether the code belongs to a
 * real, active student is decided server-side in link_student_by_code. Never
 * move that check here.
 */
export function parseStudentCode(input: string): ParsedStudentCode {
  const code = normalizeCode(input);
  if (!code) return { kind: 'invalid', reason: 'EMPTY' };
  if (code.length !== STUDENT_CODE_LENGTH) return { kind: 'invalid', reason: 'LENGTH' };
  return { kind: 'valid', studentCode: code };
}
```

`INSTITUTION_CODE_LENGTH`, `DEPARTMENT_CODE_LENGTH` and `buildCompositeStudentCode` are gone. Task 6 removes their last consumers; if `tsc` complains here, note it and continue — the callers are handled in Steps 5 and 6.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest codes`
Expected: PASS, 8 tests in that file.

- [ ] **Step 5: Simplify `studentCode.ts`**

In `src/services/studentCode.ts`, drop the `buildCompositeStudentCode` import and rewrite `getMyCodeDetails` so it returns only the code — `get_my_student_code` no longer returns institution or department columns:

```ts
  async getMyCodeDetails(): Promise<{ code: string } | null> {
    const { data, error } = await supabase.rpc('get_my_student_code');
    if (error) throw new RpcError(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row) return null;
    return { code: (row.code as string) || '' };
  },
```

Remove the `StudentCodeDetails` import if nothing else in the file uses it.

- [ ] **Step 6: Rewrite the student profile's two blocks**

In `app/(student)/profile.tsx`:

Replace the `departmentCodeService` import with `import { groupService } from '@/services/group';`, and delete the `JoinIssueDialog` and `showCodeErrorAlert` imports along with the `<JoinIssueDialog … />` element near line 819 and the `issueReport` state that feeds it.

The join handler around line 543 becomes:

```tsx
                onPress={async () => {
                  setJoining(true);
                  try {
                    const group = await groupService.joinByCode(groupCodeInput.trim());
                    setGroupCodeInput('');
                    await loadData();
                    Alert.alert(
                      t('common.done'),
                      t('student.joinedGroup', { name: group.name }),
                    );
                  } catch (error: any) {
                    const info = mapRpcError(error?.message);
                    Alert.alert(t('common.error'), t(info.key));
                  } finally {
                    setJoining(false);
                  }
                }}
```

with `import { mapRpcError } from '@/utils/rpcErrors';` added, `deptCodeInput`/`setDeptCodeInput` renamed to `groupCodeInput`/`setGroupCodeInput`, and a `joining` boolean state. The input's `maxLength` becomes `6`, its label `t('student.joinGroup')`, its hint `t('student.joinGroupHint')`, and its placeholder `t('student.groupCodePlaceholder')`.

The student-code block around lines 576-620 loses its composite branch:

```tsx
              <Text style={styles.codeText}>{studentCode.code}</Text>
```

and the `studentCode.compositeCode ? … : …` conditional beneath it is replaced by the group line, using the group loaded in `loadData` via `groupService.getMyGroup(user.id)` into a `myGroup` state:

```tsx
              {myGroup ? (
                <Text style={styles.codeSubtitle}>
                  {myGroup.name}{myGroup.term ? ` · ${myGroup.term}` : ''}
                </Text>
              ) : (
                <Text style={styles.codeSubtitle}>{t('student.noGroupYet')}</Text>
              )}
```

The clipboard copy at line 584 copies `studentCode.code` — there is no composite to prefer any more.

- [ ] **Step 6b: Update the mentor's link form to the new code shape**

`app/(mentor)/student-list.tsx:79` reads `const codeShape = parseStudentCode(codeInput);` and branches on `codeShape.kind`. The two accepting kinds `'short'` and `'composite'` collapse into one:

```tsx
  const codeShape = parseStudentCode(codeInput);
  const codeLooksValid = codeShape.kind === 'valid';
```

Replace every `codeShape.kind === 'short' || codeShape.kind === 'composite'` with `codeLooksValid`, and drop the input's `maxLength={22}` back to `maxLength={6}` — 22 existed only to make a composite code typeable.

- [ ] **Step 6c: Remove the advisor's link-student block**

`app/(advisor)/profile.tsx:28,47` still imports and calls `parseStudentCode` for a link form. `link_student_by_code` is mentor-only as of Task 2, so that form can no longer succeed. Delete the import, the `codeShape` line, the link handler and its UI. The advisor's join-by-department block in the same file is removed in Task 5 Step 4; leave it alone here so the two tasks do not collide in the same lines.

- [ ] **Step 7: Point the leaderboard at the group RPC**

In `src/services/gamification.ts`, replace `getLeaderboard` with:

```ts
  async getGroupLeaderboard(limit = 50) {
    const { data, error } = await supabase.rpc('get_my_group_leaderboard', {
      p_limit: limit,
    });
    if (error) throw error;
    return data || [];
  },
```

In `app/(student)/leaderboard.tsx`, replace the `getLeaderboard(limit, university, department)` call with `getGroupLeaderboard(limit)` and delete any university/department filter UI and state it fed. A student with no group gets an empty array — render the existing empty state, not an error.

- [ ] **Step 7b: Move polls from institution scope to group scope**

`src/services/polls.ts` still carries the dropped column. Three edits:

```ts
// line 14, in the Poll interface
  groupId?: string;

// line 26, in the row mapper
    groupId: (row.group_id as string) || undefined,

// line 67, in the insert
        group_id: poll.groupId || null,
```

Then sweep for screens that set it:

```bash
grep -rn "institutionId" app/ src/
```

Every remaining hit outside files this plan deletes in Task 6 must become `groupId`. Report any you find.

- [ ] **Step 8: Typecheck, test and commit**

```bash
npx tsc --noEmit && npx jest --silent
git add src/utils/codes.ts src/utils/__tests__/codes.test.ts src/services/studentCode.ts src/services/gamification.ts src/services/polls.ts app/\(student\)/profile.tsx app/\(student\)/leaderboard.tsx app/\(mentor\)/student-list.tsx app/\(advisor\)/profile.tsx
git commit -m "feat: students join a group instead of a department

The composite student code goes with the institution model that gave it
its two leading segments; parseStudentCode drops to a single shape check
and the profile shows the plain six-character code with the student's
group beneath it.

The leaderboard moves from free-text university matching — where a
student who typed BTU never appeared alongside one who typed Bursa
Teknik Universitesi — to the group they actually belong to.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Advisor side

**Files:**
- Create: `app/(advisor)/groups.tsx`
- Modify: `app/(advisor)/_layout.tsx:41-48`
- Modify: `app/(advisor)/student-monitor.tsx`
- Modify: `app/(advisor)/profile.tsx` (join block around line 399, `JoinIssueDialog` at 643)

**Interfaces:**
- Consumes: `groupService`, `useGroupStore`, `InternshipGroup`, `GroupMember` (Task 3).
- Produces: the route `/(advisor)/groups`. Nothing later depends on it.

- [ ] **Step 1: Write the groups screen**

Create `app/(advisor)/groups.tsx`. It follows the layout conventions of the other advisor screens — `SafeAreaView` + `ScrollView` + `RefreshControl` — and reuses the advisor accent colour defined in `app/(advisor)/dashboard.tsx`. Styles follow the card/`linkRow`/`linkInput`/`linkBtn` pattern already used across this codebase's management screens.

```tsx
import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '@/store/authStore';
import { useGroupStore } from '@/store/groupStore';
import { groupService } from '@/services/group';
import { colors, spacing, borderRadius } from '@/theme';
import type { InternshipGroup } from '@/types/group';

const ADVISOR_COLOR = colors.info;

export default function AdvisorGroupsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { groups, fetchGroups } = useGroupStore();

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [term, setTerm] = useState('');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      await fetchGroups(user.id);
      setCounts(await groupService.countMembersByGroup());
    } catch (err) {
      console.error('Groups load error:', err);
    }
  }, [user, fetchGroups]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  async function handleCreate() {
    if (!user) return;
    if (!name.trim()) {
      Alert.alert(t('common.error'), t('advisor.groupNameRequired'));
      return;
    }
    setCreating(true);
    try {
      await groupService.createGroup(user.id, {
        name: name.trim(),
        term: term.trim() || undefined,
      });
      setName('');
      setTerm('');
      await loadData();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.unknown'));
    } finally {
      setCreating(false);
    }
  }

  function confirmArchive(group: InternshipGroup) {
    // Unarchiving is not destructive, so it needs no confirmation.
    if (group.isArchived) {
      groupService.setArchived(group.id, false).then(loadData).catch((err) =>
        Alert.alert(t('common.error'), err.message || t('errors.unknown')));
      return;
    }
    Alert.alert(
      t('advisor.archive'),
      t('advisor.archiveConfirm', { name: group.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('advisor.archive'),
          style: 'destructive',
          onPress: async () => {
            try {
              await groupService.setArchived(group.id, true);
              await loadData();
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.unknown'));
            }
          },
        },
      ],
    );
  }

  // Archived groups sort last; within each half, newest first (the service
  // already returns created_at descending).
  const ordered = [...groups].sort(
    (a, b) => Number(a.isArchived) - Number(b.isArchived),
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ADVISOR_COLOR]} />
        }
      >
        <Text style={styles.screenTitle}>{t('advisor.myGroups')}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>{t('advisor.groupName')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('advisor.groupNamePlaceholder')}
            placeholderTextColor={colors.textDisabled}
          />
          <Text style={styles.label}>{t('advisor.groupTerm')}</Text>
          <TextInput
            style={styles.input}
            value={term}
            onChangeText={setTerm}
            placeholder={t('advisor.groupTermPlaceholder')}
            placeholderTextColor={colors.textDisabled}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, !name.trim() && { opacity: 0.5 }]}
            disabled={!name.trim() || creating}
            onPress={handleCreate}
            activeOpacity={0.7}
          >
            {creating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('advisor.createGroup')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {ordered.length === 0 && <Text style={styles.empty}>{t('advisor.noGroups')}</Text>}

        {ordered.map((g) => (
          <View key={g.id} style={[styles.card, g.isArchived && { opacity: 0.6 }]}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{g.name}</Text>
              {g.isArchived && <Text style={styles.badge}>{t('advisor.archived')}</Text>}
            </View>
            {!!g.term && <Text style={styles.subtle}>{g.term}</Text>}
            <Text style={styles.subtle}>
              {t('advisor.memberCount', { count: counts[g.id] || 0 })}
            </Text>

            <TouchableOpacity
              style={styles.codeRow}
              activeOpacity={0.7}
              onPress={async () => {
                await Clipboard.setStringAsync(g.joinCode);
                Alert.alert(t('advisor.joinCode'), t('advisor.joinCodeCopied'));
              }}
            >
              <Text style={styles.codeText}>{g.joinCode}</Text>
              <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.subtle}>{t('advisor.joinCodeHint')}</Text>

            <View style={styles.actions}>
              <TouchableOpacity
                onPress={() => router.push(`/(advisor)/student-monitor?groupId=${g.id}`)}
                activeOpacity={0.7}
              >
                <Text style={styles.action}>{t('advisor.viewStudents')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmArchive(g)} activeOpacity={0.7}>
                <Text style={styles.action}>
                  {g.isArchived ? t('advisor.unarchive') : t('advisor.archive')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}
```

Write the `StyleSheet.create` block to match the other advisor screens; every style name used above must exist in it: `safeArea`, `content`, `screenTitle`, `card`, `cardHeader`, `cardTitle`, `badge`, `subtle`, `label`, `input`, `primaryBtn`, `primaryBtnText`, `codeRow`, `codeText`, `actions`, `action`, `empty`.

- [ ] **Step 2: Move the tab**

In `app/(advisor)/_layout.tsx`, replace the `student-monitor` `Tabs.Screen` block (lines 41-48) with:

```tsx
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="student-monitor" options={{ href: null }} />
```

`href: null` keeps `student-monitor` routable while removing it from the tab bar. The tab count is unchanged at seven.

- [ ] **Step 3: Scope student-monitor to a group**

In `app/(advisor)/student-monitor.tsx`, read the group with `useLocalSearchParams` from `expo-router`:

```tsx
import { useLocalSearchParams } from 'expo-router';
…
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
```

When `groupId` is present, the student list comes from `groupService.listMembers(groupId)` instead of the current advisor-wide query, and the header shows that group's name. When it is absent — the screen is still reachable by direct navigation — keep the existing advisor-wide behaviour rather than rendering an error; an advisor arriving without a group id should see all their students, which is what the screen did before.

- [ ] **Step 4: Remove the advisor's join and link block**

In `app/(advisor)/profile.tsx`, delete the `departmentCodeService` import, the join handler around line 399 and the UI that calls it, the `JoinIssueDialog` import and its element at line 643, and any `deptCodeInput` / `issueReport` state left orphaned. Advisors no longer join anything — they own groups.

- [ ] **Step 5: Typecheck and confirm the keys resolve**

```bash
npx tsc --noEmit
python -c "
import json,re
used=set()
for f in ['app/(advisor)/groups.tsx','app/(advisor)/student-monitor.tsx']:
    used|=set(re.findall(r\"t\('([a-zA-Z]+\.[a-zA-Z.]+)'\", open(f,encoding='utf-8').read()))
d=json.load(open('src/i18n/locales/en.json',encoding='utf-8'))
miss=[]
for k in sorted(used):
    cur=d
    for p in k.split('.'): cur=cur.get(p) if isinstance(cur,dict) else None
    if not isinstance(cur,str): miss.append(k)
print('keys:',len(used),'|', miss or 'OK')
"
```

Expected: `tsc` silent, `OK`.

- [ ] **Step 6: Commit**

```bash
npx jest --silent
git add app/\(advisor\)/groups.tsx app/\(advisor\)/_layout.tsx app/\(advisor\)/student-monitor.tsx app/\(advisor\)/profile.tsx src/services/group.ts src/i18n/locales/en.json
git commit -m "feat: advisor groups screen

Groups take student-monitor's tab slot; student-monitor stays routable
with href: null and opens scoped to one group. The tab count is unchanged
and the navigation matches how an advisor thinks — my group, then my
students.

student-monitor keeps its advisor-wide behaviour when no group id is
passed, so arriving by direct navigation shows all students rather than
an error.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Delete the admin surface and the dead package A code

By now nothing references any of it. Deleting earlier would have left the app non-compiling.

**Files:**
- Delete: `app/(admin)/` (all six files)
- Delete: `src/services/admin.ts`, `src/services/institutionCode.ts`, `src/services/departmentCode.ts`, `src/services/joinIssue.ts`
- Delete: `src/store/adminStore.ts`
- Delete: `src/types/institution.ts`
- Delete: `src/components/common/JoinIssueDialog.tsx`
- Delete: `src/utils/codeErrorAlert.ts`, `src/utils/emailDomain.ts`, `src/utils/__tests__/emailDomain.test.ts`
- Modify: `app/(auth)/register.tsx:19`
- Modify: `src/utils/rpcErrors.ts`
- Modify: `src/utils/__tests__/rpcErrors.test.ts`
- Modify: `src/types/index.ts`, `src/utils/index.ts`, `src/components/common/index.ts`, `src/services/index.ts` — barrel exports of deleted modules

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This task only removes.

- [ ] **Step 1: Delete the files**

```bash
git rm -r "app/(admin)"
git rm src/services/admin.ts src/services/institutionCode.ts src/services/departmentCode.ts src/services/joinIssue.ts
git rm src/store/adminStore.ts src/types/institution.ts
git rm src/components/common/JoinIssueDialog.tsx
git rm src/utils/codeErrorAlert.ts src/utils/emailDomain.ts src/utils/__tests__/emailDomain.test.ts
```

- [ ] **Step 2: Remove the admin role option**

In `app/(auth)/register.tsx`, delete line 19:

```ts
  { key: 'admin', icon: '🏛️', color: '#e65100' },
```

Then check whether `UserRole` still lists `'admin'`:

```bash
grep -rn "'admin'" src/types/
```

Remove it from the union wherever it appears. The database `profiles_role_check` no longer permits it, so a type that still offers it can only produce a runtime constraint violation.

- [ ] **Step 3: Remove the dead error codes**

In `src/utils/rpcErrors.ts`, delete these entries from `ERROR_KEYS` — every RPC that raised them is dropped in Task 1:

```ts
  CODE_SEGMENT_MISMATCH: 'errors.codeSegmentMismatch',
  INSTITUTION_MISMATCH: 'errors.institutionMismatch',
  EMAIL_DOMAIN_BLOCKED: 'errors.emailDomainBlocked',
  INVALID_REASON: 'errors.invalidReason',
  REPORT_RATE_LIMITED: 'errors.reportRateLimited',
  NOTE_TOO_LONG: 'errors.noteTooLong',
```

Also delete the `EMAIL_DOMAIN_BLOCKED` special case in the body of `mapRpcError` — the `if (code === 'EMAIL_DOMAIN_BLOCKED' && detail)` block and the `params` it builds. Keep `RpcErrorInfo.params` in the interface only if another code still uses it; if none does, delete the field too.

Delete the matching cases from `src/utils/__tests__/rpcErrors.test.ts`.

- [ ] **Step 4: Fix the barrels**

```bash
grep -rn "institution\|adminStore\|JoinIssueDialog\|codeErrorAlert\|emailDomain\|departmentCode\|institutionCode\|joinIssue" src/types/index.ts src/utils/index.ts src/components/common/index.ts src/services/index.ts
```

Remove every line that names a deleted module.

- [ ] **Step 5: Sweep for orphaned references**

```bash
npx tsc --noEmit
grep -rn "institutionId\|departmentId\|adminService\|useAdminStore\|allowedEmailDomains\|compositeCode" src/ app/
```

Expected: `tsc` silent and `grep` empty. Any hit is a live reference to something deleted — fix it here rather than leaving it for the final review.

- [ ] **Step 6: Annotate the superseded SQL docs — do NOT delete them**

`docs/*.sql` is a chronological migration log: a database is rebuilt by running the files in order. Deleting the old ones breaks that, and `docs/admin-migration.sql` in particular is not safe to remove — alongside the institution tables it defines two things that **survive**:

- `generate_random_code(length INT)` at line 7, which the new `internship_groups.join_code` default depends on;
- the `student_codes` table at line 63, still the mentor's linking mechanism.

So annotate instead of deleting. Add at the top of `docs/admin-migration.sql`:

```sql
-- PARTLY SUPERSEDED by docs/internship-groups-migration.sql (2026-08-19),
-- which drops institutions, departments, admin_profiles, the admin role and
-- the institution/department RPCs defined below. Still authoritative for
-- generate_random_code() and the student_codes table, both of which survive —
-- do not delete this file.
```

And at the top of `docs/join-hardening-migration.sql` and `docs/join-ambiguous-id-fix.sql`:

```sql
-- SUPERSEDED by docs/internship-groups-migration.sql (2026-08-19). Everything
-- below operates on institutions, departments or join_issue_reports, all of
-- which that migration drops. Kept as history: the docs/ SQL files are a
-- chronological log, and a rebuild runs them in order.
```

Delete only `docs/join-hardening-verification.sql` — it is a test script for behaviour that no longer exists, not a migration, so nothing rebuilds from it:

```bash
git rm docs/join-hardening-verification.sql
```

- [ ] **Step 7: Run everything and commit**

```bash
npx tsc --noEmit && npx jest --silent
git add -A
git commit -m "refactor: delete the admin role and the institution model

Six admin screens, four services, a store, a types module and the
partner-feedback code that only made sense inside the institution
hierarchy: composite student codes, per-institution e-mail domains and
join issue reporting.

The GDPR consent flow, login branding, the Jest setup and mapRpcError
all survive — they never depended on the model that was removed.

Deleted last on purpose. Removing any of it earlier would have left the
app non-compiling between tasks.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Verification

**Files:**
- Create: `docs/internship-groups-verification.sql`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a repeatable database verification script.

- [ ] **Step 1: Write the script**

Create `docs/internship-groups-verification.sql`. Two parts, each a separate submission. Part A asserts schema; Part B exercises behaviour inside a transaction that rolls back.

The editor constraints from Global Constraints all apply: anonymous `$$` tags only, one submission per transaction, and **no temp tables** — accumulate results in a text variable handed over through a transaction-local GUC, exactly as `docs/join-hardening-verification.sql` did before it was deleted.

```sql
-- docs/internship-groups-verification.sql
-- Run after docs/internship-groups-migration.sql and
-- docs/internship-groups-rpcs.sql. Two separate submissions.

-- ============================================================
-- PART A — schema assertions
-- Expected: one row, "PASS: schema assertions held".
-- ============================================================

DO $$
DECLARE
  missing TEXT;
BEGIN
  IF to_regclass('public.internship_groups') IS NULL THEN
    RAISE EXCEPTION 'FAIL: internship_groups missing';
  END IF;
  IF to_regclass('public.group_memberships') IS NULL THEN
    RAISE EXCEPTION 'FAIL: group_memberships missing';
  END IF;

  -- The whole one-active-group rule is this index. Without it nothing
  -- visibly breaks and a student silently belongs to two advisors.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'one_active_group_per_student'
  ) THEN
    RAISE EXCEPTION 'FAIL: one_active_group_per_student index missing';
  END IF;

  -- No INSERT policy on memberships: join_group_by_code is SECURITY DEFINER
  -- and is the only write path. An INSERT policy would let a client join any
  -- group by guessing a UUID, skipping the archived-group check.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'group_memberships' AND cmd = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'FAIL: group_memberships has an INSERT policy — the RPC is bypassable';
  END IF;

  -- The old model is gone.
  IF to_regclass('public.institutions') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: institutions still exists';
  END IF;
  IF to_regclass('public.departments') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: departments still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'FAIL: admin profiles still exist';
  END IF;

  SELECT string_agg(n, ', ') INTO missing
  FROM unnest(ARRAY[
    'join_group_by_code', 'validate_group_code',
    'link_student_by_code', 'get_my_student_code', 'get_my_group_leaderboard'
  ]) AS n
  WHERE NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = n);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: missing functions: %', missing;
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS result;


-- ============================================================
-- PART B — behaviour
-- Submit everything from BEGIN to ROLLBACK in one go.
--
-- Expected rows:
--   1 join            accepted
--   2 second group    accepted, first closed
--   3 two active      rejected by the unique index
--   4 second group    accepted (advisor owns two)
--   5 archived        GROUP_ARCHIVED
-- ============================================================

BEGIN;

DO $$
DECLARE
  adv      UUID;
  stu      UUID;
  g1       UUID;
  g2       UUID;
  g3       UUID;
  c1       TEXT;
  c2       TEXT;
  c3       TEXT;
  closed   INT;
  log      TEXT := '';
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;

  IF adv IS NULL OR stu IS NULL THEN
    PERFORM set_config('probe.results',
      '1-5 groups' || E'\t' || 'SKIP: needs one advisor and one student profile' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe A') RETURNING id, join_code INTO g1, c1;
  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe B') RETURNING id, join_code INTO g2, c2;
  INSERT INTO internship_groups (advisor_id, name, is_archived)
    VALUES (adv, 'Probe C', true) RETURNING id, join_code INTO g3, c3;

  -- Row 4 is proven by the two inserts above succeeding: an advisor owning
  -- more than one group is exactly what institutions_admin_id_unique forbade.
  log := log || '4 second group' || E'\t' || 'accepted' || E'\n';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);

  DELETE FROM group_memberships m WHERE m.student_id = stu;

  BEGIN
    PERFORM join_group_by_code(c1);
    log := log || '1 join' || E'\t' || 'accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '1 join' || E'\t' || 'FAIL: ' || SQLERRM || E'\n';
  END;

  BEGIN
    PERFORM join_group_by_code(c2);
    SELECT count(*) INTO closed
    FROM group_memberships m
    WHERE m.student_id = stu AND m.group_id = g1 AND m.left_at IS NOT NULL;
    IF closed = 1 THEN
      log := log || '2 second group' || E'\t' || 'accepted, first closed' || E'\n';
    ELSE
      log := log || '2 second group' || E'\t' || 'FAIL: first membership not closed' || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    log := log || '2 second group' || E'\t' || 'FAIL: ' || SQLERRM || E'\n';
  END;

  -- Force a second ACTIVE membership straight past the RPC. This is the only
  -- check on the index that carries the whole rule.
  BEGIN
    INSERT INTO group_memberships (group_id, student_id) VALUES (g1, stu);
    log := log || '3 two active' || E'\t' || 'FAIL: index allowed two active memberships' || E'\n';
  EXCEPTION WHEN unique_violation THEN
    log := log || '3 two active' || E'\t' || 'rejected by the unique index' || E'\n';
  WHEN OTHERS THEN
    log := log || '3 two active' || E'\t' || 'FAIL (wrong error): ' || SQLERRM || E'\n';
  END;

  BEGIN
    PERFORM join_group_by_code(c3);
    log := log || '5 archived' || E'\t' || 'FAIL: joined an archived group' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '5 archived' || E'\t' || SQLERRM || E'\n';
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

- [ ] **Step 2: Have the human run it**

Ask the user to run, in order: delete admin accounts in the Supabase dashboard, then `docs/internship-groups-migration.sql`, then `docs/internship-groups-rpcs.sql`, then Parts A and B of this file. Record each result verbatim. Do not mark this step done on Part A alone.

- [ ] **Step 3: Add the PROGRESS row**

Append to the Session Log table in `PROGRESS.md`:

```markdown
| 2026-08-19 | Session 14 | Pivot to advisor-owned internship groups (subsystem A of three). The project team corrected the premise: the academic advisor runs the process, there is no admin role and no faculty/university layer. Two tables (`internship_groups`, `group_memberships`) replace the institution/department hierarchy, with a partial unique index carrying the one-active-group-per-student rule. Students join by group code; mentors still link by student code. Deleted: the admin role and its six screens, both institution tables, and the half of partner-feedback package A that only made sense inside that model (composite student codes, per-institution e-mail domains, join issue reporting). Kept: GDPR consent, branding, Jest, mapRpcError. Leaderboard rescoped from free-text university names to the student's group. Migrations: `docs/internship-groups-migration.sql`, `docs/internship-groups-rpcs.sql`; verification: `docs/internship-groups-verification.sql` |
```

- [ ] **Step 4: Device checklist**

Record the actual result of each line. Do not report this task complete with any line unverified.

1. Advisor creates a group, then sees its join code.
2. Advisor creates a second group — the multi-group case the old model forbade.
3. Student enters the code and joins; their profile shows the group name.
4. Advisor opens the group and sees that student in the list.
5. Advisor validates one of that student's logs — proving the advisor_id chain still works end to end.
6. Student joins a second group; the first advisor no longer lists them, and the student's old logs are still in their history.
7. Advisor archives a group; a student entering its code is refused with the translated message.
8. Advisor removes a student from a group; the student's logs survive.
9. Mentor links that student by their 6-character code — unchanged behaviour, verifying the pivot did not disturb it.
10. Student leaderboard shows only their own group's members.

- [ ] **Step 5: Commit**

```bash
git add docs/internship-groups-verification.sql PROGRESS.md
git commit -m "test: verify the internship group model

Part B row 3 forces a second active membership straight past the RPC. It
is the only check on the partial unique index that carries the whole
one-active-group rule, and a missing index fails silently — the student
would simply belong to two advisors.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes for the implementer

**Nothing may leave the app non-compiling.** The task order exists for this reason: the new data layer lands in Task 3 while the old model is still present, the two screen tasks switch over, and only then does Task 6 delete. If you find yourself deleting something in Tasks 1-5, stop — it belongs in Task 6.

**The partial unique index is the whole rule.** `CREATE UNIQUE INDEX … WHERE left_at IS NULL`. A plain unique index forbids history; no index lets a student belong to two advisors with nothing visibly wrong. Do not "simplify" it into a constraint.

**Qualify every column reference inside a `RETURNS TABLE` function.** `RETURNS TABLE (id UUID, …)` creates a variable named `id`, and an unqualified `WHERE id = …` raises `42702`. This exact bug shipped in this codebase and survived months of review because every rejection path raised before reaching the ambiguous statement — the functions failed only when they were supposed to succeed.

**Do not reintroduce institution vocabulary.** If you find yourself writing `institutionId`, `departmentCode` or `adminService`, you are working from the old model.

**`student_profiles.university`, `.faculty` and `.department` STAY, and so does the registration form that collects them.** They look like the institution model but are not: they are free text the student types about themselves, they were never joined to the `institutions` table, and they appear on profiles and in advisor reports. The same goes for `advisor_profiles.university`, `.department` and `.title`. Task 6's deletion sweep greps for `institution` — do not let that grep tempt you into these columns. Only `leaderboard_public`'s copies of them are dropped, because the leaderboard now scopes by group instead.
