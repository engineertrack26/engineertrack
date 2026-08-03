# Advisor-Owned Institutions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an advisor create and own an institution, so a single academic can run the app with only their own interns and no admin.

**Architecture:** No new permissions — the `institutions` INSERT policy and the `departments` management policy are already ownership-based with no role check, and `createInstitution` already sets the creator's `profiles.institution_id`. The work is a small SQL lock preventing an owner from moving into a different institution, four UI components extracted out of the admin dashboard so both screens share them, and a new advisor screen that composes them.

**Tech Stack:** Expo SDK 54, React Native, TypeScript, Supabase (PostgREST + plpgsql RPCs), Zustand, i18next (7 locales), Jest.

**Spec:** `docs/superpowers/specs/2026-08-03-advisor-owned-institution-design.md`

## Global Constraints

- **Path aliases only.** `@/…`, `@components/…`, `@services/…`. Never a relative path out of `src/`.
- **i18n applies to all new user-facing strings, in all seven locales** (en, tr, el, it, ro, de, sr). The user paused the *retrofit* of existing hardcoded screens; that pause does not cover strings written from scratch here, because adding them later is exactly the expensive path being avoided. If the reviewer disagrees, raise it before Task 5.
- **Locale files are edited by round-tripping JSON with `json.dumps(indent=2, ensure_ascii=False)` plus a trailing newline.** This was verified byte-identical to the current files, so the diff stays a pure addition instead of reformatting all seven.
- **New RPC error codes are stable uppercase identifiers**, mapped in `src/utils/rpcErrors.ts` and never parsed anywhere else.
- **Do not add a tab** for the advisor institution screen. It is registered with `href: null`.
- **Do not restructure `app/(admin)/dashboard.tsx` beyond replacing four JSX blocks with four component calls.** That file was translated this session, carries Task 14's edit card, and has never been through a subagent review.
- **Every task ends `npx tsc --noEmit` clean and `npx jest` green** (currently 4 suites / 31 tests).
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `docs/institution-ownership-lock.sql` | **create** — adds the `OWNS_INSTITUTION` guard to both join RPCs |
| `src/utils/rpcErrors.ts` | **modify** — three new error codes |
| `src/utils/__tests__/rpcErrors.test.ts` | **modify** — cases for them |
| `src/utils/institutionView.ts` | **create** — `resolveInstitutionView`, the Trap 1 guard |
| `src/utils/__tests__/institutionView.test.ts` | **create** — its tests |
| `src/utils/index.ts` | **modify** — barrel export |
| `src/components/institution/InstitutionSetupForm.tsx` | **create** — create-institution form |
| `src/components/institution/InstitutionCodeCard.tsx` | **create** — code display + copy |
| `src/components/institution/DepartmentsCard.tsx` | **create** — department list + create |
| `src/components/institution/AllowedDomainsCard.tsx` | **create** — domain list editor |
| `src/components/institution/index.ts` | **create** — barrel |
| `app/(admin)/dashboard.tsx` | **modify** — four blocks become four component calls |
| `src/services/admin.ts` | **modify** — drop dead `admin_profiles` write, add 23505 mapping, add `countOtherMembers` + `closeInstitution` |
| `app/(advisor)/institution.tsx` | **create** — the advisor's institution screen |
| `app/(advisor)/_layout.tsx` | **modify** — register the screen with `href: null` |
| `app/(advisor)/profile.tsx` | **modify** — a row that opens it |
| `src/i18n/locales/*.json` | **modify** — new `errors.*` and `advisor.*` keys, seven files |
| `docs/join-hardening-verification.sql` | **modify** — Part E |
| `PROGRESS.md` | **modify** — session log row |

---

### Task 1: Ownership lock migration and error plumbing

**Files:**
- Create: `docs/institution-ownership-lock.sql`
- Modify: `src/utils/rpcErrors.ts`
- Modify: `src/utils/__tests__/rpcErrors.test.ts`
- Modify: `src/i18n/locales/{en,tr,el,it,ro,de,sr}.json`

**Interfaces:**
- Consumes: nothing.
- Produces: RPC error codes `OWNS_INSTITUTION`, `INSTITUTION_NOT_EMPTY`, `INSTITUTION_EXISTS`, mapped by `mapRpcError(message?: string): RpcErrorInfo` to `errors.ownsInstitution`, `errors.institutionNotEmpty`, `errors.institutionExists`. Tasks 4 and 5 rely on these exact key names.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/__tests__/rpcErrors.test.ts`, inside the existing `describe('mapRpcError', …)` block:

```ts
  it('maps OWNS_INSTITUTION', () => {
    expect(mapRpcError('OWNS_INSTITUTION')).toEqual({
      code: 'OWNS_INSTITUTION',
      key: 'errors.ownsInstitution',
    });
  });

  it('maps INSTITUTION_NOT_EMPTY', () => {
    expect(mapRpcError('INSTITUTION_NOT_EMPTY')).toEqual({
      code: 'INSTITUTION_NOT_EMPTY',
      key: 'errors.institutionNotEmpty',
    });
  });

  it('maps INSTITUTION_EXISTS', () => {
    expect(mapRpcError('INSTITUTION_EXISTS')).toEqual({
      code: 'INSTITUTION_EXISTS',
      key: 'errors.institutionExists',
    });
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest rpcErrors -t OWNS_INSTITUTION`
Expected: FAIL — received `{ code: 'UNKNOWN', key: 'errors.unknown' }`.

- [ ] **Step 3: Add the three codes**

In `src/utils/rpcErrors.ts`, add to the `ERROR_KEYS` object after `NOTE_TOO_LONG`:

```ts
  OWNS_INSTITUTION: 'errors.ownsInstitution',
  INSTITUTION_NOT_EMPTY: 'errors.institutionNotEmpty',
  INSTITUTION_EXISTS: 'errors.institutionExists',
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest`
Expected: 4 suites pass, 34 tests.

- [ ] **Step 4b: Confirm the new codes are NOT reportable**

Open `src/utils/codeErrorAlert.ts` and verify its `REPORTABLE` map is unchanged. None of the three new codes belongs there: they describe the caller's own account state, not a broken code, so sending a report to an institution admin achieves nothing. `INSTITUTION_MISMATCH` is deliberately absent for the same reason.

Run:

```bash
grep -n "OWNS_INSTITUTION\|INSTITUTION_NOT_EMPTY\|INSTITUTION_EXISTS" src/utils/codeErrorAlert.ts
```

Expected: no output.

- [ ] **Step 5: Add the seven locale strings**

Add to the `errors` object in each locale. Use the round-trip method from Global Constraints.

| locale | ownsInstitution | institutionNotEmpty | institutionExists |
|---|---|---|---|
| en | You already run your own institution. Close it before joining another one. | Your institution still has members. They must leave before you can close it. | You already have an institution. |
| tr | Zaten kendi kurumunuzu yönetiyorsunuz. Başka bir kuruma katılmadan önce onu kapatın. | Kurumunuzda hâlâ üye var. Kapatabilmeniz için önce ayrılmaları gerekiyor. | Zaten bir kurumunuz var. |
| de | Sie leiten bereits Ihre eigene Institution. Schließen Sie sie, bevor Sie einer anderen beitreten. | Ihre Institution hat noch Mitglieder. Sie müssen sie verlassen, bevor Sie sie schließen können. | Sie haben bereits eine Institution. |
| el | Διαχειρίζεστε ήδη το δικό σας ίδρυμα. Κλείστε το πριν συμμετάσχετε σε άλλο. | Το ίδρυμά σας έχει ακόμη μέλη. Πρέπει να αποχωρήσουν για να μπορέσετε να το κλείσετε. | Έχετε ήδη ένα ίδρυμα. |
| it | Gestisci già il tuo istituto. Chiudilo prima di entrare in un altro. | Il tuo istituto ha ancora dei membri. Devono uscire prima che tu possa chiuderlo. | Hai già un istituto. |
| ro | Administrezi deja propria instituție. Închide-o înainte de a te alătura alteia. | Instituția ta are încă membri. Trebuie să plece înainte să o poți închide. | Ai deja o instituție. |
| sr | Već vodite sopstvenu instituciju. Zatvorite je pre nego što se pridružite drugoj. | Vaša institucija još uvek ima članove. Moraju je napustiti pre nego što je zatvorite. | Već imate instituciju. |

- [ ] **Step 6: Verify every locale resolves**

Run:

```bash
python -c "
import json
for loc in ['en','tr','el','it','ro','de','sr']:
    d=json.load(open('src/i18n/locales/%s.json'%loc,encoding='utf-8'))['errors']
    miss=[k for k in ['ownsInstitution','institutionNotEmpty','institutionExists'] if not isinstance(d.get(k),str)]
    print(loc, miss or 'ok')
"
```

Expected: `ok` on all seven lines.

- [ ] **Step 7: Write the migration**

Create `docs/institution-ownership-lock.sql`. Copy the current bodies of `join_institution_by_code` and `join_department_by_code` from `docs/join-ambiguous-id-fix.sql` verbatim — that file holds the corrected definitions — then add `owned_id UUID;` to each `DECLARE` block and insert this immediately after `inst_id` is resolved and its `IF … IS NULL THEN RAISE EXCEPTION 'INVALID_…'` guard, and **before** the allowed-domain block in `join_department_by_code`:

```sql
  -- An institution's owner cannot move into a different one: their students
  -- would be left pointing at an institution whose owner has left it. This
  -- runs before the domain check because "you already own an institution" is
  -- a more fundamental refusal — there is no point making the user question
  -- their e-mail address.
  --
  -- `owned_id <> inst_id` is deliberate. The owner joining THEIR OWN
  -- institution's department must still succeed; a bare IS NOT NULL check
  -- would block that too, silently.
  SELECT i.id INTO owned_id FROM institutions i WHERE i.admin_id = auth.uid();
  IF owned_id IS NOT NULL AND owned_id <> inst_id THEN
    RAISE EXCEPTION 'OWNS_INSTITUTION';
  END IF;
```

Head the file with a comment explaining that it supersedes `docs/join-ambiguous-id-fix.sql` for these two functions, and that it is idempotent (`CREATE OR REPLACE`) and safe to re-run.

- [ ] **Step 8: Apply the same change to the source migrations**

So a fresh environment is correct without the patch file, make the identical edit in:
- `docs/admin-migration.sql` — `join_institution_by_code` and `join_department_by_code`
- `docs/join-hardening-migration.sql` — `join_department_by_code`

- [ ] **Step 9: Verify the patch matches the migration logic**

Run:

```bash
python -c "
import re
a=open('docs/join-hardening-migration.sql',encoding='utf-8').read()
b=open('docs/institution-ownership-lock.sql',encoding='utf-8').read()
def body(src,name):
    i=src.find('CREATE OR REPLACE FUNCTION '+name)
    return src[i:src.find(chr(36)*2+';', i)]
strip=lambda s:[l.strip() for l in s.split(chr(10)) if l.strip() and not l.strip().startswith('--')]
x,y=strip(body(a,'join_department_by_code')),strip(body(b,'join_department_by_code'))
print('identical:',x==y)
[print('DIFF:',p,'|',q) for p,q in zip(x,y) if p!=q]
"
```

Expected: `identical: True`. If not, the patch and the migration have drifted — reconcile before committing.

- [ ] **Step 10: Typecheck and commit**

```bash
npx tsc --noEmit && npx jest --silent
git add docs/institution-ownership-lock.sql docs/admin-migration.sql docs/join-hardening-migration.sql src/utils/rpcErrors.ts src/utils/__tests__/rpcErrors.test.ts src/i18n/locales
git commit -m "feat: stop an institution owner from joining a different institution

Their students would be left pointing at an institution whose owner has
left it. The rule is enforced in join_institution_by_code and
join_department_by_code because a client calling PostgREST directly would
skip anything checked in the app.

owned_id <> inst_id is deliberate: the owner joining their own
institution's department must still succeed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**NOTE FOR THE CONTROLLER:** the migration must be applied by the human in the Supabase SQL editor before Task 6's Part E can pass. Flag it at the end of this task; do not block Tasks 2-5 on it.

---

### Task 2: `resolveInstitutionView`

This is the Trap 1 guard. An advisor who joined someone else's institution owns nothing, so `getInstitution` returns `null` — and a two-state screen would offer them the setup form. Submitting it overwrites their `profiles.institution_id` and silently detaches them from their university.

**Files:**
- Create: `src/utils/institutionView.ts`
- Create: `src/utils/__tests__/institutionView.test.ts`
- Modify: `src/utils/index.ts`

**Interfaces:**
- Consumes: `Institution` from `@/types/institution`.
- Produces: `resolveInstitutionView(owned: Institution | null | undefined, profileInstitutionId?: string | null): InstitutionView` where `type InstitutionView = 'setup' | 'owner' | 'member'`. Task 5 renders one of three branches from this.

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/institutionView.test.ts`:

```ts
import { resolveInstitutionView } from '@/utils/institutionView';
import type { Institution } from '@/types/institution';

const owned = { id: 'inst-1', name: 'Test' } as Institution;

describe('resolveInstitutionView', () => {
  it('returns setup when the user owns nothing and belongs to nothing', () => {
    expect(resolveInstitutionView(null, null)).toBe('setup');
  });

  it('returns setup when both arguments are undefined', () => {
    expect(resolveInstitutionView(undefined, undefined)).toBe('setup');
  });

  it('returns owner when the user owns an institution', () => {
    expect(resolveInstitutionView(owned, 'inst-1')).toBe('owner');
  });

  it('returns owner even if the profile points somewhere else', () => {
    // Ownership wins. A stale profile row must never hide the owner's
    // own institution from them.
    expect(resolveInstitutionView(owned, 'inst-other')).toBe('owner');
  });

  it('returns member when the user belongs to an institution they do not own', () => {
    // The trap: this must NOT be 'setup'. Showing the setup form here lets
    // the advisor overwrite their own profiles.institution_id and silently
    // detach from their university.
    expect(resolveInstitutionView(null, 'inst-2')).toBe('member');
  });

  it('treats an empty string institution id as no membership', () => {
    expect(resolveInstitutionView(null, '')).toBe('setup');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest institutionView`
Expected: FAIL — `Cannot find module '@/utils/institutionView'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/institutionView.ts`:

```ts
import type { Institution } from '@/types/institution';

export type InstitutionView = 'setup' | 'owner' | 'member';

/**
 * Which of the three states the institution screen shows.
 *
 * `getInstitution` queries by `admin_id`, so an advisor who joined someone
 * else's institution by code owns nothing and gets null. Treating that as
 * "no institution" would offer them the setup form, and creating one would
 * overwrite their own profiles.institution_id — silently detaching them from
 * their university while their existing students stayed linked by advisor_id.
 * Hence three states, not two.
 */
export function resolveInstitutionView(
  owned: Institution | null | undefined,
  profileInstitutionId?: string | null,
): InstitutionView {
  if (owned) return 'owner';
  if (profileInstitutionId) return 'member';
  return 'setup';
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest`
Expected: 5 suites pass, 40 tests.

- [ ] **Step 5: Export from the barrel**

Add to `src/utils/index.ts`, following the existing export style in that file:

```ts
export { resolveInstitutionView } from './institutionView';
export type { InstitutionView } from './institutionView';
```

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit && npx jest --silent
git add src/utils/institutionView.ts src/utils/__tests__/institutionView.test.ts src/utils/index.ts
git commit -m "feat: resolve the institution screen into three states

An advisor who joined someone else's institution owns nothing, so
getInstitution returns null. A two-state screen would offer them the
setup form, and submitting it would overwrite their own
profiles.institution_id and detach them from their university while their
students stayed linked by advisor_id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract the four institution components

**Files:**
- Create: `src/components/institution/InstitutionSetupForm.tsx`
- Create: `src/components/institution/InstitutionCodeCard.tsx`
- Create: `src/components/institution/DepartmentsCard.tsx`
- Create: `src/components/institution/AllowedDomainsCard.tsx`
- Create: `src/components/institution/index.ts`
- Modify: `app/(admin)/dashboard.tsx` (blocks at lines 205-293, 296-312, 314-353, 355-408)
- Modify: `src/services/admin.ts`

**Interfaces:**
- Consumes: `adminService`, `Institution` and `Department` from `@/types/institution`, `normalizeDomainList` from `@/utils/emailDomain`, `mapRpcError` from `@/utils/rpcErrors`.
- Produces, all default-exported and re-exported from the barrel:
  - `<InstitutionSetupForm ownerId={string} onCreated={(i: Institution) => void} onCancel={() => void} accentColor={string} />`
  - `<InstitutionCodeCard institution={Institution} accentColor={string} />`
  - `<DepartmentsCard institution={Institution} accentColor={string} />`
  - `<AllowedDomainsCard institution={Institution} onSaved={(domains: string[]) => void} />`
  - `adminService.createInstitution` unchanged in signature; it now throws `new Error('INSTITUTION_EXISTS')` on SQLSTATE 23505.

**This task must not change admin dashboard behaviour.** The check is `tsc`, `jest`, and the screen looking and acting exactly as before.

- [ ] **Step 1: Drop the dead `admin_profiles` write**

In `src/services/admin.ts`, inside `createInstitution`, delete this block entirely:

```ts
    // Link admin profile to institution
    await supabase
      .from('admin_profiles')
      .update({ institution_id: institution.id })
      .eq('id', adminId);
```

`admin_profiles` has no rows — the live `handle_new_user` in `docs/consent-migration.sql` writes only `profiles`, and the `admin_profiles` INSERT in `docs/admin-migration.sql:465-466` is commented out. This update is already a silent no-op for admins.

Keep the `profiles` update immediately below it; that one is load-bearing and is what makes `link_student_by_code` succeed for the owner.

Then add this comment directly above `export const adminService = {`, so the next reader does not "fix" the name:

```ts
/**
 * Institution management. Named for `institutions.admin_id`, the schema's own
 * term: whoever owns an institution is its admin, whatever their role. An
 * advisor who creates their own institution calls this service too — see
 * app/(advisor)/institution.tsx.
 */
```

- [ ] **Step 2: Map the unique-violation**

Still in `createInstitution`, replace `if (error) throw error;` after the insert with:

```ts
    // institutions_admin_id_unique caps ownership at one institution per user.
    // PostgREST surfaces that as SQLSTATE 23505 with a message about a
    // constraint, which mapRpcError cannot read — it parses our own
    // CODE:detail strings. Translate it here instead.
    if (error) {
      if (error.code === '23505') throw new Error('INSTITUTION_EXISTS');
      throw error;
    }
```

- [ ] **Step 3: Create the four components**

Each component moves the corresponding JSX and its state out of `app/(admin)/dashboard.tsx` **verbatim**, with three mechanical changes: styles the block used move into the component's own `StyleSheet.create`; `ADMIN_COLOR` becomes the `accentColor` prop; and state the block owned moves into the component.

| Component | Source block | State it takes with it |
|---|---|---|
| `InstitutionSetupForm` | lines 205-293 | `setupName`, `setupType`, `setupCountry`, `setupDomains`, `creatingInstitution` |
| `InstitutionCodeCard` | lines 296-312 | none — `copyCode` moves in |
| `AllowedDomainsCard` | lines 314-353 | `domainsInput`, `savingDomains`, and the `useEffect` that seeds the input |
| `DepartmentsCard` | lines 355-408 | `departments`, `deptName`, `creatingDepartment`, and the `getDepartments` call from `loadData` |

`AllowedDomainsCard` keeps its accent from `colors`, not `accentColor`, because its current styles do — do not introduce a colour change.

Error handling in all four stays exactly as it is today: `Alert.alert(t('common.error'), err.message || t('errors.unknown'))`. In `InstitutionSetupForm` only, route the message through `mapRpcError` so `INSTITUTION_EXISTS` reads as a sentence:

```ts
    } catch (err: any) {
      const info = mapRpcError(err?.message);
      Alert.alert(t('common.error'), t(info.key));
    }
```

- [ ] **Step 4: Create the barrel**

`src/components/institution/index.ts`:

```ts
export { default as InstitutionSetupForm } from './InstitutionSetupForm';
export { default as InstitutionCodeCard } from './InstitutionCodeCard';
export { default as DepartmentsCard } from './DepartmentsCard';
export { default as AllowedDomainsCard } from './AllowedDomainsCard';
```

- [ ] **Step 5: Rewire the admin dashboard**

Replace the four blocks with:

```tsx
        {!institution && showSetup && (
          <InstitutionSetupForm
            ownerId={user!.id}
            accentColor={ADMIN_COLOR}
            onCreated={(inst) => {
              setInstitution(inst);
              setShowSetup(false);
            }}
            onCancel={() => setShowSetup(false)}
          />
        )}

        {institution && <InstitutionCodeCard institution={institution} accentColor={ADMIN_COLOR} />}

        {institution && (
          <AllowedDomainsCard
            institution={institution}
            onSaved={(domains) => setInstitution({ ...institution, allowedEmailDomains: domains })}
          />
        )}

        {institution && <DepartmentsCard institution={institution} accentColor={ADMIN_COLOR} />}
```

Then delete from `dashboard.tsx` every state variable, handler and style that moved: `setupName`, `setupType`, `setupCountry`, `setupDomains`, `creatingInstitution`, `departments`, `deptName`, `creatingDepartment`, `domainsInput`, `savingDomains`, the seeding `useEffect`, `handleCreateInstitution`, `handleSaveDomains`, `handleCreateDepartment`, the `getDepartments` call inside `loadData`, and the now-unused imports (`normalizeDomainList`, `Clipboard`, `TextInput` if nothing else uses them).

`copyCode` is still referenced by the Share Code quick action, so it stays in `dashboard.tsx` **as well as** moving into `InstitutionCodeCard`. That is deliberate duplication of three lines, not an oversight — extracting a shared clipboard helper for it would be more indirection than the duplication costs.

- [ ] **Step 6: Verify nothing was left behind**

Run:

```bash
npx tsc --noEmit
grep -nE "setupName|deptName|domainsInput|savingDomains|creatingDepartment|creatingInstitution" "app/(admin)/dashboard.tsx"
```

Expected: `tsc` silent, `grep` finds nothing.

- [ ] **Step 7: Confirm the admin keys still all resolve**

Run:

```bash
python -c "
import json,re
used=set()
for f in ['app/(admin)/dashboard.tsx','src/components/institution/InstitutionSetupForm.tsx','src/components/institution/InstitutionCodeCard.tsx','src/components/institution/DepartmentsCard.tsx','src/components/institution/AllowedDomainsCard.tsx']:
    used|=set(re.findall(r\"t\('([a-zA-Z]+\.[a-zA-Z.]+)'\", open(f,encoding='utf-8').read()))
bad=False
for loc in ['en','tr','el','it','ro','de','sr']:
    d=json.load(open('src/i18n/locales/%s.json'%loc,encoding='utf-8'))
    for k in sorted(used):
        cur=d
        for p in k.split('.'): cur=cur.get(p) if isinstance(cur,dict) else None
        if not isinstance(cur,str): bad=True; print(loc,'MISSING',k)
print('keys:',len(used),'|','OK' if not bad else 'BROKEN')
"
```

Expected: `OK`, with no `MISSING` lines.

- [ ] **Step 8: Commit**

```bash
npx jest --silent
git add src/components/institution app/\(admin\)/dashboard.tsx src/services/admin.ts
git commit -m "refactor: extract the four institution management components

The advisor screen needs the same institution code, departments and
allowed-domain cards the admin dashboard has. Extracting the cards rather
than the whole dashboard block keeps that file's shell untouched — it was
translated this session, carries Task 14's edit card, and has never been
through a subagent review.

Also drops the admin_profiles write from createInstitution. The live
handle_new_user writes only profiles and the admin_profiles INSERT is
commented out, so the table has no rows and that update was already a
silent no-op.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Closing an institution

The `OWNS_INSTITUTION` lock fails closed. Without a way out it traps an advisor who later wants to join their university's real institution — the same no-in-app-remedy trap Task 14's allowed-domain field had, which was deliberately fixed rather than shipped.

**Files:**
- Modify: `src/services/admin.ts`

**Interfaces:**
- Consumes: `supabase` from `@/services/supabase`.
- Produces:
  - `adminService.countOtherMembers(institutionId: string, ownerId: string): Promise<number>`
  - `adminService.closeInstitution(institutionId: string, ownerId: string): Promise<void>` — throws `new Error('INSTITUTION_NOT_EMPTY')` when others remain.

  Task 5 calls both.

- [ ] **Step 1: Add both methods**

In `src/services/admin.ts`, after `updateAllowedEmailDomains`:

```ts
  async countOtherMembers(institutionId: string, ownerId: string): Promise<number> {
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId)
      .neq('id', ownerId);
    if (error) throw error;
    return count || 0;
  },

  async closeInstitution(institutionId: string, ownerId: string): Promise<void> {
    // Re-count here rather than trusting what the screen last rendered. A
    // student who joins while the confirmation dialog is open would otherwise
    // be orphaned by a delete the UI had already decided was safe.
    const remaining = await this.countOtherMembers(institutionId, ownerId);
    if (remaining > 0) throw new Error('INSTITUTION_NOT_EMPTY');

    // Deleting the institution row is all that is required. departments
    // .institution_id is ON DELETE CASCADE and profiles.institution_id and
    // .department_id are ON DELETE SET NULL, so the owner's own membership
    // clears itself. Do not null it by hand.
    const { error } = await supabase
      .from('institutions')
      .delete()
      .eq('id', institutionId)
      .eq('admin_id', ownerId);
    if (error) throw error;
  },
```

The `.eq('admin_id', ownerId)` is a second lock alongside RLS: even if a policy is loosened later, this call can only ever delete an institution the caller owns.

- [ ] **Step 2: Confirm there is a DELETE policy**

Run:

```bash
grep -n "ON institutions" -A 3 docs/admin-migration.sql | grep -i "delete"
```

Expected: **no output.** `docs/admin-migration.sql:369-373` defines SELECT, INSERT and UPDATE policies only, so with RLS enabled the delete is refused.

If there is no output, add a policy to `docs/institution-ownership-lock.sql` and note it must be applied with that migration:

```sql
-- Closing an institution is the only escape from the OWNS_INSTITUTION lock,
-- so the owner needs DELETE. Ownership-scoped, matching the existing SELECT/
-- INSERT/UPDATE policies on this table.
DROP POLICY IF EXISTS "Admin can delete own institution" ON institutions;
CREATE POLICY "Admin can delete own institution" ON institutions
  FOR DELETE TO authenticated USING (admin_id = auth.uid());
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: silent.

- [ ] **Step 4: Commit**

```bash
npx jest --silent
git add src/services/admin.ts docs/institution-ownership-lock.sql
git commit -m "feat: let an institution's owner close it while it is empty

The OWNS_INSTITUTION lock fails closed, so without this an advisor who
creates an institution can never join their university's real one.
Restricting the close to an institution with no other members keeps the
delete semantics unambiguous and still stops an advisor with students
from walking away silently, which is what the lock exists to prevent.

The member count is re-read inside closeInstitution rather than taken
from screen state: a student joining while the confirmation dialog is
open would otherwise be orphaned.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The advisor institution screen

**Files:**
- Create: `app/(advisor)/institution.tsx`
- Modify: `app/(advisor)/_layout.tsx`
- Modify: `app/(advisor)/profile.tsx` (the Privacy Policy row is at lines 522-536; the new row goes immediately above it, and the `borderBottomWidth: 0` style must move to whichever row is last)
- Modify: `src/i18n/locales/{en,tr,el,it,ro,de,sr}.json`

**Interfaces:**
- Consumes: `resolveInstitutionView` (Task 2), the four components (Task 3), `adminService.getInstitution` / `countOtherMembers` / `closeInstitution` (Tasks 3-4), `mapRpcError` (Task 1), `useAuthStore`.
- Produces: the route `/(advisor)/institution`.

- [ ] **Step 1: Add the locale strings**

New keys in the `advisor` object of all seven locales:

| key | en | tr |
|---|---|---|
| `myInstitution` | My Institution | Kurumum |
| `institutionIntro` | Create an institution to generate codes your students join with. You will manage it yourself — no administrator needed. | Öğrencilerinizin katılacağı kodları üretmek için bir kurum oluşturun. Yönetimi sizde olur, ayrıca bir yöneticiye gerek yoktur. |
| `institutionMemberOf` | You are a member of {{name}}. Its administrator manages it. | {{name}} üyesisiniz. Bu kurumu yöneticisi yönetiyor. |
| `createMyInstitution` | Create my institution | Kurumumu oluştur |
| `closeInstitution` | Close my institution | Kurumumu kapat |
| `closeInstitutionConfirm` | Close {{name}}? Its departments and codes are deleted. This cannot be undone. | {{name}} kapatılsın mı? Bölümleri ve kodları silinir. Bu işlem geri alınamaz. |
| `closeInstitutionBlocked` | {{count}} other members must leave before you can close this institution. | Bu kurumu kapatabilmeniz için {{count}} üyenin ayrılması gerekiyor. |
| `institutionClosed` | Institution closed. | Kurum kapatıldı. |

Remaining five locales:

- **de:** `Meine Institution` / `Erstellen Sie eine Institution, um Codes zu erzeugen, mit denen Ihre Studenten beitreten. Sie verwalten sie selbst — kein Administrator nötig.` / `Sie sind Mitglied von {{name}}. Die Institution wird von ihrem Administrator verwaltet.` / `Meine Institution erstellen` / `Meine Institution schließen` / `{{name}} schließen? Ihre Fachbereiche und Codes werden gelöscht. Das kann nicht rückgängig gemacht werden.` / `{{count}} weitere Mitglieder müssen die Institution verlassen, bevor Sie sie schließen können.` / `Institution geschlossen.`
- **el:** `Το ίδρυμά μου` / `Δημιουργήστε ένα ίδρυμα για να παραχθούν κωδικοί με τους οποίους θα συμμετέχουν οι φοιτητές σας. Θα το διαχειρίζεστε εσείς — δεν χρειάζεται διαχειριστής.` / `Είστε μέλος του {{name}}. Το ίδρυμα διαχειρίζεται ο διαχειριστής του.` / `Δημιουργία του ιδρύματός μου` / `Κλείσιμο του ιδρύματός μου` / `Κλείσιμο του {{name}}; Τα τμήματα και οι κωδικοί του διαγράφονται. Η ενέργεια δεν αναιρείται.` / `{{count}} ακόμη μέλη πρέπει να αποχωρήσουν πριν κλείσετε αυτό το ίδρυμα.` / `Το ίδρυμα έκλεισε.`
- **it:** `Il mio istituto` / `Crea un istituto per generare i codici con cui i tuoi studenti si uniranno. Lo gestirai tu — non serve un amministratore.` / `Sei membro di {{name}}. L'istituto è gestito dal suo amministratore.` / `Crea il mio istituto` / `Chiudi il mio istituto` / `Chiudere {{name}}? I suoi dipartimenti e codici verranno eliminati. L'operazione non è reversibile.` / `{{count}} altri membri devono uscire prima che tu possa chiudere questo istituto.` / `Istituto chiuso.`
- **ro:** `Instituția mea` / `Creează o instituție pentru a genera codurile cu care studenții tăi se alătură. O administrezi tu — nu este nevoie de un administrator.` / `Ești membru al {{name}}. Instituția este administrată de administratorul ei.` / `Creează instituția mea` / `Închide instituția mea` / `Închizi {{name}}? Departamentele și codurile sale vor fi șterse. Acțiunea nu poate fi anulată.` / `{{count}} alți membri trebuie să plece înainte să poți închide această instituție.` / `Instituție închisă.`
- **sr:** `Moja institucija` / `Kreirajte instituciju da biste generisali kodove sa kojima se vaši studenti pridružuju. Vi je vodite — administrator nije potreban.` / `Član ste institucije {{name}}. Njome upravlja njen administrator.` / `Kreiraj moju instituciju` / `Zatvori moju instituciju` / `Zatvoriti {{name}}? Njeni odseci i kodovi biće obrisani. Ovo se ne može poništiti.` / `{{count}} drugih članova mora da napusti instituciju pre nego što je zatvorite.` / `Institucija je zatvorena.`

- [ ] **Step 2: Verify placeholders survived translation**

Run:

```bash
python -c "
import json,re
h=lambda s:set(re.findall(r'\{\{(\w+)\}\}',s))
ref=json.load(open('src/i18n/locales/en.json',encoding='utf-8'))['advisor']
keys=['myInstitution','institutionIntro','institutionMemberOf','createMyInstitution','closeInstitution','closeInstitutionConfirm','closeInstitutionBlocked','institutionClosed']
for loc in ['en','tr','el','it','ro','de','sr']:
    d=json.load(open('src/i18n/locales/%s.json'%loc,encoding='utf-8'))['advisor']
    bad=[k for k in keys if not isinstance(d.get(k),str) or h(d[k])!=h(ref[k])]
    print(loc, bad or 'ok')
"
```

Expected: `ok` on all seven lines.

- [ ] **Step 3: Write the screen**

Create `app/(advisor)/institution.tsx`. It follows the layout conventions of `app/(admin)/dashboard.tsx` — `SafeAreaView` + `ScrollView` + `RefreshControl` — and uses the advisor accent colour already defined in `app/(advisor)/dashboard.tsx`.

```tsx
import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { adminService } from '@/services/admin';
import {
  InstitutionSetupForm, InstitutionCodeCard,
  DepartmentsCard, AllowedDomainsCard,
} from '@/components/institution';
import { resolveInstitutionView } from '@/utils/institutionView';
import { mapRpcError } from '@/utils/rpcErrors';
import { colors, spacing, borderRadius } from '@/theme';
import type { Institution } from '@/types/institution';

const ADVISOR_COLOR = colors.info;

export default function AdvisorInstitutionScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [institution, setInstitution] = useState<Institution | null>(null);
  const [otherMembers, setOtherMembers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [closing, setClosing] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const inst = await adminService.getInstitution(user.id);
      setInstitution(inst);
      setOtherMembers(inst ? await adminService.countOtherMembers(inst.id, user.id) : 0);
    } catch (err) {
      console.error('Advisor institution load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  function confirmClose() {
    if (!institution || !user) return;
    Alert.alert(
      t('advisor.closeInstitution'),
      t('advisor.closeInstitutionConfirm', { name: institution.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('advisor.closeInstitution'),
          style: 'destructive',
          onPress: async () => {
            setClosing(true);
            try {
              await adminService.closeInstitution(institution.id, user.id);
              setInstitution(null);
              setOtherMembers(0);
              Alert.alert(t('common.done'), t('advisor.institutionClosed'));
            } catch (err: any) {
              const info = mapRpcError(err?.message);
              Alert.alert(t('common.error'), t(info.key));
              await loadData();
            } finally {
              setClosing(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ADVISOR_COLOR} />
        </View>
      </SafeAreaView>
    );
  }

  const view = resolveInstitutionView(institution, user?.institutionId);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ADVISOR_COLOR]} />
        }
      >
        <Text style={styles.screenTitle}>{t('advisor.myInstitution')}</Text>

        {view === 'member' && (
          <View style={styles.card}>
            <Ionicons name="business-outline" size={40} color={colors.textDisabled} />
            <Text style={styles.memberText}>
              {t('advisor.institutionMemberOf', { name: user?.institutionName || '' })}
            </Text>
          </View>
        )}

        {view === 'setup' && !showSetup && (
          <View style={styles.card}>
            <Ionicons name="business-outline" size={40} color={ADVISOR_COLOR} />
            <Text style={styles.introText}>{t('advisor.institutionIntro')}</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setShowSetup(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.primaryBtnText}>{t('advisor.createMyInstitution')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {view === 'setup' && showSetup && user && (
          <InstitutionSetupForm
            ownerId={user.id}
            accentColor={ADVISOR_COLOR}
            onCreated={(inst) => { setInstitution(inst); setShowSetup(false); }}
            onCancel={() => setShowSetup(false)}
          />
        )}

        {view === 'owner' && institution && (
          <>
            <InstitutionCodeCard institution={institution} accentColor={ADVISOR_COLOR} />
            <AllowedDomainsCard
              institution={institution}
              onSaved={(domains) =>
                setInstitution({ ...institution, allowedEmailDomains: domains })}
            />
            <DepartmentsCard institution={institution} accentColor={ADVISOR_COLOR} />

            <TouchableOpacity
              style={[styles.closeBtn, otherMembers > 0 && { opacity: 0.5 }]}
              disabled={otherMembers > 0 || closing}
              onPress={confirmClose}
              activeOpacity={0.7}
            >
              {closing ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                  <Text style={styles.closeBtnText}>{t('advisor.closeInstitution')}</Text>
                </>
              )}
            </TouchableOpacity>

            {otherMembers > 0 && (
              <Text style={styles.closeHint}>
                {t('advisor.closeInstitutionBlocked', { count: otherMembers })}
              </Text>
            )}
          </>
        )}

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  screenTitle: {
    fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: borderRadius.md,
    padding: spacing.xl, alignItems: 'center', marginBottom: spacing.lg, elevation: 1,
  },
  introText: {
    fontSize: 14, color: colors.textSecondary, textAlign: 'center',
    marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 20,
  },
  memberText: {
    fontSize: 14, color: colors.textSecondary, textAlign: 'center',
    marginTop: spacing.sm, lineHeight: 20,
  },
  primaryBtn: {
    backgroundColor: ADVISOR_COLOR, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm, borderRadius: borderRadius.sm,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  closeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, paddingVertical: spacing.sm, marginTop: spacing.md,
  },
  closeBtnText: { color: colors.error, fontSize: 14, fontWeight: '500' },
  closeHint: {
    fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs,
  },
});
```

**If `user.institutionId` or `user.institutionName` do not exist on the auth store's user type**, do not invent them. Read the type in `src/types/`, and if the profile does not carry the institution id, fetch it in `loadData` with a `profiles` select on `user.id` and hold it in local state instead. Report which you did.

- [ ] **Step 4: Register the route without a tab**

In `app/(advisor)/_layout.tsx`, add after the `profile` screen:

```tsx
      <Tabs.Screen name="institution" options={{ href: null }} />
```

`href: null` keeps it out of the tab bar while leaving it routable — the same mechanism the admin layout already uses to hide tabs before an institution exists.

- [ ] **Step 5: Add the profile row**

In `app/(advisor)/profile.tsx`, insert immediately **above** the Privacy Policy block at line 522, and remove `{ borderBottomWidth: 0 }` from the new row (Privacy Policy stays last):

```tsx
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => router.push('/(advisor)/institution')}
            activeOpacity={0.6}
          >
            <View style={styles.settingsLeft}>
              <Ionicons name="business-outline" size={22} color={colors.primary} />
              <Text style={styles.settingsLabel}>{t('advisor.myInstitution')}</Text>
            </View>
            <View style={styles.settingsRight}>
              <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
            </View>
          </TouchableOpacity>
```

- [ ] **Step 6: Typecheck and verify keys**

Run:

```bash
npx tsc --noEmit
python -c "
import json,re
used=set(re.findall(r\"t\('([a-zA-Z]+\.[a-zA-Z.]+)'\", open('app/(advisor)/institution.tsx',encoding='utf-8').read()))
bad=False
for loc in ['en','tr','el','it','ro','de','sr']:
    d=json.load(open('src/i18n/locales/%s.json'%loc,encoding='utf-8'))
    for k in sorted(used):
        cur=d
        for p in k.split('.'): cur=cur.get(p) if isinstance(cur,dict) else None
        if not isinstance(cur,str): bad=True; print(loc,'MISSING',k)
print('keys:',len(used),'|','OK' if not bad else 'BROKEN')
"
```

Expected: `tsc` silent, `OK`.

- [ ] **Step 7: Commit**

```bash
npx jest --silent
git add app/\(advisor\)/institution.tsx app/\(advisor\)/_layout.tsx app/\(advisor\)/profile.tsx src/i18n/locales
git commit -m "feat: give advisors their own institution screen

Reached from the advisor profile, registered with href: null so it stays
out of the tab bar — that space belongs to the advisor's actual job.

The screen resolves three states rather than two. An advisor who joined
someone else's institution owns nothing, so getInstitution returns null;
offering them the setup form would let them overwrite their own
profiles.institution_id and silently detach from their university.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Verification

**Files:**
- Modify: `docs/join-hardening-verification.sql`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: Part E of the verification script.

- [ ] **Step 1: Write Part E**

Append to `docs/join-hardening-verification.sql`. It follows Parts B and C exactly — one submission, identity via `set_config(..., true)`, results accumulated in a text variable handed over through a transaction-local GUC, `ROLLBACK` at the end. **No temp table**; the editor cannot see one across statements in the same submission, which is documented at the head of that file.

Rather than requiring the database to already hold two institutions with departments, the block creates its own second institution inside the transaction. The `ROLLBACK` removes it, and it also temporarily rewrites a real institution's `admin_id` and `allowed_email_domains`, so Part D must be re-run afterwards.

```sql
-- ============================================================
-- PART E — the institution ownership lock
-- Submit everything from BEGIN to ROLLBACK in one go.
--
-- Expected rows:
--   15  OWNS_INSTITUTION
--   16  accepted   <- the `owned_id <> inst_id` regression test
--   17  accepted
-- ============================================================

BEGIN;

DO $$
DECLARE
  owner_id     UUID;
  bystander_id UUID;
  own_inst     UUID;
  own_dept     TEXT;
  other_inst   UUID;
  other_dept   TEXT;
  log          TEXT := '';
BEGIN
  SELECT d.institution_id, d.department_code INTO own_inst, own_dept
  FROM departments d ORDER BY d.created_at LIMIT 1;

  SELECT p.id INTO owner_id
  FROM profiles p WHERE p.email ~ '^[^@]+@[^@]+$' ORDER BY p.created_at LIMIT 1;

  IF own_dept IS NULL OR owner_id IS NULL THEN
    log := log || '15-17 lock' || E'\t' || 'SKIP: needs a department and a profile' || E'\n';
  ELSE
    -- Make the actor the owner of that institution, and clear the domain rule
    -- so it cannot interfere with what this part is measuring.
    UPDATE institutions SET admin_id = owner_id, allowed_email_domains = '{}'
    WHERE id = own_inst;

    -- A second institution to try to defect to. Created here so the test does
    -- not depend on the database already holding two.
    INSERT INTO institutions (name, country, admin_id, allowed_email_domains)
    VALUES ('Part E throwaway', 'XX', owner_id, '{}')
    RETURNING id INTO other_inst;

    -- institutions_admin_id_unique caps ownership at one per user, so the row
    -- above had to borrow owner_id. Hand it to someone else immediately.
    SELECT p.id INTO bystander_id
    FROM profiles p WHERE p.id <> owner_id ORDER BY p.created_at LIMIT 1;

    IF bystander_id IS NULL THEN
      log := log || '15-17 lock' || E'\t' || 'SKIP: needs a second profile' || E'\n';
    ELSE
      UPDATE institutions SET admin_id = bystander_id WHERE id = other_inst;

      INSERT INTO departments (institution_id, name)
      VALUES (other_inst, 'Part E throwaway dept')
      RETURNING department_code INTO other_dept;

      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', owner_id)::text, true);

      -- 15. The owner tries to defect to the other institution.
      BEGIN
        PERFORM join_department_by_code(other_dept);
        log := log || '15 defect' || E'\t' || 'FAIL: owner joined another institution' || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || '15 defect' || E'\t' || SQLERRM || E'\n';
      END;

      -- 16. The owner joins their OWN institution's department. This must
      --     still work. Writing the guard as a bare IS NOT NULL check would
      --     break this case silently.
      BEGIN
        PERFORM join_department_by_code(own_dept);
        log := log || '16 own dept' || E'\t' || 'accepted' || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || '16 own dept' || E'\t' || 'FAIL: ' || SQLERRM || E'\n';
      END;

      -- 17. Someone who owns nothing is unaffected. bystander_id owns
      --     other_inst by now, so borrow a third profile if one exists.
      SELECT p.id INTO bystander_id
      FROM profiles p
      WHERE NOT EXISTS (SELECT 1 FROM institutions i WHERE i.admin_id = p.id)
      ORDER BY p.created_at LIMIT 1;

      IF bystander_id IS NULL THEN
        log := log || '17 bystander' || E'\t' || 'SKIP: every profile owns an institution' || E'\n';
      ELSE
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', bystander_id)::text, true);
        BEGIN
          PERFORM join_department_by_code(own_dept);
          log := log || '17 bystander' || E'\t' || 'accepted' || E'\n';
        EXCEPTION WHEN OTHERS THEN
          log := log || '17 bystander' || E'\t' || 'FAIL: ' || SQLERRM || E'\n';
        END;
      END IF;
    END IF;
  END IF;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;
```

Update the file's header comment: the script now has five parts, and Part E — like Part C — rewrites real rows, so Part D is what proves the `ROLLBACK` held.

- [ ] **Step 2: Have the human run it**

Ask the user to run `docs/institution-ownership-lock.sql` first, then Parts A-E. Record each result. Do not mark this step done on Part E alone — the lock changes both join RPCs, so Parts B and C must be re-run to prove nothing regressed.

- [ ] **Step 3: Add the PROGRESS row**

Append to the Session Log table in `PROGRESS.md`:

```markdown
| 2026-08-03 | Session 14 | Advisor-owned institutions: an advisor can create and own an institution, so a single academic can run the app with only their own interns and no admin. Four institution management components extracted from the admin dashboard and shared with a new advisor screen; OWNS_INSTITUTION lock in both join RPCs stops an owner from moving into a different institution; closing an institution allowed while it has no other members. Migration: `docs/institution-ownership-lock.sql`; verification: Part E of `docs/join-hardening-verification.sql` |
```

- [ ] **Step 4: Device checklist**

Run through all five and record the actual result of each. Do not report this task complete with any line unverified.

1. An advisor with no institution opens Profile → My Institution → creates an institution, then a department.
2. A student joins with that department code and their profile shows a **composite** student code plus institution · department.
3. **The advisor links that student with their code and it succeeds.** This is the entire point of the work and was impossible before.
4. An advisor who belongs to an admin's institution sees the membership message and **no setup form**.
5. The close button is disabled while a student is a member, and works once the institution is empty.

- [ ] **Step 5: Commit**

```bash
git add docs/join-hardening-verification.sql PROGRESS.md
git commit -m "test: verify the institution ownership lock

Part E covers the lock refusing a different institution, still allowing
the owner into their own, and leaving non-owners alone. The middle case
is the regression test for owned_id <> inst_id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes for the implementer

**Task 3 must not change behaviour.** It is a pure extraction. If you find yourself improving the markup, renaming a style, or fixing something you noticed in the moved code, stop and report it instead. The admin dashboard has never been through a subagent review, so a regression there has nothing to catch it.

**The ownership check is not duplicated client-side.** `join_institution_by_code` and `join_department_by_code` own it. If you find yourself adding an "already owns an institution" check in TypeScript before an RPC call, that logic belongs in the RPC.

**`resolveInstitutionView` returning `member` is a real state, not a fallback.** An advisor in that state must never be offered a way to create an institution — no button, no hidden form, no pull-to-refresh path back to `setup`.
