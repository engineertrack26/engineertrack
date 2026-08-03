# Advisor-owned institutions

**Date:** 2026-08-03
**Status:** approved, ready for planning

## Problem

A single academic supervising their own interns cannot use the app. Everything
downstream works — daily logs, XP, badges, validation, reports, all keyed on
`student_profiles.advisor_id` with no institution involved — but the advisor can
never acquire a student in the first place.

`link_student_by_code` (`docs/join-hardening-migration.sql:186-195`):

```sql
IF caller_role = 'advisor' THEN
  IF caller_institution IS NULL
     OR student_institution IS NULL
     OR caller_institution <> student_institution THEN
    RAISE EXCEPTION 'INSTITUTION_MISMATCH';
  END IF;
END IF;
```

An advisor with no institution fails the `IS NULL` branch on every attempt.
Mentors are explicitly exempt, so the mentor role works standalone today — but a
mentor loses the validation, compliance-monitoring and CSV-report screens, which
are exactly what an academic supervising interns needs.

Institutions can only be created from the admin dashboard, and only an admin can
create one, so the advisor cannot satisfy the check. That is the entire gap.

## Decision

Let an advisor create and own an institution, identical in kind to an admin's.
Considered and rejected:

- **Relax the advisor check** — an advisor with no institution could link any
  student anywhere by guessing a 6-character code. That check is load-bearing.
- **A separate "independent advisor" mode** — a third concept for a case the
  existing model already expresses.

## What the database already allows

No permission work is needed. The gate is entirely in the UI.

- `institutions` INSERT policy is `admin_id = auth.uid()` — **no role check**
  (`docs/admin-migration.sql:369-370`).
- `departments` management policy is `institutions.admin_id = auth.uid()` —
  ownership, not role (`docs/admin-migration.sql:403-411`).
- `adminService.createInstitution` already sets the creator's
  `profiles.institution_id` (`src/services/admin.ts:82-86`), so the advisor
  satisfies `link_student_by_code` the moment the institution exists.
- `report_join_issue` routes to `institutions.admin_id`, so join-problem reports
  reach the advisor-owner with no code change.
- `institutions_admin_id_unique` (`docs/admin-migration.sql:48`) caps ownership
  at one institution per user.

## Architecture

### New: `src/components/institution/`

Four components, each owning its state and its single service call — which is
how the code is already written on the admin dashboard, just relocated. None
touches a Zustand store, so the admin dashboard keeps `useAdminStore` and the
advisor screen holds local state. **No new store.**

| Component | Props | Responsibility |
|---|---|---|
| `InstitutionSetupForm` | `ownerId`, `onCreated(institution)` | name / type / country / allowed domains, calls `createInstitution` |
| `InstitutionCodeCard` | `institution` | shows the code, copies on tap |
| `DepartmentsCard` | `institution` | lists and creates departments, copies department codes |
| `AllowedDomainsCard` | `institution`, `onSaved(domains)` | edits and saves the domain list |

### Changed: `app/(admin)/dashboard.tsx`

Four JSX blocks become four component calls. Shell, header, stats and quick
actions are untouched. Behaviour must not change; `tsc` and the on-screen result
are the check.

This is the reason the design extracts cards rather than a whole
`<InstitutionManager>`: the dashboard was translated this session, carries Task
14's edit card, and **was never seen by a subagent review** (recorded in the SDD
ledger). A wholesale restructure would put working code at risk for a feature
that does not exist yet.

### New: `app/(advisor)/institution.tsx`

Reached from a row on `app/(advisor)/profile.tsx`, following the existing
`settingsRow` pattern next to the privacy-policy row. **Not** a tab — registered
with `href: null` so it stays out of the advisor tab bar, which is for the
advisor's actual job.

### Naming

`adminService` keeps its name even though an advisor now calls it. The schema's
own term is `institutions.admin_id`: whoever owns an institution is its admin,
whatever their role. Renaming would open five files for no behavioural gain. A
doc comment on the service records this.

### Removal

The `admin_profiles` update inside `createInstitution` is deleted. The live
`handle_new_user` (in `docs/consent-migration.sql`) only writes `profiles`; the
`admin_profiles` INSERT is commented out in `docs/admin-migration.sql:465-466`.
The table has no rows, so that update is already a silent no-op for admins too.

## Data flow

1. **Advisor creates the institution.** `createInstitution(user.id, …)` inserts
   with `admin_id = advisor`, and sets the advisor's own
   `profiles.institution_id`.
2. **Advisor creates a department.** Passes the ownership-based `departments`
   policy.
3. **Student joins.** `join_department_by_code` applies the advisor's own
   allowed-domain list, then sets the student's `institution_id` and
   `department_id`.
4. **Advisor links the student.** `link_student_by_code(code, 'advisor')` now
   finds `caller_institution = student_institution`. **This is the step that was
   impossible before.**
5. **Reports** reach the advisor via `institutions.admin_id`, free.

## Migration: `docs/institution-ownership-lock.sql`

An owner must not move themselves into a different institution — their students
would be left pointing at an institution whose advisor has left it. The rule
cannot live in the client; anything calling PostgREST directly would skip it.

The same block goes into `join_institution_by_code` and
`join_department_by_code`, immediately after `inst_id` is resolved and **before**
the domain check — "you already own an institution" is a more fundamental
refusal than "your e-mail domain is wrong", and there is no point making the
user question their address:

```sql
  -- An institution's owner cannot move into a different one: their students
  -- would be left pointing at an institution whose owner has left it.
  SELECT i.id INTO owned_id FROM institutions i WHERE i.admin_id = auth.uid();
  IF owned_id IS NOT NULL AND owned_id <> inst_id THEN
    RAISE EXCEPTION 'OWNS_INSTITUTION';
  END IF;
```

`owned_id <> inst_id` is deliberate: the owner joining **their own**
institution's department must still succeed. Writing this as a bare `IS NOT
NULL` check would block that too, silently.

Client-side follow-through:

- `mapRpcError`: `OWNS_INSTITUTION → errors.ownsInstitution`.
- Seven locale strings.
- **Not** added to `REPORTABLE` in `src/utils/codeErrorAlert.ts`. This is the
  user's own account state, not a broken code; reporting it to an admin achieves
  nothing. `INSTITUTION_MISMATCH` is excluded for the same reason.

No new table, no new column, no RLS change.

## Edge cases

### An advisor who already belongs to someone else's institution

`getInstitution(userId)` queries by `admin_id`, so an advisor who joined their
university's institution by code owns nothing and gets `null` — and a naive
screen would show them the setup form. Submitting it would **overwrite their own
`profiles.institution_id`** and silently detach them from their university:
existing students stay linked through `advisor_id` but now sit in a different
institution, and `link_student_by_code` would never bind another one.

The screen therefore resolves three states, not two:

```ts
resolveInstitutionView(owned: Institution | null, profileInstitutionId?: string)
  → 'setup' | 'owner' | 'member'
```

`owned` present → `owner`. Otherwise `profileInstitutionId` present → `member`,
showing "You are a member of {name}. Its administrator manages it." and **no
form**. Neither → `setup`.

### Closing an institution

The `OWNS_INSTITUTION` lock fails closed. Left alone it would trap an advisor
who later wants to join their university's real institution — the same
no-in-app-remedy trap that Task 14's allowed-domain field had, which was
deliberately fixed rather than shipped.

**"Close my institution" is enabled only while the institution has no members
besides the owner.** That covers the real case (an advisor created one to try it
and wants out), makes the delete semantics unambiguous, and still stops an
advisor with students from walking away silently — which is the whole reason the
lock exists. With students present the button is disabled and states why.

Concretely, closing:

- lives on the `institution.tsx` screen in the `owner` state, behind a
  destructive-style confirmation naming the institution;
- is enabled only when `profiles` holds no row with this `institution_id` other
  than the owner's own;
- deletes the institution row and nothing else. The schema already does the
  rest: `departments.institution_id` is `ON DELETE CASCADE`
  (`docs/admin-migration.sql:73`), and `profiles.institution_id` and
  `profiles.department_id` are both `ON DELETE SET NULL`
  (`docs/admin-migration.sql:82,85`), so the owner's own membership clears
  itself. Do not write code to null it by hand.

The member count must be read at the moment of the delete, not from screen
state, or a student who joins while the confirmation dialog is open would be
orphaned.

### Duplicate creation

`institutions_admin_id_unique` rejects a second institution at the database
level. This is **not** routed through `mapRpcError`, which parses our own
`CODE:detail` exception strings — a unique violation is a PostgREST error whose
message ("duplicate key value violates unique constraint …") has no such shape
and would fall through to `errors.unknown`.

Supabase returns the SQLSTATE separately as `error.code`, so
`createInstitution` checks `error.code === '23505'` at the call site and throws
a mapped message. The screen only shows the form when no institution is owned,
so this guards a stale screen or a double submit rather than an everyday path.

### Card error handling

All four components follow the existing pattern: `try/catch` →
`Alert.alert(t('common.error'), …)` with the mapped message. No new error path.

### Out of scope, recorded

`student_profiles.university` is free text captured at registration and
unrelated to `institutions`; the leaderboard scopes on that string. An advisor's
institution and a student's typed university name can therefore disagree. This
predates the work here and is a separate task.

## Testing

### Jest

One target, and it is the dangerous one: `resolveInstitutionView`. The whole of
the "already a member" trap reduces to that function returning `member` instead
of `setup`. It fits the existing `src/utils/__tests__/` layout.

No component render tests. There is no React Native test infrastructure in this
project, and Task 1 scoped Jest to pure helpers on purpose.

### Database — Part E of `docs/join-hardening-verification.sql`

Following the Part B/C pattern exactly: one submission, identity via
`set_config(..., true)`, results accumulated in a transaction-local GUC,
`ROLLBACK` at the end.

| # | Scenario | Expected |
|---|---|---|
| 15 | Owner tries to join **another** institution's department | `OWNS_INSTITUTION` |
| 16 | Owner joins **their own** institution's department | `accepted` |
| 17 | A non-owner joins | `accepted` |

Row 16 is the regression test for the `<>` comparison. Row 17 proves the lock
does not catch bystanders.

### On device

Five checks, none provable from code:

1. An advisor with no institution creates one, then a department.
2. A student joins with the department code and gets a composite student code.
3. **The advisor links that student** — the entire point of the work.
4. An advisor belonging to an admin's institution sees the membership message,
   not the setup form.
5. The close button is disabled while students exist and enabled once empty.
