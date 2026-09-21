# Security review — 2026-09-20

Prompted by a twenty-item pre-launch checklist. Three sources of evidence: a
scan of the repository and its git history, an **untrusted-user probe** against
the live project (`sim/security-probe.cjs` → `sim/SECURITY-PROBE.md`: the anon
key with no session, then a freshly registered student in no group, each
reading every table, calling 30 RPCs with other people's ids and touching
every bucket), and the owner-run inventory `docs/security-review-inventory.sql`.
Remediation: `docs/security-hardening-2026-09-20.sql` (idempotent, self-verifying).

## The checklist against this app

| # | Item | Status | Evidence / what to do |
|---|---|---|---|
| 1 | Protect API keys | ✅ | The client holds only the Supabase **anon** key, which is public by design; every rule is enforced server-side (RLS, `SECURITY DEFINER` RPCs). No service-role key anywhere in the app or repo. |
| 2 | Hide `.env` files | ✅ | `.env`, `.env.local`, `.env*.local` are git-ignored; `.env.example` carries names only. |
| 3 | Never hard-code secrets | ✅ | `git grep` and a full-history scan for GitHub tokens, JWTs and Stripe-style keys: nothing. **Except:** a GitHub personal access token was pasted into a chat session earlier (not into any file) and has **still not been rotated** — do it. |
| 4 | Add authentication | ✅ | Supabase Auth (email + password); every route requires a session, a role and the consent version (`app/_layout.tsx`). |
| 5 | Validate permissions server-side | ✅ | Business rules live in `SECURITY DEFINER` RPCs that read `auth.uid()`; Part C of every verification file evaluates policies under `SET LOCAL ROLE authenticated`. |
| 6 | Do not trust front-end user ids | ✅ | RPCs never take the caller's id as a parameter (`link_student_by_code`, `submit_assignment`, `send_message` …); `p_student_id`-style parameters are checked against `auth.uid()` or a relationship helper. |
| 7 | Isolate user data | ✅ | The simulation audit (7×7 cross probes) and this probe: a signed-in outsider sees exactly one row of `profiles`/`profiles_public` (their own), 0 rows of everything else except the read-only competency framework; every RPC with a foreign id is refused (`ROLE_NOT_ALLOWED`, `ID_FORBIDDEN`, `NOT_IN_GROUP`, `REPORT_FORBIDDEN`, `SELF_ASSESSMENT_FORBIDDEN`, `CANNOT_MESSAGE`, `CONVERSATION_NOT_FOUND`). |
| 8 | Lock down the database | ⚠️ → ✅ | Inventory #1/#3/#5 list tables without RLS, direct write grants and the definer surface; **S1** below: internal helpers were still executable by the anon role. Fixed by the hardening file. |
| 9 | Secure Supabase and storage | ⚠️ → ✅ | Buckets are private except `avatars` (public URLs are how the app shows staff photos). **S2**: five buckets had no size limit; **S3**: the public avatars bucket was listable by anyone. Fixed by the hardening file. |
| 10 | Protect admin routes | n/a | The admin role was removed in Session 14; no admin route exists. |
| 11 | Disable production debug | ⚠️ | One `console.log` in `app/_layout.tsx:273` prints notification titles; ~50 `console.warn/error` lines. Recommendation: `babel-plugin-transform-remove-console` for release builds (kept out of this review's diff — a build change). |
| 12 | Hide verbose errors | ✅ | `mapRpcError` maps stable codes to locale keys; unknown errors show `errors.unknown`, never `err.message`. |
| 13 | Validate input server-side | ✅ | RPCs refuse with named codes; the simulation fixes added the missing ones (evidence, reflection length, inverted dates, trim). Remaining lengths are bounded (`char_length … > 2000` on notes, `left(…, 200)` on notifications, poll options 2–6). |
| 14 | Sanitize user content | ✅ | React Native `Text` never interprets HTML; the Markdown viewer is an in-house block renderer (no HTML, no scripts); stream links are accepted only as `http(s)` with a host, server-side. |
| 15 | Protect file uploads | ⚠️ → ✅ | Path policy keys on `auth.uid()` as the first folder (upload into another user's folder is refused — probe); size caps and photo MIME allowlists come with S2. |
| 16 | Prevent SQL/NoSQL injection | ✅ | Parameterised RPCs; `format()` is used only with `%I`/`%s` on identifiers in owner-run scripts; no client-built SQL. |
| 17 | Rate-limit sign-in and sign-up | ⚠️ (dashboard) | GoTrue's defaults apply (sign-ups per IP, OTP/e-mail sends). Enable **CAPTCHA** and **leaked-password protection** in the dashboard; see the checklist below. |
| 18 | Check git history for secrets | ✅ | Scanned all refs for `ghp_`, `github_pat_`, `sk_live`, `service_role`, JWT prefixes: none. |
| 19 | Security headers and CORS | n/a / dashboard | Native app, no web origin of its own; Supabase's API CORS and JWT expiry are dashboard settings. |
| 20 | Test as an untrusted user | ✅ | `sim/SECURITY-PROBE.md` — anon: 0 rows on 36 tables, 27/30 RPCs refused outright, the other three answered empty or `ID_FORBIDDEN` (S1); outsider: own rows only, all foreign-id RPCs refused, storage list/download/upload refused except the avatars listing (S3). |

## Findings

**S1 — every RPC and relationship helper callable by the anon role (medium).**
Function creation grants `EXECUTE` to `PUBLIC`, and Supabase's default
privileges add an explicit grant to `anon`; the project's `REVOKE … FROM
PUBLIC, authenticated` on internal helpers therefore still left `anon` able to
call them. Inventory #4 before the fix: **66 functions**, among them the
relationship oracles `can_message(group, a, b)`, `is_mentor_of(student)`,
`owns_group(group)`, `shares_group_with(user)` — these answer from their
parameters, not from the caller, so anyone with two uuids and no session could
ask whether A may message B or whether X mentors Y — plus `internship_closed`,
`build_internship_report` (guarded inside) and every business RPC (each of
which refused with `NOT_AUTHENTICATED`). No data was disclosed in the probe,
but the oracle surface is real. Fix: for every non-trigger function in
`public`, keep `authenticated`'s access as an explicit grant where it existed,
then revoke from `PUBLIC` and `anon`; change the default privileges so future
functions are not granted to either. After the fix, inventory #4 is empty and
the anon probe gets `permission denied` even from the RLS policies that call
those helpers (the policies still run for signed-in users, whose grants were
preserved — the outsider's reads and refusals are unchanged).
Note: the first probe run reported `can_message`/`conversation_other` as "not
found" — wrong parameter names in the probe, corrected.

**S2 — buckets without size limits (low).** Only `internship-day-files` had a
10 MB cap and a MIME list. `log-photos`, `log-documents`, `assignment-docs`,
`feed-attachments`, `avatars` accepted any size. Fix: 10 MB + image MIME list
on the two photo buckets, 20 MB on the three document buckets (any type — the
picker accepts whatever the phone offers, CAD or archives included).
Follow-up (client): surface the bucket's "payload too large" as a friendly
message in `EvidencePicker` / `FeedComposer` (today it falls to `errors.unknown`).

**S3 — the public avatars bucket was listable (low).** Anyone with the anon key
could enumerate avatar objects (the probe saw entries). Public URLs are by
design (staff photos are shown to students without signing); listing is not.
Fix: replace the anon/public `SELECT` policy on `avatars` with one that lets an
authenticated user list only their own folder. Public URLs keep working.

**Observations, no change:** `validate_group_code` answers a signed-in student
with the group's name for a valid 6-character code — intended (the join screen
previews the group); enumeration of 36⁶ codes is impractical and GoTrue/PostgREST
rate limits apply. `profiles_public` exposes first name, last initial and
avatar to any signed-in user — intended for the leaderboard and message
contacts. The retired tables (`daily_logs`, `mentor_feedbacks`, `polls*`) still
carry RLS and no client write grants (inventory #1/#3).

## Owner checklist (Supabase dashboard — not reachable from SQL)

- Authentication › Sign In / Providers › Email: **Confirm email** is off (it let
  the simulation register accounts). Decide for the pilot: on means real students
  must verify; off means anyone can register with any address.
- Authentication › Attack Protection: **Leaked password protection** is a
  paid-plan toggle, so the app does the same check itself
  (`src/services/pwnedPasswords.ts`: HIBP range API, k-anonymity — five hex
  characters of the SHA-1 leave the phone, fail-open on network trouble) on
  sign-up, password reset and the profile's change-password; `src/utils/authErrors.ts`
  maps `weak_password` and the other GoTrue codes to locale copy on
  register/login/forgot-password (the raw English `error.message` is no longer
  shown). Set **Minimum password length** to **8** (free) — the client's
  `PASSWORD_MIN_LENGTH` (`src/utils/passwordPolicy.ts`) is 8 and the two must
  match; no character-class requirement (NIST SP 800-63B: length plus a breach
  check). Still enable **CAPTCHA** (hCaptcha/Turnstile —
  needs client wiring first: `captchaToken` on sign-up/sign-in/reset, a WebView
  challenge; note the probe and sim sign-ups stop working once it is on);
  review rate limits (sign-ups, token refreshes, e-mails).
- Authentication › Sessions: JWT expiry (default 1 h) and refresh-token
  rotation on; consider a session time-box for the pilot.
- Authentication › URL configuration: only the app's deep-link scheme in the
  redirect allowlist.
- Settings › API: confirm the **service_role** key is used nowhere (no Edge
  Functions exist; the SQL editor runs as `postgres`).
- Storage: after the hardening file, buckets show limits; `avatars` stays public.
- Rotate the GitHub token from the earlier chat session.
- Crash reporting (2026-09-21): Sentry project `engineertrack26/react-native`,
  EU ingest; DSN in `.env` and in EAS production/preview as
  `EXPO_PUBLIC_SENTRY_DSN`; `app.json` plugin carries org/project. Source maps
  need `SENTRY_AUTH_TOKEN` (secret) in EAS before the first production build.
- Delete the throwaway accounts: `probe.1789816896565@sim.engineertrack.test`
  and the probe's `outsider.<stamp>@sim.engineertrack.test` (see
  `sim/SECURITY-PROBE.md`).

## How to apply

1. Run `docs/security-review-inventory.sql` block by block; keep the nine
   result sets next to this file (they are the "before").
2. Run `docs/security-hardening-2026-09-20.sql` once; expect the `PASS:` notice.
3. Re-run `node sim/security-probe.cjs`; `sim/SECURITY-PROBE.md` must show no
   `**` markers (the run creates one more outsider account — delete it).
4. Walk the dashboard checklist.

## Result (2026-09-20)

Inventory: #1 no table without RLS; #4 66 anon-executable functions (before);
#7 five buckets without limits; #8 `avatars_read` `SELECT` for `{public}`.
Hardening applied: `PASS`. Second probe run: anon — every table `permission
denied` or 0 rows, every RPC and helper `permission denied`, every bucket
refused; outsider — own rows only, all foreign-id RPCs refused, 0 entries in
every bucket, uploads refused by policy or MIME. The only `SUCCEEDED` line left
is `validate_group_code` for a signed-in student with a valid code (by design).
Two throwaway outsider accounts exist from the two runs
(`outsider.1789933767074@…`, `outsider.1789934754185@…`) — delete with the probe account.
