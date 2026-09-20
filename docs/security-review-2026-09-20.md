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

**S1 — internal helpers callable by the anon role (medium).** Supabase's
default privileges grant `EXECUTE` on every new function to `anon` and
`authenticated`. The project's `REVOKE … FROM PUBLIC, authenticated` on
internal helpers therefore left `anon` with an explicit grant: a caller with
no session could execute `internship_closed(student, group)` (a boolean
oracle: needs two uuids, answers whether that internship is closed),
`build_internship_report` (guarded inside → `ID_FORBIDDEN`) and
`group_assignment_counts` (returned empty). No data was disclosed in the probe,
but the surface should not exist: nothing in the app calls PostgREST without a
session. Fix: revoke `EXECUTE` from `anon` on every non-trigger function in
`public` and change the default privileges so future functions are not granted
to `anon` either. Verified by the hardening file's final block.

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
- Authentication › Attack Protection: enable **CAPTCHA** (hCaptcha/Turnstile —
  needs `expo` captcha wiring on the register/login screens) and **Leaked
  password protection**; review rate limits (sign-ups, token refreshes, e-mails).
- Authentication › Sessions: JWT expiry (default 1 h) and refresh-token
  rotation on; consider a session time-box for the pilot.
- Authentication › URL configuration: only the app's deep-link scheme in the
  redirect allowlist.
- Settings › API: confirm the **service_role** key is used nowhere (no Edge
  Functions exist; the SQL editor runs as `postgres`).
- Storage: after the hardening file, buckets show limits; `avatars` stays public.
- Rotate the GitHub token from the earlier chat session.
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
