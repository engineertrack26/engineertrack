# Partner Feedback — Package A: Compliance, Branding, and Join Hardening

**Date:** 2026-08-02
**Status:** Approved design, ready for implementation planning

## Background

The EngineerTrack user guide was reviewed by three consortium partners in July 2026 (responses in
`Turkiye – Feedback.xlsx`). All three approved the guide with minor revisions, but their answers
also contained a set of **application** change requests that documentation cannot address.

Those requests decompose into six independent packages. This spec covers **Package A** only —
the small, self-contained fixes. Packages B–F (competency tagging + deadlines, mentor-assigned
tasks, internship course setup + content repository, student community area, gamification
mini-games) are out of scope here and each need their own spec.

Package A ships in two slices:

| Slice | Contents | Rationale |
|---|---|---|
| 1 | GDPR/KVKK consent, login screen logo | Fully independent; closes a legal gap before release |
| 2 | Composite student code, per-institution e-mail domain rule, join issue reporting | All three touch the code/join paths and share one migration and one test pass |

### Source of each requirement

| Requirement | Reviewer | Verbatim request |
|---|---|---|
| GDPR consent | R1 (Bursa Teknik Üniversitesi) | "Users should be asked to accept the GDPR / Personal Data Consent Form on first login." |
| Login logo | R1 | "The project/application logo should appear on the login screen." |
| Composite student code | R1 | `InstitutionCode_DepartmentCode_StudentCode` → `7BW8HH29_CH96JV_H94FQV` |
| Institutional e-mail | R1 | "Is it possible to allow students to sign in only with institutional/school e-mail addresses?" |
| Join issue reporting | R3 (Steinbeis) | "A feature could be added to report problems experienced when joining with a department or institution code." |

---

## Slice 1 — Compliance and branding

### 1.1 Data model

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS consent_version  TEXT,
  ADD COLUMN IF NOT EXISTS consented_at     TIMESTAMPTZ;
```

Consent is stored as a **version**, not a boolean. GDPR requires evidence of *what* was consented
to; when the policy text changes, prior consent is no longer valid. A single constant drives this:

```ts
// src/utils/constants.ts
export const PRIVACY_POLICY_VERSION = '1.0';
```

Consent counts as current only when `profiles.consent_version === PRIVACY_POLICY_VERSION`.
Bumping the constant is the entire mechanism for re-prompting every user after a policy update —
no other code changes.

### 1.2 New-user path

Consent travels in the `signUp` metadata and is written by the existing `handle_new_user` trigger
(`docs/database-schema.sql:336`) in the same INSERT that creates the profile. Profile and consent
are therefore created atomically: there is no window in which a profile exists without consent,
whether or not e-mail confirmation is enabled.

Changes:

- `app/(auth)/register.tsx` — required consent checkbox with a tappable link to the policy screen.
  "Create Account" stays disabled while unchecked.
- `src/services/auth.ts` — add `consent_version` to the `signUp` metadata (alongside the existing
  `edu_email` handling at `src/services/auth.ts:50`).
- `handle_new_user` — extend the INSERT to populate `consent_version` and `consented_at`
  (`consented_at` = `now()` when a `consent_version` is present in the metadata, otherwise NULL).

### 1.3 Existing-user path

`app/index.tsx` is already the single gate for role-based redirection, so the consent check goes
there:

```
isAuthenticated && consent_version !== PRIVACY_POLICY_VERSION
    → redirect to /(auth)/consent
```

New screen `app/(auth)/consent.tsx`:

- Scrollable policy text, **Accept** and **Sign Out** buttons.
- Not dismissible: `headerShown: false`, `gestureEnabled: false`, no back affordance.
- Accept → write `consent_version` + `consented_at` to `profiles`, refresh `authStore`, continue
  to the role dashboard.

`authStore`'s `user` object gains a `consentVersion` field so the redirect decision needs no extra
query on every launch.

### 1.4 Policy text

Stored in `src/i18n/locales/*.json` under `legal.privacy.*`, split into **section-level keys**
(`title`, `dataWeCollect`, `whyWeCollect`, `retention`, `yourRights`, `contact`) rather than one
blob, so legal reviewers and translators can work section by section.

Content is derived from what the app actually collects: name, e-mail, institution/department,
student ID, workplace details, daily log content, uploaded photos and documents, XP/badge data,
and the Expo push token. The app collects no location, no contacts, and no analytics tracking —
stating this explicitly strengthens the policy.

An English draft will be written and translated into the other six languages. Each locale carries
`"_status": "DRAFT — requires legal review"` so the placeholder cannot be missed before release.

> **This draft is not legal advice and does not substitute for review by a qualified lawyer.**
> A DPO or legal reviewer must approve the text before the consent flow ships to real users.

The policy is also reachable at any time from all four role profile screens (a "Privacy Policy"
row) — continuous access to the policy is an explicit GDPR requirement, not a convenience.

### 1.5 Logo

`assets/icon.png` (the branded mark produced in commit `8163d4c`) is placed above the existing
"EngineerTrack" text on the login and register screens; the text remains as a wordmark. No new
asset generation is required.

### 1.6 Error handling

| Condition | Behaviour |
|---|---|
| Consent write fails | User stays on the gate, "Try again" is shown. **Never admitted without a stored consent.** |
| Offline | Policy text is bundled, so the screen renders; only the write needs the network and falls back to the row above. |
| `signUp` succeeds but the trigger does not record consent | User hits the existing-user path on first login and sees the consent gate. The two paths are each other's safety net. |

---

## Slice 2 — Linking and join hardening

### 2.1 Composite student code

The composite is derived from three codes that already exist in the schema
(`docs/admin-migration.sql`): `institutions.institution_code` (8 chars),
`departments.department_code` (6), `student_codes.code` (6). No new code generation.

```
institution_code(8) _ department_code(6) _ student_code(6)
7BW8HH29            _ CH96JV            _ H94FQV
```

**Edge case:** a student who has not yet joined a department has no institution or department
code, so no composite can be formed. The profile screen therefore has two states:

- Joined → composite code, with institution and department names beneath it.
- Not joined → the plain 6-character code plus "Your code will include your institution details
  once you join a department."

A new `get_my_student_code()` RPC (SECURITY DEFINER) returns `code`, `composite_code`,
`institution_name`, and `department_name` in one call. This also solves the RLS problem: students
cannot read the `institutions` table directly.

`link_student_by_code(p_code, p_role)` gains parsing:

| Input | Behaviour |
|---|---|
| `H94FQV` | Treated as the student code — existing behaviour, unchanged |
| `7BW8HH29_CH96JV_H94FQV` | Split into 3 segments; segment 3 is the student code; segments 1 and 2 are compared against the student's actual institution and department codes |
| `7BW8HH29_H94FQV` | `INVALID_CODE_FORMAT` — wrong segment count |
| Segments resolve but do not match | `CODE_SEGMENT_MISMATCH` |

Segment validation checks the code's **internal consistency**, not the caller's institution. This
distinction matters: mentors are company supervisors and usually belong to a different institution,
which is why the existing function skips the institution check for mentors. Segment validation
layers on top without disturbing that; the advisor's existing `INSTITUTION_MISMATCH` check is
unchanged.

Input handling on the mentor and advisor link screens: accept paste, auto-uppercase, strip
whitespace, with the hint "Enter the full code or just the last 6 characters."

### 2.2 Per-institution e-mail domain rule

```sql
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS allowed_email_domains TEXT[] NOT NULL DEFAULT '{}';
```

**An empty array means no restriction.** Every existing institution therefore continues to work
unchanged and the pilot is not disrupted.

Enforcement lives in `join_department_by_code`, before the profile is updated. The restriction
naturally reaches exactly the right audience: only students and advisors call this RPC. Mentors
never join a department — they link students by code — so company-employed mentors cannot be
locked out.

**Matching is exact**, with no subdomain inference. For a student at `ogr.btu.edu.tr` the admin
must add that domain to the list explicitly. Rationale: this is a security boundary, and suffix
matching would let an admin who types `edu.tr` unknowingly admit every Turkish university.
Predictability is worth more than convenience here.

Admin UI: a comma-separated field on the institution setup and edit screens. Values are
lowercased and a leading `@` is stripped on save.

### 2.3 Join issue reporting

```sql
CREATE TABLE IF NOT EXISTS join_issue_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  attempted_code  TEXT NOT NULL,
  reason_code     TEXT NOT NULL,
  note            TEXT,
  institution_id  UUID REFERENCES institutions(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

`reason_code` is one of `INVALID_CODE`, `EMAIL_DOMAIN_BLOCKED`, `CODE_SEGMENT_MISMATCH`.

A "Report a problem" affordance appears on **both** failing surfaces, since both can strand a
user: the student/advisor department-join screen, and the mentor/advisor student-link screen. The
form is the same in each — the attempted code and reason are pre-filled, and the user adds a note.

The table is an append-only audit record with no `status` column. When an admin receives a report
the action is to re-share or regenerate the code; there is no application state to track, and a
status field would go stale unmaintained.

**Routing has an honest limit** — a report can only reach an admin when the institution is
resolvable:

| Reason | Institution resolvable? | Routing |
|---|---|---|
| `EMAIL_DOMAIN_BLOCKED` | Yes — the code resolved | Notification + push to that institution's admin |
| `CODE_SEGMENT_MISMATCH` | Yes — from the code segments | Same |
| `INVALID_CODE` | No | Routed to the reporter's existing institution if they have one; otherwise stored with `institution_id NULL` and visible only to the project team in Supabase |

The alternative designs were rejected: asking the student for an institution code adds friction to
a flow they are already failing, and showing unroutable reports to every admin would leak data
across institutions. The message shown to the student is correspondingly honest: "Your report has
been recorded. Please also contact whoever gave you the code."

In practice the common real cases (a blocked domain, or a valid code for the wrong department) are
routable; only a wholly incorrect code is not.

Notifications reuse the existing `notifications` table and push infrastructure — no new channel.

RLS on `join_issue_reports`: INSERT only as oneself (`reporter_id = auth.uid()`), SELECT only by
that institution's admin, no UPDATE or DELETE.

### 2.4 Error codes

All three RPCs raise **stable error codes** instead of raw English sentences —
`INVALID_CODE_FORMAT`, `CODE_SEGMENT_MISMATCH`, `EMAIL_DOMAIN_BLOCKED`, `INSTITUTION_MISMATCH`,
`INVALID_CODE`, `EXPIRED_CODE`. The service layer maps them to i18n keys.

This is the concrete answer to R3's repeated complaint that the code and join flows are unclear:
the user now reads what went wrong in their own language.

---

## Verification

The repository has no test framework (`package.json` has no test script, jest, or vitest).
Verification therefore has four parts:

1. `npx tsc --noEmit` — zero errors.
2. **New:** minimal Jest setup (`jest` + `ts-jest`) covering the pure helpers only — code
   normalisation, composite parsing, and domain matching (~15 tests). These are the functions
   where off-by-one and casing bugs hide, and the setup carries forward to Packages B–F.
3. A verification SQL script run after the migration, asserting: both the composite and the short
   code link successfully; a wrong segment is rejected; an empty `allowed_email_domains` imposes
   no restriction; a populated one blocks a non-matching address.
4. A manual emulator pass: student profile in both states (joined / not joined), mentor linking,
   advisor linking, a blocked join followed by an issue report, and the admin receiving the
   notification.

## Out of scope

Packages B–F, and every documentation change requested in the same feedback (figure re-captures,
Quick Start, FAQ, troubleshooting, glossary, workflow diagram). The documentation work is tracked
separately against `docs/EngineerTrack-User-Guide.docx`.
