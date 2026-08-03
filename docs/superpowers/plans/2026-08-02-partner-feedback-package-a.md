# Partner Feedback Package A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the app-side changes requested in the July 2026 consortium review of the user guide — GDPR/KVKK consent, login branding, composite student codes, per-institution e-mail domain rules, and join issue reporting.

**Architecture:** Two independent slices. Slice 1 adds a version-based consent gate in front of the existing role redirect in `app/index.tsx`, plus a bundled multilingual policy. Slice 2 hardens the two code paths — student linking (`link_student_by_code`) and department joining (`join_department_by_code`) — with parsing, domain rules, stable error codes, and a reporting RPC. All security decisions live in `SECURITY DEFINER` Postgres functions; client-side helpers handle input shape and display only.

**Tech Stack:** Expo SDK 54, React Native, TypeScript, Expo Router, Supabase (Postgres + RLS + RPC), Zustand, i18next (7 locales), Jest + ts-jest (new).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-02-partner-feedback-package-a-design.md`. Read it before starting.
- Path aliases only (`@/`, `@services/`, `@components/`, …). Never relative paths from outside `src/`.
- Every new user-facing string must exist in **all seven** locales: `en, tr, el, it, ro, de, sr` (`src/i18n/locales/*.json`).
- `npx tsc --noEmit` must pass with zero errors before every commit.
- Existing behaviour must not break: an empty `allowed_email_domains` means **no restriction**, and a bare 6-character student code must keep working.
- Client-side code parsing validates **shape only** (segment count and length). Segment *identity* — does this institution code belong to this student — is checked server-side only. Never move an identity check into the client.
- SQL migrations are applied by the user through the Supabase SQL editor. Tasks that add SQL end with the user applying it and the implementer verifying with a `SELECT`.
- `PRIVACY_POLICY_VERSION` is the single switch for re-prompting consent. Do not add a second boolean.
- The privacy policy text is a **draft pending legal review** and must carry the `_status` marker in every locale.
- Install dev dependencies with `npm install --save-dev` (the repo's `.npmrc` sets `legacy-peer-deps=true`; do not override it).

---

# Slice 1 — Compliance and branding

### Task 1: Jest infrastructure and the consent version helper

Sets up the test harness the rest of the plan uses, and proves it works on the smallest real helper.

**Files:**
- Create: `jest.config.js`
- Create: `src/utils/consent.ts`
- Create: `src/utils/__tests__/consent.test.ts`
- Modify: `package.json` (add `test` script and dev dependencies)

**Interfaces:**
- Consumes: nothing
- Produces: `isConsentCurrent(stored: string | null | undefined, current: string): boolean`

- [ ] **Step 1: Install the test dependencies**

```bash
npm install --save-dev jest@^29.7.0 ts-jest@^29.2.5 @types/jest@^29.5.14
```

- [ ] **Step 2: Create the Jest config**

Only pure TypeScript helpers under `src/utils/` are tested. There is deliberately no React Native transform: nothing in these tests imports a component or a native module, and adding `jest-expo` would buy transform complexity we do not need.

```js
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

- [ ] **Step 3: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "jest"
```

- [ ] **Step 4: Write the failing test**

```ts
// src/utils/__tests__/consent.test.ts
import { isConsentCurrent } from '@/utils/consent';

describe('isConsentCurrent', () => {
  it('accepts a stored version equal to the current one', () => {
    expect(isConsentCurrent('1.0', '1.0')).toBe(true);
  });

  it('rejects an older stored version', () => {
    expect(isConsentCurrent('1.0', '1.1')).toBe(false);
  });

  it('rejects a missing consent', () => {
    expect(isConsentCurrent(null, '1.0')).toBe(false);
    expect(isConsentCurrent(undefined, '1.0')).toBe(false);
  });

  it('rejects an empty or whitespace-only stored version', () => {
    expect(isConsentCurrent('', '1.0')).toBe(false);
    expect(isConsentCurrent('   ', '1.0')).toBe(false);
  });

  it('ignores surrounding whitespace on a valid version', () => {
    expect(isConsentCurrent(' 1.0 ', '1.0')).toBe(true);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx jest src/utils/__tests__/consent.test.ts`
Expected: FAIL — `Cannot find module '@/utils/consent'`

- [ ] **Step 6: Write the implementation**

```ts
// src/utils/consent.ts

/**
 * Consent is current only when the stored version matches the version the app
 * is shipping. Bumping PRIVACY_POLICY_VERSION invalidates every prior consent,
 * which is exactly how a policy update is rolled out.
 */
export function isConsentCurrent(
  stored: string | null | undefined,
  current: string,
): boolean {
  if (!stored) return false;
  return stored.trim() === current.trim();
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx jest src/utils/__tests__/consent.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 8: Verify types still compile**

Run: `npx tsc --noEmit`
Expected: no output (zero errors)

- [ ] **Step 9: Commit**

```bash
git add jest.config.js package.json package-lock.json src/utils/consent.ts src/utils/__tests__/consent.test.ts
git commit -m "test: add Jest setup and consent version helper"
```

---

### Task 2: Consent database migration

**Files:**
- Create: `docs/consent-migration.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `profiles.consent_version TEXT`, `profiles.consented_at TIMESTAMPTZ`, RPC `record_consent(p_version TEXT) RETURNS VOID`

- [ ] **Step 1: Write the migration**

`record_consent` is a `SECURITY DEFINER` RPC rather than a direct table update because `authService.updateProfile` allowlists updatable columns (`src/services/auth.ts:156`) and the gamification lockdown in Session 12 revoked broad column grants on `profiles`. An RPC sidesteps the grant question entirely and keeps the write auditable in one place.

```sql
-- docs/consent-migration.sql
-- Slice 1 of partner feedback package A: GDPR/KVKK consent storage.

-- 1. Consent columns on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS consent_version  TEXT,
  ADD COLUMN IF NOT EXISTS consented_at     TIMESTAMPTZ;

-- 2. Record consent for the calling user
CREATE OR REPLACE FUNCTION record_consent(p_version TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_version IS NULL OR trim(p_version) = '' THEN
    RAISE EXCEPTION 'INVALID_CONSENT_VERSION';
  END IF;

  UPDATE profiles
  SET consent_version = trim(p_version),
      consented_at    = now()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION record_consent(TEXT) TO authenticated;

-- 3. Capture consent at signup, atomically with profile creation.
--    Replaces the version in docs/database-schema.sql:329.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, role, first_name, last_name, language,
    consent_version, consented_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'language', 'en'),
    NEW.raw_user_meta_data->>'consent_version',
    CASE
      WHEN NEW.raw_user_meta_data->>'consent_version' IS NOT NULL THEN now()
      ELSE NULL
    END
  );
  RETURN NEW;
END;
$$;
```

- [ ] **Step 2: Apply the migration**

Ask the user to paste `docs/consent-migration.sql` into the Supabase SQL editor and run it. Do not proceed until they confirm.

- [ ] **Step 3: Verify the schema changed**

Run this in the Supabase SQL editor and confirm two rows come back:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name IN ('consent_version', 'consented_at');
```

Expected: `consent_version | text` and `consented_at | timestamp with time zone`.

- [ ] **Step 4: Verify the RPC exists and rejects an empty version**

```sql
SELECT record_consent('');
```

Expected: ERROR `NOT_AUTHENTICATED`. The Supabase SQL editor runs as `postgres` with no JWT, so
`auth.uid()` is NULL and the function's *first* guard fires. This confirms the function exists and
is callable — it does not exercise the empty-version guard.

To reach the second guard, supply a JWT claim inside a transaction that is rolled back:

```sql
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000"}', true);
SELECT record_consent('');
ROLLBACK;
```

Expected: ERROR `INVALID_CONSENT_VERSION`.

Then verify the trigger's normalisation truth table directly, without needing a real signup:

```sql
SELECT
  v                                        AS input,
  NULLIF(trim(v), '')                      AS consent_version,
  NULLIF(trim(v), '') IS NOT NULL          AS consented_at_set
FROM (VALUES (NULL), (''), ('   '), ('1.0')) AS t(v);
```

Expected: only the `'1.0'` row has a non-null `consent_version` and `consented_at_set = true`;
the other three rows are NULL / false.

- [ ] **Step 5: Commit**

```bash
git add docs/consent-migration.sql
git commit -m "feat: add consent columns, record_consent RPC, and signup trigger update"
```

---

### Task 3: Consent plumbing in the auth service and store

**Files:**
- Modify: `src/types/user.ts:5-16` (add `consentVersion` to `User`)
- Modify: `src/services/auth.ts:8-16` (SignUpParams), `:42-59` (signUp), `:86-106` (getProfile)
- Modify: `src/utils/constants.ts` (add `PRIVACY_POLICY_VERSION`)

**Interfaces:**
- Consumes: `isConsentCurrent` from Task 1, `record_consent` RPC from Task 2
- Produces: `User.consentVersion?: string`, `PRIVACY_POLICY_VERSION: string`, `authService.recordConsent(version: string): Promise<void>`, `signUp({ ..., consentVersion })`

- [ ] **Step 1: Add the policy version constant**

Append to `src/utils/constants.ts`:

```ts
/**
 * Bumping this invalidates every stored consent and re-prompts all users.
 * Change it whenever the text under `legal.privacy` in the locale files changes
 * in substance.
 */
export const PRIVACY_POLICY_VERSION = '1.0';
```

- [ ] **Step 2: Add `consentVersion` to the User type**

In `src/types/user.ts`, add to the `User` interface after `avatarUrl`:

```ts
  consentVersion?: string;
```

- [ ] **Step 3: Map the column in `getProfile`**

In `src/services/auth.ts`, inside the `profile: User = { ... }` object literal (around line 101), add after the `avatarUrl` line:

```ts
      consentVersion: (row.consent_version as string) || undefined,
```

- [ ] **Step 4: Pass consent through signUp**

In `src/services/auth.ts`, add to `SignUpParams`:

```ts
  consentVersion?: string;
```

Change the `signUp` signature destructuring to include `consentVersion`, and add to the metadata block after the `edu_email` branch:

```ts
    if (consentVersion) {
      metadata.consent_version = consentVersion;
    }
```

- [ ] **Step 5: Add `recordConsent` to the auth service**

Add this method to `authService`, after `updateLanguage`:

```ts
  async recordConsent(version: string) {
    const { error } = await supabase.rpc('record_consent', { p_version: version });
    if (error) throw error;
  },
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add src/types/user.ts src/services/auth.ts src/utils/constants.ts
git commit -m "feat: thread consent version through auth service and User type"
```

---

### Task 4: Privacy policy text and screen

**Files:**
- Create: `app/(auth)/privacy-policy.tsx`
- Modify: `app/(auth)/_layout.tsx` (register the screen)
- Modify: `src/i18n/locales/en.json` (add `legal` namespace)
- Modify: `src/i18n/locales/{tr,el,it,ro,de,sr}.json` (translated `legal` namespace)

**Interfaces:**
- Consumes: `PRIVACY_POLICY_VERSION` from Task 3
- Produces: route `/(auth)/privacy-policy`, i18n keys `legal.privacy.*`

- [ ] **Step 1: Add the English policy text**

Add this top-level `legal` object to `src/i18n/locales/en.json`:

```json
"legal": {
  "privacy": {
    "_status": "DRAFT — requires legal review before release",
    "title": "Privacy Policy and Data Protection Notice",
    "versionLabel": "Version {{version}}",
    "intro": "EngineerTrack records your internship activity so that your company mentor and university advisor can review and validate it. This notice explains what we store, why we store it, and the rights you have over it. It applies to all users of the app.",
    "dataWeCollectTitle": "Data we collect",
    "dataWeCollect": "Account details: first and last name, e-mail address, role, and interface language.\nInstitution details: university, faculty, department, student number, and the institution and department codes you join with.\nWorkplace details: company name, address, sector, and internship start and end dates.\nInternship records: your daily log entries, the hours you record, your self-assessment scores, and the photos and documents you upload.\nMentor and advisor input: competency ratings, written feedback, approval and validation decisions.\nProgress data: XP, level, streaks, and badges.\nTechnical data: a push notification token used only to deliver notifications to your device.",
    "notCollectedTitle": "What we do not collect",
    "notCollected": "We do not collect your location, your contacts, your device identifiers for advertising, or any analytics tracking of your behaviour outside the app. We do not sell any data and we do not share it with advertisers.",
    "whyWeCollectTitle": "Why we collect it",
    "whyWeCollect": "To let you record your internship and to let your mentor and advisor review, rate, and validate it — this is the core service you signed up for.\nTo produce the reports your university needs to grade or certify your internship.\nTo operate the motivation features (XP, levels, badges, and the leaderboard within your own department).\nTo send you notifications about feedback, approvals, and validations.",
    "sharingTitle": "Who can see your data",
    "sharing": "Your daily logs, uploads, and self-assessments are visible to the mentor and advisor linked to your account, and to the administrator of your institution. Other students see only your first name and score on the leaderboard for your own department. Nobody outside your institution can see your records.",
    "retentionTitle": "How long we keep it",
    "retention": "Internship records are kept for as long as your institution needs them to certify the internship, and are deleted on request once that purpose ends. Account details are kept until you ask us to delete your account.",
    "yourRightsTitle": "Your rights",
    "yourRights": "You may ask to see the data we hold about you, to correct anything inaccurate, to have your data deleted, or to receive a copy of it. You may also withdraw this consent, though doing so means the app can no longer be used, because recording and reviewing internship data is its only function.",
    "contactTitle": "Contact",
    "contact": "To exercise any of these rights, contact the administrator of your institution through the app, or write to the EngineerTrack project team at the address published by your institution.",
    "consentCheckbox": "I have read and accept the Privacy Policy and Data Protection Notice.",
    "readPolicy": "Read the Privacy Policy",
    "accept": "Accept",
    "updatedTitle": "Our Privacy Policy has been updated",
    "updatedBody": "Please review and accept the updated notice to continue using EngineerTrack.",
    "acceptFailed": "We could not record your acceptance. Check your connection and try again."
  }
}
```

- [ ] **Step 2: Translate the block into the other six locales**

Copy the same key structure into `tr.json`, `el.json`, `it.json`, `ro.json`, `de.json`, and `sr.json`, translating every value except `_status`, which stays in English so it is obvious in every file.

Keep `{{version}}` intact in `versionLabel`.

Preserve the `\n` separators in `dataWeCollect`, `whyWeCollect` — the screen splits on them to render bullets.

- [ ] **Step 3: Verify key parity across all seven locales**

```bash
python -c "
import json,io
base=json.load(io.open('src/i18n/locales/en.json',encoding='utf-8'))['legal']['privacy']
for loc in ['tr','el','it','ro','de','sr']:
    d=json.load(io.open('src/i18n/locales/%s.json'%loc,encoding='utf-8'))
    missing=set(base)-set(d.get('legal',{}).get('privacy',{}))
    print(loc, 'MISSING:', sorted(missing) if missing else 'none')
"
```

Expected: `none` for all six locales.

- [ ] **Step 4: Create the policy screen**

```tsx
// app/(auth)/privacy-policy.tsx
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { PRIVACY_POLICY_VERSION } from '@/utils/constants';
import { colors } from '@/theme';

function Section({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {body.split('\n').map((line, index) => (
        <Text key={index} style={styles.sectionBody}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export default function PrivacyPolicyScreen() {
  const { t } = useTranslation();

  // scroll={false}: ScreenWrapper scrolls by default, and a ScrollView nested
  // in a same-axis ScrollView does not scroll reliably on Android — which on a
  // legal notice means the user cannot reach the end of the text.
  return (
    <ScreenWrapper scroll={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('legal.privacy.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.version}>
          {t('legal.privacy.versionLabel', { version: PRIVACY_POLICY_VERSION })}
        </Text>
        <Text style={styles.intro}>{t('legal.privacy.intro')}</Text>

        <Section
          title={t('legal.privacy.dataWeCollectTitle')}
          body={t('legal.privacy.dataWeCollect')}
        />
        <Section
          title={t('legal.privacy.notCollectedTitle')}
          body={t('legal.privacy.notCollected')}
        />
        <Section
          title={t('legal.privacy.whyWeCollectTitle')}
          body={t('legal.privacy.whyWeCollect')}
        />
        <Section
          title={t('legal.privacy.sharingTitle')}
          body={t('legal.privacy.sharing')}
        />
        <Section
          title={t('legal.privacy.retentionTitle')}
          body={t('legal.privacy.retention')}
        />
        <Section
          title={t('legal.privacy.yourRightsTitle')}
          body={t('legal.privacy.yourRights')}
        />
        <Section
          title={t('legal.privacy.contactTitle')}
          body={t('legal.privacy.contact')}
        />
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  content: {
    paddingBottom: 40,
  },
  version: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  intro: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginBottom: 8,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: 6,
  },
});
```

- [ ] **Step 5: Register the route**

In `app/(auth)/_layout.tsx`, add inside the `Stack`:

```tsx
      <Stack.Screen name="privacy-policy" />
```

- [ ] **Step 6: Add a policy link to all four role profile screens**

Continuous access to the policy is an explicit GDPR requirement, not a convenience — a user who
consented must be able to re-read what they agreed to. Expo Router resolves absolute paths across
route groups, so a `(student)` screen can push an `(auth)` route.

In each of `app/(student)/profile.tsx`, `app/(mentor)/profile.tsx`, `app/(advisor)/profile.tsx`,
and `app/(admin)/profile.tsx`, add this row inside the settings card that already holds the
language and password rows:

```tsx
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => router.push('/(auth)/privacy-policy')}
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.settingLabel}>{t('legal.privacy.title')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
```

Match the surrounding rows' style names in each file rather than introducing new ones — the four
profile screens each have their own settings-row styles. Add `router` to the `expo-router` import
where it is not already present.

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 8: Verify in the emulator**

Open each role's Profile tab and tap the Privacy Policy row. Expected: the policy screen opens in
the current interface language and the back arrow returns to the profile.

- [ ] **Step 9: Commit**

```bash
git add app/(auth)/privacy-policy.tsx app/(auth)/_layout.tsx app/(student)/profile.tsx app/(mentor)/profile.tsx app/(advisor)/profile.tsx app/(admin)/profile.tsx src/i18n/locales
git commit -m "feat: add privacy policy screen and legal namespace in seven locales"
```

---

### Task 5: Consent gate screen and redirect

**Files:**
- Create: `app/(auth)/consent.tsx`
- Modify: `app/(auth)/_layout.tsx` (register the screen, disable the gesture)
- Modify: `app/index.tsx:17-32` (insert the gate before the role switch)
- Modify: `app/_layout.tsx:192-204` (exempt consent and privacy-policy from the protected-routing bounce-back)

**Interfaces:**
- Consumes: `isConsentCurrent` (Task 1), `PRIVACY_POLICY_VERSION` and `authService.recordConsent` (Task 3), `legal.privacy.*` (Task 4)
- Produces: route `/(auth)/consent`

- [ ] **Step 1: Create the consent screen**

```tsx
// app/(auth)/consent.tsx
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { Button } from '@/components/common/Button';
import { authService } from '@/services/auth';
import { useAuthStore } from '@/store/authStore';
import { PRIVACY_POLICY_VERSION } from '@/utils/constants';
import { colors } from '@/theme';

export default function ConsentScreen() {
  const { t } = useTranslation();
  const { user, setUser } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleAccept() {
    setIsSubmitting(true);
    try {
      await authService.recordConsent(PRIVACY_POLICY_VERSION);
      if (user) {
        setUser({ ...user, consentVersion: PRIVACY_POLICY_VERSION });
      }
      router.replace('/');
    } catch {
      // Never let the user through without a stored consent.
      Alert.alert(t('common.error'), t('legal.privacy.acceptFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    try {
      await authService.signOut();
    } finally {
      router.replace('/(auth)/login');
    }
  }

  // scroll={false}: this screen owns its own ScrollView between a fixed header
  // and fixed actions; ScreenWrapper's default ScrollView would nest them.
  return (
    <ScreenWrapper scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('legal.privacy.updatedTitle')}</Text>
        <Text style={styles.subtitle}>{t('legal.privacy.updatedBody')}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.version}>
          {t('legal.privacy.versionLabel', { version: PRIVACY_POLICY_VERSION })}
        </Text>
        <Text style={styles.body}>{t('legal.privacy.intro')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.dataWeCollectTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.dataWeCollect')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.notCollectedTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.notCollected')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.whyWeCollectTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.whyWeCollect')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.sharingTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.sharing')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.retentionTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.retention')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.yourRightsTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.yourRights')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.contactTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.contact')}</Text>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          title={t('legal.privacy.accept')}
          onPress={handleAccept}
          loading={isSubmitting}
        />
        <Button
          title={t('auth.signOut')}
          onPress={handleSignOut}
          variant="ghost"
        />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  version: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 6,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  actions: {
    gap: 8,
    paddingTop: 12,
  },
});
```

- [ ] **Step 2: Register the route so it cannot be dismissed**

In `app/(auth)/_layout.tsx`, add:

```tsx
      <Stack.Screen name="consent" options={{ gestureEnabled: false }} />
```

- [ ] **Step 3: Insert the gate in the root redirect**

In `app/index.tsx`, add the imports:

```tsx
import { isConsentCurrent } from '@/utils/consent';
import { PRIVACY_POLICY_VERSION } from '@/utils/constants';
```

Then, between the `!isAuthenticated` check (line 17-19) and the `switch (user?.role)` (line 21), insert:

```tsx
  if (!isConsentCurrent(user?.consentVersion, PRIVACY_POLICY_VERSION)) {
    return <Redirect href="/(auth)/consent" />;
  }
```

- [ ] **Step 4: Exempt the consent and policy routes from the protected-routing bounce-back**

`app/_layout.tsx` already has a protected-routing effect that pushes any authenticated user out
of the `(auth)` group:

```tsx
    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/');
    }
```

Left alone, this fights the gate from Step 3 in an infinite loop: `app/index.tsx` redirects the
user to `/(auth)/consent`, the effect sees an authenticated user inside `(auth)` and replaces
back to `/`, the gate redirects again, forever. The consent screen never stays mounted, so it
can never be accepted.

The same collision silently breaks the privacy-policy row added in Task 4 — that route is also
under `(auth)` and is opened from all four authenticated profile screens, so it bounces straight
back to the dashboard.

Both routes must stay inside `(auth)`: the policy screen is also linked from the **register**
screen in Task 6, where the user is not authenticated, so moving it out of the group would trip
the `!isAuthenticated && !inAuthGroup` branch instead. Exempt them by name.

Add at module scope in `app/_layout.tsx`, above the component:

```tsx
// Routes inside (auth) that an ALREADY authenticated user is legitimately on:
// the consent gate that app/index.tsx sends them to, and the privacy policy,
// which every role's profile links to. Without this exemption the bounce-back
// below fights the consent gate in an infinite redirect loop.
const AUTHENTICATED_AUTH_ROUTES = ['consent', 'privacy-policy'];
```

and change the effect body to:

```tsx
    const inAuthGroup = segments[0] === '(auth)';
    const isSharedAuthRoute = AUTHENTICATED_AUTH_ROUTES.includes(segments[1] as string);

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup && !isSharedAuthRoute) {
      router.replace('/');
    }
```

Leave the effect's dependency array and the rest of the file unchanged.


- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 6: Verify in the emulator**

Run `npx expo start --clear`, then:
1. Sign in as an existing demo student. Expected: the consent screen appears instead of the dashboard.
2. Press the Android back button. Expected: nothing happens — the screen does not dismiss.
3. Tap **Accept**. Expected: the student dashboard loads.
4. Force-quit and sign in again. Expected: straight to the dashboard, no consent screen.
5. In the Supabase SQL editor, confirm the write:

```sql
SELECT email, consent_version, consented_at FROM profiles WHERE consent_version IS NOT NULL;
```

- [ ] **Step 7: Commit**

```bash
git add app/(auth)/consent.tsx app/(auth)/_layout.tsx app/index.tsx app/_layout.tsx
git commit -m "feat: gate the app behind a versioned consent screen"
```

---

### Task 6: Consent checkbox on registration

**Files:**
- Modify: `app/(auth)/register.tsx:24-32` (state), `:34-73` (validate), `:75-114` (submit), `:227-232` (checkbox above the button)

**Interfaces:**
- Consumes: `PRIVACY_POLICY_VERSION` (Task 3), `legal.privacy.consentCheckbox` (Task 4), route `/(auth)/privacy-policy` (Task 4)
- Produces: nothing

- [ ] **Step 1: Add state and imports**

Add to the imports in `app/(auth)/register.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { PRIVACY_POLICY_VERSION } from '@/utils/constants';
```

Add to the state block after `isSubmitting`:

```tsx
  const [consentAccepted, setConsentAccepted] = useState(false);
```

- [ ] **Step 2: Pass the consent version on signup**

In `handleRegister`, add to the `authService.signUp({ ... })` argument object:

```tsx
        consentVersion: PRIVACY_POLICY_VERSION,
```

- [ ] **Step 3: Add the checkbox above the register button**

Insert immediately before the `<Button title={t('auth.register')} ... />` element:

```tsx
          <View style={styles.consentRow}>
            <TouchableOpacity
              onPress={() => setConsentAccepted((value) => !value)}
              style={styles.checkbox}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consentAccepted }}
            >
              <Ionicons
                name={consentAccepted ? 'checkbox' : 'square-outline'}
                size={22}
                color={consentAccepted ? colors.primary : colors.textSecondary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.consentTextWrap}
              onPress={() => router.push('/(auth)/privacy-policy')}
            >
              <Text style={styles.consentText}>
                {t('legal.privacy.consentCheckbox')}
              </Text>
              <Text style={styles.consentLink}>{t('legal.privacy.readPolicy')}</Text>
            </TouchableOpacity>
          </View>
```

- [ ] **Step 4: Disable the button until the box is checked**

Change the register `<Button>` to:

```tsx
          <Button
            title={t('auth.register')}
            onPress={handleRegister}
            loading={isSubmitting}
            disabled={!consentAccepted}
            style={styles.registerButton}
          />
```

- [ ] **Step 5: Add the styles**

Add to the `StyleSheet.create({ ... })` block:

```tsx
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 16,
  },
  checkbox: {
    paddingTop: 1,
  },
  consentTextWrap: {
    flex: 1,
  },
  consentText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  consentLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 2,
  },
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 7: Verify in the emulator**

1. Open Register. Expected: "Create Account" is visibly disabled.
2. Tap the policy text. Expected: the policy screen opens; back returns to the form with entries intact.
3. Check the box. Expected: the button enables.
4. Register a new test account. Expected: you land on the dashboard **without** seeing the consent gate.
5. Confirm in Supabase:

```sql
SELECT email, consent_version, consented_at
FROM profiles ORDER BY created_at DESC LIMIT 1;
```

Expected: `consent_version = '1.0'` and a non-null timestamp.

- [ ] **Step 8: Commit**

```bash
git add app/(auth)/register.tsx
git commit -m "feat: require privacy policy acceptance at registration"
```

---

### Task 7: Logo on the login and register screens

**Files:**
- Modify: `app/(auth)/login.tsx:57-60` and its styles
- Modify: `app/(auth)/register.tsx:119-122` and its styles

**Interfaces:**
- Consumes: `assets/icon.png`
- Produces: nothing

- [ ] **Step 1: Add the image to the login header**

In `app/(auth)/login.tsx`, add `Image` to the `react-native` import, then replace the header block:

```tsx
        <View style={styles.header}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logoMark}
            resizeMode="contain"
          />
          <Text style={styles.logo}>EngineerTrack</Text>
          <Text style={styles.subtitle}>{t('auth.login')}</Text>
        </View>
```

Add to the login styles:

```tsx
  logoMark: {
    width: 88,
    height: 88,
    marginBottom: 12,
  },
```

- [ ] **Step 2: Add the image to the register header**

In `app/(auth)/register.tsx`, add `Image` to the `react-native` import, then replace the header block:

```tsx
        <View style={styles.header}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logoMark}
            resizeMode="contain"
          />
          <Text style={styles.logo}>EngineerTrack</Text>
          <Text style={styles.subtitle}>{t('auth.register')}</Text>
        </View>
```

Add to the register styles:

```tsx
  logoMark: {
    width: 64,
    height: 64,
    marginBottom: 8,
  },
```

The register mark is smaller because that screen already scrolls; a full-size mark would push the form below the fold on small devices.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 4: Verify in the emulator**

Open Login and Register. Expected: the branded mark renders above the wordmark on both, and the register form still fits without the button being pushed off-screen.

- [ ] **Step 5: Commit**

```bash
git add app/(auth)/login.tsx app/(auth)/register.tsx
git commit -m "feat: show the branded mark on the login and register screens"
```

---

# Slice 2 — Linking and join hardening

### Task 8: Pure helpers for code parsing, domain lists, and RPC errors

**Files:**
- Create: `src/utils/codes.ts`
- Create: `src/utils/emailDomain.ts`
- Create: `src/utils/rpcErrors.ts`
- Create: `src/utils/__tests__/codes.test.ts`
- Create: `src/utils/__tests__/emailDomain.test.ts`
- Create: `src/utils/__tests__/rpcErrors.test.ts`

**Interfaces:**
- Consumes: Jest setup from Task 1
- Produces:
  - `normalizeCode(input: string): string`
  - `parseStudentCode(input: string): ParsedStudentCode`
  - `buildCompositeStudentCode(institutionCode?: string | null, departmentCode?: string | null, studentCode?: string | null): string | null`
  - `normalizeDomainList(input: string): string[]`
  - `mapRpcError(message?: string): RpcErrorInfo`

- [ ] **Step 1: Write the failing code-parsing tests**

```ts
// src/utils/__tests__/codes.test.ts
import {
  normalizeCode,
  parseStudentCode,
  buildCompositeStudentCode,
} from '@/utils/codes';

describe('normalizeCode', () => {
  it('uppercases and trims', () => {
    expect(normalizeCode(' h94fqv ')).toBe('H94FQV');
  });

  it('strips internal whitespace left by paste', () => {
    expect(normalizeCode('7BW8HH29 _ CH96JV _ H94FQV')).toBe('7BW8HH29_CH96JV_H94FQV');
  });
});

describe('parseStudentCode', () => {
  it('treats a bare 6-character code as a short code', () => {
    expect(parseStudentCode('H94FQV')).toEqual({
      kind: 'short',
      studentCode: 'H94FQV',
    });
  });

  it('parses a full composite code', () => {
    expect(parseStudentCode('7BW8HH29_CH96JV_H94FQV')).toEqual({
      kind: 'composite',
      institutionCode: '7BW8HH29',
      departmentCode: 'CH96JV',
      studentCode: 'H94FQV',
    });
  });

  it('normalises before parsing', () => {
    expect(parseStudentCode(' 7bw8hh29_ch96jv_h94fqv ')).toEqual({
      kind: 'composite',
      institutionCode: '7BW8HH29',
      departmentCode: 'CH96JV',
      studentCode: 'H94FQV',
    });
  });

  it('rejects an empty input', () => {
    expect(parseStudentCode('   ')).toEqual({ kind: 'invalid', reason: 'EMPTY' });
  });

  it('rejects a two-segment code', () => {
    expect(parseStudentCode('7BW8HH29_H94FQV')).toEqual({
      kind: 'invalid',
      reason: 'SEGMENT_COUNT',
    });
  });

  it('rejects a four-segment code', () => {
    expect(parseStudentCode('A_B_C_D')).toEqual({
      kind: 'invalid',
      reason: 'SEGMENT_COUNT',
    });
  });

  it('rejects composite segments of the wrong length', () => {
    expect(parseStudentCode('7BW8HH2_CH96JV_H94FQV')).toEqual({
      kind: 'invalid',
      reason: 'SEGMENT_LENGTH',
    });
  });

  it('rejects a short code of the wrong length', () => {
    expect(parseStudentCode('H94FQ')).toEqual({
      kind: 'invalid',
      reason: 'SEGMENT_LENGTH',
    });
  });
});

describe('buildCompositeStudentCode', () => {
  it('joins all three parts', () => {
    expect(buildCompositeStudentCode('7BW8HH29', 'CH96JV', 'H94FQV')).toBe(
      '7BW8HH29_CH96JV_H94FQV',
    );
  });

  it('returns null when the student has not joined a department', () => {
    expect(buildCompositeStudentCode(null, null, 'H94FQV')).toBeNull();
    expect(buildCompositeStudentCode('7BW8HH29', null, 'H94FQV')).toBeNull();
    expect(buildCompositeStudentCode('7BW8HH29', 'CH96JV', null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/utils/__tests__/codes.test.ts`
Expected: FAIL — `Cannot find module '@/utils/codes'`

- [ ] **Step 3: Implement the code helpers**

```ts
// src/utils/codes.ts

export const INSTITUTION_CODE_LENGTH = 8;
export const DEPARTMENT_CODE_LENGTH = 6;
export const STUDENT_CODE_LENGTH = 6;

export type ParsedStudentCode =
  | { kind: 'short'; studentCode: string }
  | {
      kind: 'composite';
      institutionCode: string;
      departmentCode: string;
      studentCode: string;
    }
  | { kind: 'invalid'; reason: 'EMPTY' | 'SEGMENT_COUNT' | 'SEGMENT_LENGTH' };

/** Uppercase, trim, and drop every whitespace character a paste may carry. */
export function normalizeCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/**
 * Validates the SHAPE of a student code only — segment count and lengths.
 * Whether segment 1 really is this student's institution is decided
 * server-side in link_student_by_code. Never move that check here.
 */
export function parseStudentCode(input: string): ParsedStudentCode {
  const code = normalizeCode(input);
  if (!code) return { kind: 'invalid', reason: 'EMPTY' };

  if (!code.includes('_')) {
    if (code.length !== STUDENT_CODE_LENGTH) {
      return { kind: 'invalid', reason: 'SEGMENT_LENGTH' };
    }
    return { kind: 'short', studentCode: code };
  }

  const segments = code.split('_');
  if (segments.length !== 3) {
    return { kind: 'invalid', reason: 'SEGMENT_COUNT' };
  }

  const [institutionCode, departmentCode, studentCode] = segments;
  if (
    institutionCode.length !== INSTITUTION_CODE_LENGTH ||
    departmentCode.length !== DEPARTMENT_CODE_LENGTH ||
    studentCode.length !== STUDENT_CODE_LENGTH
  ) {
    return { kind: 'invalid', reason: 'SEGMENT_LENGTH' };
  }

  return { kind: 'composite', institutionCode, departmentCode, studentCode };
}

/** Null until the student has joined a department — there is no composite before that. */
export function buildCompositeStudentCode(
  institutionCode?: string | null,
  departmentCode?: string | null,
  studentCode?: string | null,
): string | null {
  if (!institutionCode || !departmentCode || !studentCode) return null;
  return `${institutionCode}_${departmentCode}_${studentCode}`.toUpperCase();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/utils/__tests__/codes.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Write the failing domain-list tests**

```ts
// src/utils/__tests__/emailDomain.test.ts
import { normalizeDomainList } from '@/utils/emailDomain';

describe('normalizeDomainList', () => {
  it('splits on commas and lowercases', () => {
    expect(normalizeDomainList('BTU.EDU.TR, ogr.BTU.edu.tr')).toEqual([
      'btu.edu.tr',
      'ogr.btu.edu.tr',
    ]);
  });

  it('strips a leading @', () => {
    expect(normalizeDomainList('@btu.edu.tr')).toEqual(['btu.edu.tr']);
  });

  it('drops empty entries and surrounding whitespace', () => {
    expect(normalizeDomainList(' btu.edu.tr , , ')).toEqual(['btu.edu.tr']);
  });

  it('removes duplicates, keeping first appearance', () => {
    expect(normalizeDomainList('btu.edu.tr, BTU.EDU.TR')).toEqual(['btu.edu.tr']);
  });

  it('also accepts newline and semicolon separators', () => {
    expect(normalizeDomainList('btu.edu.tr;uludag.edu.tr\nitu.edu.tr')).toEqual([
      'btu.edu.tr',
      'uludag.edu.tr',
      'itu.edu.tr',
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(normalizeDomainList('')).toEqual([]);
    expect(normalizeDomainList('   ')).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx jest src/utils/__tests__/emailDomain.test.ts`
Expected: FAIL — `Cannot find module '@/utils/emailDomain'`

- [ ] **Step 7: Implement the domain helper**

```ts
// src/utils/emailDomain.ts

/**
 * Normalises the admin's free-text domain field into the array stored in
 * institutions.allowed_email_domains. The authoritative match happens in
 * join_department_by_code; this only cleans up what the admin typed.
 */
export function normalizeDomainList(input: string): string[] {
  const parts = input.split(/[,;\n]/);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const domain = part.trim().toLowerCase().replace(/^@+/, '');
    if (!domain) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    result.push(domain);
  }

  return result;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx jest src/utils/__tests__/emailDomain.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 9: Write the failing RPC-error tests**

```ts
// src/utils/__tests__/rpcErrors.test.ts
import { mapRpcError } from '@/utils/rpcErrors';

describe('mapRpcError', () => {
  it('maps a known bare code', () => {
    expect(mapRpcError('INVALID_CODE')).toEqual({
      code: 'INVALID_CODE',
      key: 'errors.invalidCode',
    });
  });

  it('maps a code carrying a detail payload', () => {
    expect(mapRpcError('EMAIL_DOMAIN_BLOCKED:btu.edu.tr,ogr.btu.edu.tr')).toEqual({
      code: 'EMAIL_DOMAIN_BLOCKED',
      key: 'errors.emailDomainBlocked',
      params: { domains: 'btu.edu.tr, ogr.btu.edu.tr' },
    });
  });

  it('ignores the Postgres error prefix Supabase prepends', () => {
    expect(mapRpcError('  CODE_SEGMENT_MISMATCH  ')).toEqual({
      code: 'CODE_SEGMENT_MISMATCH',
      key: 'errors.codeSegmentMismatch',
    });
  });

  it('falls back to a generic key for an unrecognised message', () => {
    expect(mapRpcError('some database explosion')).toEqual({
      code: 'UNKNOWN',
      key: 'errors.unknown',
    });
  });

  it('falls back for an undefined message', () => {
    expect(mapRpcError(undefined)).toEqual({ code: 'UNKNOWN', key: 'errors.unknown' });
  });
});
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `npx jest src/utils/__tests__/rpcErrors.test.ts`
Expected: FAIL — `Cannot find module '@/utils/rpcErrors'`

- [ ] **Step 11: Implement the error mapper**

```ts
// src/utils/rpcErrors.ts

export interface RpcErrorInfo {
  code: string;
  key: string;
  params?: Record<string, string>;
}

const ERROR_KEYS: Record<string, string> = {
  NOT_AUTHENTICATED: 'errors.notAuthenticated',
  ROLE_NOT_ALLOWED: 'errors.roleNotAllowed',
  INVALID_CODE: 'errors.invalidCode',
  EXPIRED_CODE: 'errors.expiredCode',
  INVALID_CODE_FORMAT: 'errors.invalidCodeFormat',
  CODE_SEGMENT_MISMATCH: 'errors.codeSegmentMismatch',
  INSTITUTION_MISMATCH: 'errors.institutionMismatch',
  EMAIL_DOMAIN_BLOCKED: 'errors.emailDomainBlocked',
};

/**
 * Our RPCs raise stable codes, optionally with a `:detail` payload.
 * Anything else is a genuine database failure and gets the generic key.
 */
export function mapRpcError(message?: string): RpcErrorInfo {
  const raw = (message || '').trim();
  const [code, detail] = raw.split(':', 2);
  const key = ERROR_KEYS[code];

  if (!key) return { code: 'UNKNOWN', key: 'errors.unknown' };

  if (code === 'EMAIL_DOMAIN_BLOCKED' && detail) {
    return {
      code,
      key,
      params: { domains: detail.split(',').map((d) => d.trim()).join(', ') },
    };
  }

  return { code, key };
}
```

- [ ] **Step 12: Run the whole suite**

Run: `npm test`
Expected: PASS — 4 suites, 28 tests (5 consent + 12 codes + 6 domain + 5 error mapping)

- [ ] **Step 13: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 14: Commit**

```bash
git add src/utils/codes.ts src/utils/emailDomain.ts src/utils/rpcErrors.ts src/utils/__tests__
git commit -m "test: add code parsing, domain list, and RPC error helpers"
```

---

### Task 9: Slice 2 database migration

**Files:**
- Create: `docs/join-hardening-migration.sql`

**Interfaces:**
- Consumes: existing `institutions`, `departments`, `student_codes`, `profiles`, `notifications` tables
- Produces: `institutions.allowed_email_domains TEXT[]`, table `join_issue_reports`, RPCs `get_my_student_code()`, `report_join_issue(TEXT, TEXT, TEXT)`, updated `link_student_by_code(TEXT, TEXT)` and `join_department_by_code(TEXT)`

- [ ] **Step 1: Write the migration**

```sql
-- docs/join-hardening-migration.sql
-- Slice 2 of partner feedback package A: composite student codes,
-- per-institution e-mail domain rules, and join issue reporting.

-- ============================================
-- 1. Per-institution allowed e-mail domains
-- ============================================
-- An empty array means NO restriction, so every existing institution
-- keeps working untouched.
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS allowed_email_domains TEXT[] NOT NULL DEFAULT '{}';

-- ============================================
-- 2. Join issue reports (append-only audit log)
-- ============================================
CREATE TABLE IF NOT EXISTS join_issue_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  attempted_code  TEXT NOT NULL,
  reason_code     TEXT NOT NULL,
  note            TEXT,
  institution_id  UUID REFERENCES institutions(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE join_issue_reports ENABLE ROW LEVEL SECURITY;

-- No INSERT policy: report_join_issue is the only write path. It is
-- SECURITY DEFINER and runs as the table owner, so it bypasses RLS. Handing
-- clients a direct INSERT would let them skip the RPC's rate limit and note
-- cap and flood the table straight through PostgREST.
DROP POLICY IF EXISTS "own reports insert" ON join_issue_reports;

DROP POLICY IF EXISTS "own reports select" ON join_issue_reports;
CREATE POLICY "own reports select" ON join_issue_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "institution admin select" ON join_issue_reports;
CREATE POLICY "institution admin select" ON join_issue_reports
  FOR SELECT TO authenticated
  USING (
    institution_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM institutions i
      WHERE i.id = join_issue_reports.institution_id
        AND i.admin_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policy: the table is append-only by design.

-- ============================================
-- 3. Student code with its composite parts
-- ============================================
CREATE OR REPLACE FUNCTION get_my_student_code()
RETURNS TABLE (
  code             TEXT,
  institution_code TEXT,
  department_code  TEXT,
  institution_name TEXT,
  department_name  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  RETURN QUERY
  SELECT
    sc.code,
    i.institution_code,
    d.department_code,
    i.name,
    d.name
  FROM student_codes sc
  LEFT JOIN profiles p     ON p.id = sc.student_id
  LEFT JOIN institutions i ON i.id = p.institution_id
  LEFT JOIN departments d  ON d.id = p.department_id
  WHERE sc.student_id = auth.uid()
    AND sc.is_active = true
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_student_code() TO authenticated;

-- ============================================
-- 4. Link a student, accepting short or composite codes
-- ============================================
CREATE OR REPLACE FUNCTION link_student_by_code(p_code TEXT, p_role TEXT)
RETURNS TABLE (student_id UUID, student_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_code            TEXT;
  segments            TEXT[];
  seg_institution     TEXT;
  seg_department      TEXT;
  seg_student         TEXT;
  student_uuid        UUID;
  code_active         BOOLEAN;
  caller_role         TEXT;
  caller_institution  UUID;
  student_institution UUID;
  actual_institution  TEXT;
  actual_department   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT role, institution_id INTO caller_role, caller_institution
  FROM profiles WHERE id = auth.uid();

  IF caller_role NOT IN ('mentor', 'advisor') THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  raw_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));

  IF raw_code = '' THEN
    RAISE EXCEPTION 'INVALID_CODE_FORMAT';
  END IF;

  IF position('_' IN raw_code) > 0 THEN
    segments := string_to_array(raw_code, '_');
    IF array_length(segments, 1) <> 3 THEN
      RAISE EXCEPTION 'INVALID_CODE_FORMAT';
    END IF;
    seg_institution := segments[1];
    seg_department  := segments[2];
    seg_student     := segments[3];
    IF length(seg_institution) <> 8
       OR length(seg_department) <> 6
       OR length(seg_student) <> 6 THEN
      RAISE EXCEPTION 'INVALID_CODE_FORMAT';
    END IF;
  ELSE
    IF length(raw_code) <> 6 THEN
      RAISE EXCEPTION 'INVALID_CODE_FORMAT';
    END IF;
    seg_student := raw_code;
  END IF;

  -- Resolve the student code, distinguishing "never existed" from "deactivated".
  SELECT sc.student_id, sc.is_active
  INTO student_uuid, code_active
  FROM student_codes sc
  WHERE sc.code = seg_student
  ORDER BY sc.is_active DESC, sc.created_at DESC
  LIMIT 1;

  IF student_uuid IS NULL THEN
    RAISE EXCEPTION 'INVALID_CODE';
  END IF;

  IF code_active IS NOT TRUE THEN
    RAISE EXCEPTION 'EXPIRED_CODE';
  END IF;

  -- Composite codes must be internally consistent: segments 1 and 2 have to
  -- match the student's real institution and department. This checks the CODE,
  -- not the caller — mentors are usually from a different (company) institution.
  IF seg_institution IS NOT NULL THEN
    SELECT i.institution_code, d.department_code
    INTO actual_institution, actual_department
    FROM profiles p
    LEFT JOIN institutions i ON i.id = p.institution_id
    LEFT JOIN departments d  ON d.id = p.department_id
    WHERE p.id = student_uuid;

    IF actual_institution IS DISTINCT FROM seg_institution
       OR actual_department IS DISTINCT FROM seg_department THEN
      RAISE EXCEPTION 'CODE_SEGMENT_MISMATCH';
    END IF;
  END IF;

  -- Advisors must share the student's institution; mentors are exempt.
  IF caller_role = 'advisor' THEN
    SELECT institution_id INTO student_institution
    FROM profiles WHERE id = student_uuid;

    IF caller_institution IS NULL
       OR student_institution IS NULL
       OR caller_institution <> student_institution THEN
      RAISE EXCEPTION 'INSTITUTION_MISMATCH';
    END IF;
  END IF;

  IF caller_role = 'mentor' THEN
    UPDATE student_profiles SET mentor_id = auth.uid() WHERE id = student_uuid;
  ELSE
    UPDATE student_profiles SET advisor_id = auth.uid() WHERE id = student_uuid;
  END IF;

  RETURN QUERY
    SELECT p.id, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    FROM profiles p WHERE p.id = student_uuid;
END;
$$;

-- ============================================
-- 5. Join a department, enforcing the institution's domain rule
-- ============================================
CREATE OR REPLACE FUNCTION join_department_by_code(p_code TEXT)
RETURNS TABLE (
  id              UUID,
  institution_id  UUID,
  name            TEXT,
  department_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dept_id         UUID;
  inst_id         UUID;
  allowed         TEXT[];
  caller_email    TEXT;
  caller_domain   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT d.id, d.institution_id
  INTO dept_id, inst_id
  FROM departments d
  WHERE d.department_code = upper(trim(p_code))
  LIMIT 1;

  IF dept_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CODE';
  END IF;

  SELECT i.allowed_email_domains INTO allowed
  FROM institutions i WHERE i.id = inst_id;

  -- An empty array means no restriction.
  IF allowed IS NOT NULL AND array_length(allowed, 1) > 0 THEN
    SELECT lower(p.email) INTO caller_email FROM profiles p WHERE p.id = auth.uid();

    -- Guard the shape before trusting split_part: with more than one '@',
    -- split_part returns a middle segment, so `a@allowed.tr@evil.com` would
    -- pass a check on a domain that is not the real mailbox domain.
    IF caller_email IS NULL OR caller_email !~ '^[^@]+@[^@]+$' THEN
      RAISE EXCEPTION 'EMAIL_DOMAIN_BLOCKED:%', array_to_string(allowed, ',');
    END IF;

    caller_domain := split_part(caller_email, '@', 2);

    -- Compare against a lower-cased projection of the stored array: an admin
    -- who saves 'BTU.EDU.TR' must not lock out '@btu.edu.tr' users. The
    -- exception payload still shows `allowed` as stored, so the message
    -- matches what the admin typed.
    IF caller_domain = '' OR NOT EXISTS (
      SELECT 1 FROM unnest(allowed) AS d WHERE lower(d) = caller_domain
    ) THEN
      RAISE EXCEPTION 'EMAIL_DOMAIN_BLOCKED:%', array_to_string(allowed, ',');
    END IF;
  END IF;

  UPDATE profiles
  SET institution_id = inst_id,
      department_id  = dept_id
  WHERE id = auth.uid();

  RETURN QUERY
    SELECT d.id, d.institution_id, d.name, d.department_code
    FROM departments d
    WHERE d.id = dept_id;
END;
$$;

-- ============================================
-- 6. Report a join or link failure
-- ============================================
-- Returns TRUE when the report reached an institution admin, FALSE when it
-- could only be stored (a wholly invalid code names no institution).
CREATE OR REPLACE FUNCTION report_join_issue(
  p_code   TEXT,
  p_reason TEXT,
  p_note   TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_code     TEXT;
  segments     TEXT[];
  inst_id      UUID;
  admin_uuid   UUID;
  reporter_name TEXT;
  recent_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_reason NOT IN ('INVALID_CODE', 'EMAIL_DOMAIN_BLOCKED', 'CODE_SEGMENT_MISMATCH') THEN
    RAISE EXCEPTION 'INVALID_REASON';
  END IF;

  -- Abuse protection. This RPC writes an append-only row AND pushes a
  -- notification to a named institution admin, so an unbounded caller can
  -- spam a real person. Three reports per five minutes sits far above honest
  -- use (a confused student retries a code two or three times) and far below
  -- anything useful as a flood. The RAISE aborts the transaction, so the
  -- rejected attempt leaves no row behind.
  SELECT count(*) INTO recent_count
  FROM join_issue_reports r
  WHERE r.reporter_id = auth.uid()
    AND r.created_at > now() - interval '5 minutes';

  IF recent_count >= 3 THEN
    RAISE EXCEPTION 'REPORT_RATE_LIMITED';
  END IF;

  IF char_length(trim(coalesce(p_note, ''))) > 500 THEN
    RAISE EXCEPTION 'NOTE_TOO_LONG';
  END IF;

  raw_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));

  -- Resolve the institution, most specific source first.
  IF position('_' IN raw_code) > 0 THEN
    segments := string_to_array(raw_code, '_');
    IF array_length(segments, 1) = 3 THEN
      SELECT i.id INTO inst_id FROM institutions i
      WHERE i.institution_code = segments[1];
    END IF;
  END IF;

  IF inst_id IS NULL THEN
    SELECT d.institution_id INTO inst_id FROM departments d
    WHERE d.department_code = raw_code;
  END IF;

  IF inst_id IS NULL THEN
    SELECT p.institution_id INTO inst_id FROM profiles p WHERE p.id = auth.uid();
  END IF;

  INSERT INTO join_issue_reports (reporter_id, attempted_code, reason_code, note, institution_id)
  VALUES (auth.uid(), raw_code, p_reason, nullif(trim(coalesce(p_note, '')), ''), inst_id);

  IF inst_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT i.admin_id INTO admin_uuid FROM institutions i WHERE i.id = inst_id;
  IF admin_uuid IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
  INTO reporter_name FROM profiles p WHERE p.id = auth.uid();

  INSERT INTO notifications (user_id, title, body, type, data)
  VALUES (
    admin_uuid,
    'Join problem reported',
    coalesce(nullif(reporter_name, ''), 'A user') || ' could not join with code ' || raw_code,
    'general',
    jsonb_build_object('reason', p_reason, 'code', raw_code, 'note', p_note)
  );

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION report_join_issue(TEXT, TEXT, TEXT) TO authenticated;
```

- [ ] **Step 2: Apply the migration**

Ask the user to run `docs/join-hardening-migration.sql` in the Supabase SQL editor. Do not proceed until they confirm.

- [ ] **Step 3: Verify the column and table exist**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'institutions' AND column_name = 'allowed_email_domains';

SELECT to_regclass('public.join_issue_reports');
```

Expected: one row `allowed_email_domains`, and `join_issue_reports`.

- [ ] **Step 4: Verify format rejection and the abuse guards**

The Supabase SQL editor runs as `postgres` with no JWT, so `auth.uid()` is NULL
and every one of these functions raises `NOT_AUTHENTICATED` before reaching the
logic under test. Two constraints discovered while running this, both the hard
way:

- The editor runs each **separate submission** on its own connection, so a
  session-level `set_config(..., false)` is gone by the next query. The identity
  and the call under test must travel in the SAME submission, inside one
  explicit transaction, with `set_config(..., true)`.
- The editor mis-parses a `DO` block quoted with a **named** tag (`$probe$`),
  failing with `42601 mismatched parentheses`. Plain multi-statement batches are
  fine. Do not reach for a `DO` block here — it is not needed.

Each probe below ends in a deliberate error, which aborts the transaction, so
none of them leaves a row behind. Run them one at a time.

**A. Note cap**

```sql
BEGIN;

SELECT set_config('request.jwt.claims',
                  json_build_object('sub', (SELECT id::text FROM profiles LIMIT 1))::text,
                  true);

SELECT report_join_issue('ABC123', 'INVALID_CODE', repeat('x', 501));

ROLLBACK;
```

Expected: `ERROR P0001: NOTE_TOO_LONG`.

**B. Composite code format rejection**

```sql
BEGIN;

SELECT set_config('request.jwt.claims',
                  json_build_object('sub', (SELECT id::text FROM profiles WHERE role = 'mentor' LIMIT 1))::text,
                  true);

SELECT link_student_by_code('7BW8HH29_H94FQV', 'mentor');

ROLLBACK;
```

Expected: `ERROR P0001: INVALID_CODE_FORMAT` — the two-segment form is rejected
before any lookup.

**C. Rate limit**

```sql
BEGIN;

SELECT set_config('request.jwt.claims',
                  json_build_object('sub', (SELECT id::text FROM profiles LIMIT 1))::text,
                  true);

SELECT report_join_issue('ABC123', 'INVALID_CODE', repeat('x', 500));
SELECT report_join_issue('ABC123', 'INVALID_CODE', NULL);
SELECT report_join_issue('ABC123', 'INVALID_CODE', NULL);
SELECT report_join_issue('ABC123', 'INVALID_CODE', NULL);

ROLLBACK;
```

Expected: `ERROR P0001: REPORT_RATE_LIMITED`.

That one message carries two assertions: the fourth call was refused, and
reaching the fourth at all proves the first three were accepted — including the
exactly-500-character note, which would otherwise have failed with
`NOTE_TOO_LONG` on the first call.

- [ ] **Step 5: Commit**

```bash
git add docs/join-hardening-migration.sql
git commit -m "feat: add composite code parsing, domain rules, and join issue reporting to the database"
```

---

### Task 10: Service layer and error message keys

**Files:**
- Modify: `src/services/studentCode.ts:14-43` (`getMyCode`), `:53-69` (`linkWithCode`)
- Modify: `src/services/departmentCode.ts:26-34` (`joinDepartment`)
- Create: `src/services/joinIssue.ts`
- Modify: `src/services/index.ts` (export the new service)
- Modify: `src/types/institution.ts` (extend `StudentCode`, `Institution`)
- Modify: `src/i18n/locales/*.json` (add the `errors` namespace to all seven)

**Interfaces:**
- Consumes: `mapRpcError` and `buildCompositeStudentCode` (Task 8), RPCs from Task 9
- Produces:
  - `RpcError` class with `.info: RpcErrorInfo`
  - `studentCodeService.getMyCodeDetails(): Promise<StudentCodeDetails | null>`
  - `joinIssueService.report(params): Promise<{ routedToAdmin: boolean }>`
  - i18n keys `errors.*`

- [ ] **Step 1: Add the error keys to English**

Add this top-level `errors` object to `src/i18n/locales/en.json`:

```json
"errors": {
  "unknown": "Something went wrong. Please try again.",
  "notAuthenticated": "Your session expired. Please sign in again.",
  "roleNotAllowed": "Your role cannot perform this action.",
  "invalidCode": "This code is not valid. Check it with the person who gave it to you.",
  "expiredCode": "This code is no longer active. Ask the student to share their current code.",
  "invalidCodeFormat": "That does not look like a valid code. Enter the full code or just the last 6 characters.",
  "codeSegmentMismatch": "This code does not match the student's institution and department.",
  "institutionMismatch": "This student belongs to a different institution.",
  "emailDomainBlocked": "This institution only allows these e-mail domains: {{domains}}",
  "reportRateLimited": "You have sent several reports just now. Please wait a few minutes before sending another.",
  "noteTooLong": "Your note is too long. Please keep it under 500 characters.",
  "reportProblem": "Report a problem",
  "reportTitle": "Report a join problem",
  "reportNoteLabel": "What happened?",
  "reportNotePlaceholder": "For example: my advisor gave me this code today.",
  "reportSend": "Send",
  "reportSentRouted": "Your report has been sent to your institution's administrator.",
  "reportSentStored": "Your report has been recorded. Please also contact whoever gave you the code.",
  "reportFailed": "We could not send your report. Check your connection and try again."
}
```

- [ ] **Step 2: Translate the `errors` block into the other six locales**

Copy the structure into `tr.json`, `el.json`, `it.json`, `ro.json`, `de.json`, `sr.json` with translated values. Keep `{{domains}}` intact.

- [ ] **Step 3: Verify key parity**

```bash
python -c "
import json,io
base=json.load(io.open('src/i18n/locales/en.json',encoding='utf-8'))['errors']
for loc in ['tr','el','it','ro','de','sr']:
    d=json.load(io.open('src/i18n/locales/%s.json'%loc,encoding='utf-8'))
    missing=set(base)-set(d.get('errors',{}))
    print(loc, 'MISSING:', sorted(missing) if missing else 'none')
"
```

Expected: `none` for all six.

- [ ] **Step 3b: Map the two abuse-protection codes**

Task 9's fix round added `REPORT_RATE_LIMITED` and `NOTE_TOO_LONG` to
`report_join_issue`. Without a mapping they fall through to `errors.unknown`,
which tells a rate-limited user nothing about waiting. Add both to `ERROR_KEYS`
in `src/utils/rpcErrors.ts`, after `EMAIL_DOMAIN_BLOCKED`:

```ts
  REPORT_RATE_LIMITED: 'errors.reportRateLimited',
  NOTE_TOO_LONG: 'errors.noteTooLong',
```

Add one case to `src/utils/__tests__/rpcErrors.test.ts` asserting
`mapRpcError('REPORT_RATE_LIMITED')` returns
`{ code: 'REPORT_RATE_LIMITED', key: 'errors.reportRateLimited' }`, then run
`npx jest src/utils/__tests__/rpcErrors.test.ts`.

- [ ] **Step 4: Extend the institution types**

In `src/types/institution.ts`, add to `Institution` after `institutionCode`:

```ts
  allowedEmailDomains: string[];
```

And append this new interface:

```ts
export interface StudentCodeDetails {
  code: string;
  compositeCode: string | null;
  institutionCode?: string;
  departmentCode?: string;
  institutionName?: string;
  departmentName?: string;
}
```

- [ ] **Step 5: Add the shared RPC error type**

Create `src/services/rpcError.ts`:

```ts
import { mapRpcError, type RpcErrorInfo } from '@/utils/rpcErrors';

/**
 * Wraps a Supabase RPC failure so screens can translate it instead of
 * showing a raw Postgres message.
 */
export class RpcError extends Error {
  info: RpcErrorInfo;

  constructor(message?: string) {
    super(message || 'UNKNOWN');
    this.name = 'RpcError';
    this.info = mapRpcError(message);
  }
}

export function throwRpcError(error: { message?: string } | null): never {
  throw new RpcError(error?.message);
}
```

- [ ] **Step 6: Add `getMyCodeDetails` and error mapping to the student code service**

In `src/services/studentCode.ts`, add the imports:

```ts
import { buildCompositeStudentCode } from '@/utils/codes';
import { RpcError } from './rpcError';
import type { StudentCode, StudentCodeDetails } from '@/types/institution';
```

Add this method to `studentCodeService`, after `getMyCode`:

```ts
  async getMyCodeDetails(): Promise<StudentCodeDetails | null> {
    const { data, error } = await supabase.rpc('get_my_student_code');
    if (error) throw new RpcError(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row) return null;

    const code = (row.code as string) || '';
    const institutionCode = (row.institution_code as string) || undefined;
    const departmentCode = (row.department_code as string) || undefined;

    return {
      code,
      compositeCode: buildCompositeStudentCode(institutionCode, departmentCode, code),
      institutionCode,
      departmentCode,
      institutionName: (row.institution_name as string) || undefined,
      departmentName: (row.department_name as string) || undefined,
    };
  },
```

Replace the body of `linkWithCode` so RPC failures become `RpcError`:

```ts
  async linkWithCode(
    code: string,
    userId: string,
    role: 'mentor' | 'advisor',
  ): Promise<{ studentId: string; studentName: string }> {
    const { data, error } = await supabase.rpc('link_student_by_code', {
      p_code: code,
      p_role: role,
    });
    if (error) throw new RpcError(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new RpcError('INVALID_CODE');
    return {
      studentId: (row.student_id as string) || '',
      studentName: (row.student_name as string) || '',
    };
  },
```

Note the removed `.toUpperCase().trim()` — normalisation now happens in the RPC, which is the authoritative path, and duplicating it client-side would let the two drift.

- [ ] **Step 7: Map errors in the department code service**

In `src/services/departmentCode.ts`, import `RpcError` from `./rpcError` and replace both `if (error) throw error;` lines with:

```ts
    if (error) throw new RpcError(error.message);
```

and the `if (!row) throw new Error('Invalid department code');` with:

```ts
    if (!row) throw new RpcError('INVALID_CODE');
```

- [ ] **Step 8: Create the join issue service**

```ts
// src/services/joinIssue.ts
import { supabase } from './supabase';
import { RpcError } from './rpcError';

export type JoinIssueReason =
  | 'INVALID_CODE'
  | 'EMAIL_DOMAIN_BLOCKED'
  | 'CODE_SEGMENT_MISMATCH';

export const joinIssueService = {
  /**
   * `routedToAdmin` is false when the attempted code names no institution —
   * a wholly invalid code cannot be routed to anyone. The caller shows a
   * different message in that case.
   */
  async report(params: {
    attemptedCode: string;
    reason: JoinIssueReason;
    note?: string;
  }): Promise<{ routedToAdmin: boolean }> {
    const { data, error } = await supabase.rpc('report_join_issue', {
      p_code: params.attemptedCode,
      p_reason: params.reason,
      p_note: params.note || null,
    });
    if (error) throw new RpcError(error.message);
    return { routedToAdmin: data === true };
  },
};
```

- [ ] **Step 9: Export the new service**

Add to `src/services/index.ts`:

```ts
export { joinIssueService } from './joinIssue';
export { RpcError } from './rpcError';
```

- [ ] **Step 10: Map `allowedEmailDomains` in the admin service**

In `src/services/admin.ts`, in the institution mapper, add immediately after the
`institutionCode:` line (line 14):

```ts
    allowedEmailDomains: (row.allowed_email_domains as string[]) || [],
```

- [ ] **Step 11: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 12: Commit**

```bash
git add src/services src/types/institution.ts src/i18n/locales
git commit -m "feat: add composite code details, join issue service, and translated RPC errors"
```

---

### Task 11: Composite student code on the student profile

**Files:**
- Modify: `app/(student)/profile.tsx:103` (load), `:46` (state), `:560-605` (the My Student Code card)
- Modify: `src/i18n/locales/*.json` (three student keys)

**Interfaces:**
- Consumes: `studentCodeService.getMyCodeDetails` (Task 10)
- Produces: nothing

- [ ] **Step 1: Add the i18n keys**

Add to the `student` object in `src/i18n/locales/en.json`, then translate into the other six:

```json
"myStudentCode": "My Student Code",
"studentCodeHint": "Share this code with your mentor and advisor so they can link to your account.",
"studentCodeNoDepartment": "Your code will include your institution details once you join a department.",
"studentCodeCopiedTitle": "Copied",
"studentCodeCopied": "Your student code has been copied to the clipboard."
```

The last two replace a hardcoded English `Alert.alert('Copied!', 'Student code
copied to clipboard.')` that the card already had. Translating it is the point —
but the message must keep saying what happened. Reusing `student.myStudentCode`
as the body would leave the user staring at an alert that says "My Student Code".

- [ ] **Step 2: Switch the profile to the detailed loader**

In `app/(student)/profile.tsx`, change the state declaration at line 46 from `StudentCode` to the detail type:

```tsx
  const [studentCode, setStudentCode] = useState<StudentCodeDetails | null>(null);
```

Update the import to bring in `StudentCodeDetails` from `@/types/institution`, and change the load call at line 103 from:

```tsx
      const code = await studentCodeService.getMyCode(user.id);
```

to:

```tsx
      const code = await studentCodeService.getMyCodeDetails();
```

- [ ] **Step 3: Render both states**

Replace the card body that currently renders `studentCode.code` with:

```tsx
          {studentCode ? (
            <>
              <TouchableOpacity
                style={styles.codeDisplay}
                activeOpacity={0.7}
                onPress={async () => {
                  await Clipboard.setStringAsync(
                    studentCode.compositeCode || studentCode.code,
                  );
                  Alert.alert(
                    t('student.studentCodeCopiedTitle'),
                    t('student.studentCodeCopied'),
                  );
                }}
              >
                <Text style={styles.codeDisplayText}>
                  {studentCode.compositeCode || studentCode.code}
                </Text>
              </TouchableOpacity>

              {studentCode.compositeCode ? (
                <Text style={styles.codeMeta}>
                  {studentCode.institutionName} · {studentCode.departmentName}
                </Text>
              ) : (
                <Text style={styles.codeMeta}>
                  {t('student.studentCodeNoDepartment')}
                </Text>
              )}
            </>
          ) : null}
```

Leave the existing "Generate Code" branch below untouched — regenerating still calls `studentCodeService.generateCode(user.id)`, after which the screen re-runs its loader.

- [ ] **Step 4: Add the meta style**

Add to the profile `StyleSheet`:

```tsx
  codeMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 6: Verify in the emulator**

1. Sign in as a student who has **not** joined a department. Expected: a 6-character code plus the "will include your institution details" note.
2. Join a department with a valid code, then reopen Profile. Expected: the composite `XXXXXXXX_XXXXXX_XXXXXX` and the institution · department line.
3. Tap the code. Expected: the composite is on the clipboard (paste it into the note field of any form to confirm).

- [ ] **Step 7: Commit**

```bash
git add app/(student)/profile.tsx src/i18n/locales
git commit -m "feat: show the composite student code on the student profile"
```

---

### Task 12: Reusable reporting dialog and code error alert

**Files:**
- Create: `src/components/common/JoinIssueDialog.tsx`
- Create: `src/utils/codeErrorAlert.ts`

**Interfaces:**
- Consumes: `joinIssueService.report` and `RpcError` (Task 10), `errors.*` keys (Task 10)
- Produces:
  - `<JoinIssueDialog visible attemptedCode reason onClose />`
  - `showCodeErrorAlert({ t, error, attemptedCode, onReport }): void`

Both pieces exist so the four call sites in Task 13 are one line each. The alert helper also
keeps the error-code-to-reason mapping in one place: adding a new RPC error later touches one
file, not four screens.

- [ ] **Step 1: Create the component**

```tsx
// src/components/common/JoinIssueDialog.tsx
import { useState } from 'react';
import { Modal, View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { joinIssueService, type JoinIssueReason } from '@/services/joinIssue';
import { colors } from '@/theme';

interface Props {
  visible: boolean;
  attemptedCode: string;
  reason: JoinIssueReason;
  onClose: () => void;
}

export function JoinIssueDialog({ visible, attemptedCode, reason, onClose }: Props) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [isSending, setIsSending] = useState(false);

  async function handleSend() {
    setIsSending(true);
    try {
      const { routedToAdmin } = await joinIssueService.report({
        attemptedCode,
        reason,
        note,
      });
      setNote('');
      onClose();
      Alert.alert(
        t('errors.reportTitle'),
        routedToAdmin
          ? t('errors.reportSentRouted')
          : t('errors.reportSentStored'),
      );
    } catch {
      Alert.alert(t('common.error'), t('errors.reportFailed'));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('errors.reportTitle')}</Text>
          <Text style={styles.meta}>{attemptedCode}</Text>

          <Text style={styles.label}>{t('errors.reportNoteLabel')}</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder={t('errors.reportNotePlaceholder')}
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={500}
          />

          <View style={styles.actions}>
            <Button title={t('common.cancel')} onPress={onClose} variant="ghost" />
            <Button
              title={t('errors.reportSend')}
              onPress={handleSend}
              loading={isSending}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    color: colors.text,
    backgroundColor: colors.background,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
});
```

- [ ] **Step 2: Create the shared code error alert**

```ts
// src/utils/codeErrorAlert.ts
import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import { RpcError } from '@/services/rpcError';
import type { JoinIssueReason } from '@/services/joinIssue';

/**
 * Which RPC errors a user can report, and under which reason code.
 * INSTITUTION_MISMATCH is deliberately absent: an advisor linking a student
 * from another institution is the rule working correctly, not a fault to report.
 */
const REPORTABLE: Record<string, JoinIssueReason> = {
  INVALID_CODE: 'INVALID_CODE',
  EXPIRED_CODE: 'INVALID_CODE',
  INVALID_CODE_FORMAT: 'INVALID_CODE',
  CODE_SEGMENT_MISMATCH: 'CODE_SEGMENT_MISMATCH',
  EMAIL_DOMAIN_BLOCKED: 'EMAIL_DOMAIN_BLOCKED',
};

/**
 * Single place where a failed code operation becomes a translated alert,
 * with a "Report a problem" action when the failure is reportable.
 *
 * Lives in utils rather than components because it is not a component, and it
 * is not covered by Jest — jest.config.js only matches src/**\/__tests__, so
 * importing react-native here never reaches the test runner.
 */
export function showCodeErrorAlert(params: {
  t: TFunction;
  error: unknown;
  attemptedCode: string;
  onReport: (report: { code: string; reason: JoinIssueReason }) => void;
}): void {
  const { t, error, attemptedCode, onReport } = params;

  if (!(error instanceof RpcError)) {
    Alert.alert(t('common.error'), t('errors.unknown'));
    return;
  }

  const message = t(error.info.key, error.info.params);
  const reason = REPORTABLE[error.info.code];

  if (!reason) {
    Alert.alert(t('common.error'), message);
    return;
  }

  Alert.alert(t('common.error'), message, [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('errors.reportProblem'),
      onPress: () => onReport({ code: attemptedCode.trim(), reason }),
    },
  ]);
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add src/components/common/JoinIssueDialog.tsx src/utils/codeErrorAlert.ts
git commit -m "feat: add join issue dialog and shared code error alert"
```

---

### Task 13: Wire errors, shape validation, and reporting into the four code entry points

**Files:**
- Modify: `app/(student)/profile.tsx` (Join Department card, ~line 513)
- Modify: `app/(advisor)/profile.tsx` (Join Department card, ~line 365; Link Student card, ~line 412)
- Modify: `app/(mentor)/student-list.tsx` (link handler, ~line 127, and its render)
- Modify: `src/i18n/locales/*.json` (two student keys)

**Interfaces:**
- Consumes: `showCodeErrorAlert` and `JoinIssueDialog` (Task 12), `parseStudentCode` (Task 8)
- Produces: nothing

Every call site is now one line of error handling. The 20-line alert block lives in
`showCodeErrorAlert`; do not inline it here.

**State names in the existing screens** (verified — use these exact names):
`app/(student)/profile.tsx:43` → `deptCodeInput` · `app/(advisor)/profile.tsx:33` →
`studentCodeInput`, `:35` → `deptCodeInput` · `app/(mentor)/student-list.tsx` → `codeInput`.

- [ ] **Step 1: Add the two i18n keys**

Add to `student` in `src/i18n/locales/en.json`, then translate into `tr`, `el`, `it`, `ro`, `de`, `sr`:

```json
"codeInputHint": "Enter the full code or just the last 6 characters.",
"codeInputInvalid": "That is not a valid code shape. Use the full code (8_6_6 characters) or the 6-character student code."
```

- [ ] **Step 2: Add the shared imports and state to each of the three screens**

In `app/(student)/profile.tsx`, `app/(advisor)/profile.tsx`, and `app/(mentor)/student-list.tsx`:

```tsx
import { JoinIssueDialog } from '@/components/common/JoinIssueDialog';
import { showCodeErrorAlert } from '@/utils/codeErrorAlert';
import type { JoinIssueReason } from '@/services/joinIssue';
```

and this state (one copy per screen, even where the screen has two call sites — the dialog shows
whichever failure happened most recently):

```tsx
  const [issueReport, setIssueReport] = useState<{
    code: string;
    reason: JoinIssueReason;
  } | null>(null);
```

The two link screens additionally need:

```tsx
import { parseStudentCode } from '@/utils/codes';
```

- [ ] **Step 3: Replace the catch in all four handlers**

The same two lines go in every one of the four handlers — the student join handler, the advisor
join handler, the advisor link handler, and the mentor link handler. Substitute the screen's own
input state name for `<INPUT_STATE>` per the table above:

```tsx
              } catch (error) {
                showCodeErrorAlert({
                  t,
                  error,
                  attemptedCode: <INPUT_STATE>,
                  onReport: setIssueReport,
                });
              }
```

`onReport: setIssueReport` works directly because `showCodeErrorAlert` calls it with exactly
`{ code, reason }`.

- [ ] **Step 4: Mount the dialog on all three screens**

Immediately before the closing tag of each screen's root element:

```tsx
      <JoinIssueDialog
        visible={issueReport !== null}
        attemptedCode={issueReport?.code || ''}
        reason={issueReport?.reason || 'INVALID_CODE'}
        onClose={() => setIssueReport(null)}
      />
```

- [ ] **Step 5: Add client-side shape validation to the two link screens**

This is the UX half of the split the Global Constraints describe: shape here, identity in the RPC.
A wrong-shaped code is rejected instantly instead of costing a round trip.

In `app/(mentor)/student-list.tsx` and `app/(advisor)/profile.tsx`, derive the shape from the
current input during render:

```tsx
  const codeShape = parseStudentCode(<INPUT_STATE>);
  const isCodeShapeValid = codeShape.kind !== 'invalid';
```

Render this under the link `TextInput`, showing the error hint only once the user has typed
something:

```tsx
              <Text style={styles.codeHint}>
                {<INPUT_STATE>.trim() && !isCodeShapeValid
                  ? t('student.codeInputInvalid')
                  : t('student.codeInputHint')}
              </Text>
```

and gate the link button on the shape as well as on emptiness:

```tsx
                disabled={!<INPUT_STATE>.trim() || !isCodeShapeValid}
```

Match the existing button's disabled pattern in each file — the mentor screen uses a `disabled`
prop, the advisor screen dims via `style={[styles.linkBtn, !cond && { opacity: 0.5 }]}`; keep
whichever that file already does and extend its condition.

Add the hint style to both files:

```tsx
  codeHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
```

- [ ] **Step 6: Set input casing on both link inputs**

Add `autoCapitalize="characters"` and `autoCorrect={false}` to the code `TextInput` on both link
screens so a typed code looks right while entering. The RPC normalises regardless; this is
cosmetic.

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 8: Verify the helpers are actually used**

```bash
grep -rn "showCodeErrorAlert\|parseStudentCode" app/ | sort
```

Expected: `showCodeErrorAlert` imported and called in all three screens (four call sites);
`parseStudentCode` imported and called in the two link screens. No screen may contain an inline
`error instanceof RpcError` block.

- [ ] **Step 9: Commit**

```bash
git add app/(student)/profile.tsx app/(advisor)/profile.tsx app/(mentor)/student-list.tsx src/i18n/locales
git commit -m "feat: translate code errors, validate code shape, and offer issue reporting"
```

---

### Task 14: Allowed e-mail domains in the admin institution setup

**Files:**
- Modify: `app/(admin)/dashboard.tsx:79-101` (create handler), `:181-240` (setup form)
- Modify: `src/services/admin.ts:45-70` (`createInstitution`)
- Modify: `src/i18n/locales/*.json` (two keys)

**Interfaces:**
- Consumes: `normalizeDomainList` (Task 8), `institutions.allowed_email_domains` (Task 9)
- Produces: nothing

- [ ] **Step 1: Add the i18n keys**

Add to `common` in `src/i18n/locales/en.json` and translate into the other six:

```json
"allowedEmailDomains": "Allowed e-mail domains (optional)",
"allowedEmailDomainsHint": "Comma-separated, for example: btu.edu.tr, ogr.btu.edu.tr. Leave empty to allow any address. Subdomains are not matched automatically — add each one."
```

- [ ] **Step 2: Accept the domains in the service**

In `src/services/admin.ts`, add `allowedEmailDomains?: string[]` to the `data` parameter type of `createInstitution`, and add to the `.insert({ ... })` object:

```ts
        allowed_email_domains: data.allowedEmailDomains || [],
```

Add this method to `adminService` for later edits:

```ts
  async updateAllowedEmailDomains(institutionId: string, domains: string[]) {
    const { error } = await supabase
      .from('institutions')
      .update({ allowed_email_domains: domains })
      .eq('id', institutionId);
    if (error) throw error;
  },
```

- [ ] **Step 3: Add the field to the setup form**

In `app/(admin)/dashboard.tsx`, add the import:

```tsx
import { normalizeDomainList } from '@/utils/emailDomain';
```

Add state next to the other setup fields:

```tsx
  const [setupDomains, setSetupDomains] = useState('');
```

Add this block to the institution setup form, after the country field and before the submit button:

```tsx
            <Text style={styles.formLabel}>{t('common.allowedEmailDomains')}</Text>
            <TextInput
              style={styles.formInput}
              value={setupDomains}
              onChangeText={setSetupDomains}
              placeholder="btu.edu.tr, ogr.btu.edu.tr"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.formHint}>{t('common.allowedEmailDomainsHint')}</Text>
```

with:

```tsx
  formHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: 12,
  },
```

- [ ] **Step 4: Pass the normalised list on create**

In `handleCreateInstitution`, add to the `adminService.createInstitution(user.id, { ... })` argument:

```tsx
        allowedEmailDomains: normalizeDomainList(setupDomains),
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 6: Verify in the emulator**

1. Register a fresh admin and create an institution with `btu.edu.tr` in the domains field.
2. Confirm in Supabase:

```sql
SELECT name, allowed_email_domains FROM institutions ORDER BY created_at DESC LIMIT 1;
```

Expected: `{btu.edu.tr}`.

- [ ] **Step 7: Commit**

```bash
git add app/(admin)/dashboard.tsx src/services/admin.ts src/i18n/locales
git commit -m "feat: let admins set allowed e-mail domains for their institution"
```

---

### Task 15: Full verification pass

**Files:**
- Create: `docs/join-hardening-verification.sql`
- Modify: `PROGRESS.md` (session log row)

**Interfaces:**
- Consumes: everything above
- Produces: a repeatable database verification script

- [ ] **Step 1: Write the verification script**

```sql
-- docs/join-hardening-verification.sql
-- Run in the Supabase SQL editor after applying join-hardening-migration.sql.
-- Every block raises an exception if the behaviour is wrong, so a clean run
-- means every assertion held.

DO $$
DECLARE
  ok BOOLEAN;
BEGIN
  -- 1. The column exists and defaults to an empty array (= no restriction).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'institutions' AND column_name = 'allowed_email_domains'
  ) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: allowed_email_domains missing'; END IF;

  -- 2. The reports table exists.
  IF to_regclass('public.join_issue_reports') IS NULL THEN
    RAISE EXCEPTION 'FAIL: join_issue_reports missing';
  END IF;

  -- 3. The reports table is append-only: no UPDATE or DELETE policy.
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'join_issue_reports' AND cmd IN ('UPDATE', 'DELETE')
  ) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: join_issue_reports is mutable'; END IF;

  -- 4. All five functions are present.
  SELECT count(*) = 5 INTO ok FROM pg_proc
  WHERE proname IN (
    'get_my_student_code', 'link_student_by_code',
    'join_department_by_code', 'report_join_issue', 'record_consent'
  );
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: expected five functions'; END IF;

  RAISE NOTICE 'PASS: schema assertions held';
END $$;

-- 5. Format rejection: each of these must raise INVALID_CODE_FORMAT.
--    Run them one at a time and confirm the error text.
-- SELECT link_student_by_code('7BW8HH29_H94FQV', 'mentor');   -- two segments
-- SELECT link_student_by_code('A_B_C_D', 'mentor');           -- four segments
-- SELECT link_student_by_code('H94FQ', 'mentor');             -- short, wrong length
-- SELECT link_student_by_code('', 'mentor');                  -- empty

-- 6. Domain rule. Replace the UUID with a real institution, then:
--    a) with an empty array, a join must succeed
--    b) after setting a domain that does not match the test user, the same
--       join must raise EMAIL_DOMAIN_BLOCKED:<domains>
-- UPDATE institutions SET allowed_email_domains = '{}' WHERE id = '<uuid>';
-- UPDATE institutions SET allowed_email_domains = '{example.invalid}' WHERE id = '<uuid>';
```

- [ ] **Step 2: Run the schema assertions**

Paste the `DO $$ ... $$;` block into the Supabase SQL editor.
Expected: `NOTICE: PASS: schema assertions held`, no exception.

- [ ] **Step 3: Run the format rejection checks**

Run each commented `SELECT link_student_by_code(...)` from block 5 individually.
Expected: every one raises `INVALID_CODE_FORMAT`.

- [ ] **Step 4: Run the domain rule checks**

Follow block 6 against a real institution and a test student account.
Expected: empty array joins successfully; a non-matching domain raises `EMAIL_DOMAIN_BLOCKED:example.invalid`.

- [ ] **Step 5: Run the full automated suite**

```bash
npm test
npx tsc --noEmit
```

Expected: all Jest suites pass; `tsc` prints nothing.

- [ ] **Step 6: Run the emulator checklist**

Run `npx expo start --clear` and confirm each of these. Record the actual result of every line — do not report this task complete with any line unverified.

1. Existing user signs in → consent gate appears → Accept → dashboard.
2. Second sign-in → straight to dashboard, no gate.
3. New registration → button disabled until the box is checked → policy screen opens and returns → registration completes with **no** consent gate.
4. Login and Register screens both show the branded mark.
4b. Each of the four role profile screens (student, mentor, advisor, admin) shows a Privacy Policy
    row that opens the policy in the current interface language, and back returns to the profile.
5. Student without a department → short code plus the explanatory note.
6. Student joins a department → composite code plus institution · department.
7. Mentor links with the **full composite** code → success.
8. Mentor links with the **last 6 characters** only → success.
9. Mentor links with a wrong institution segment → translated `codeSegmentMismatch` message, with a "Report a problem" action.
10. Admin sets `example.invalid` as the allowed domain → a student join is blocked with the translated message naming the domain.
11. From that blocked join, send a report → the admin receives a notification.
12. Confirm the stored report:

```sql
SELECT reporter_id, attempted_code, reason_code, note, institution_id
FROM join_issue_reports ORDER BY created_at DESC LIMIT 5;
```

13. Switch the app language to Turkish and repeat steps 9 and 10 → both messages appear in Turkish, not as raw keys.

- [ ] **Step 7: Update the progress log**

Add a row to the Session Log table in `PROGRESS.md`:

```markdown
| 2026-08-02 | Session 13 | Partner feedback package A: GDPR/KVKK consent gate (versioned, seven locales), login/register branding, composite student codes, per-institution allowed e-mail domains, join issue reporting with admin routing, stable RPC error codes with translated messages, Jest test setup |
```

- [ ] **Step 8: Commit**

```bash
git add docs/join-hardening-verification.sql PROGRESS.md
git commit -m "test: add database verification script and log package A in PROGRESS"
```

---

## Notes for the implementer

**The privacy policy is a draft.** Every locale carries `legal.privacy._status`. Do not remove that marker; it is the signal that a lawyer has not yet reviewed the text. Flag it to the user when Slice 1 completes.

**Do not duplicate identity checks client-side.** `parseStudentCode` deliberately validates shape only. If you find yourself wanting to compare an institution segment in TypeScript, that logic belongs in `link_student_by_code`.

**Report routing has a known limit.** A wholly invalid code names no institution, so `report_join_issue` returns FALSE and the report reaches no admin. This is intended — see the spec's rationale. Do not "fix" it by broadcasting to all admins.
