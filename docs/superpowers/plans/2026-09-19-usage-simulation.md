# Usage Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fifteen agent-played people (one advisor, seven students, seven mentors) use the live app through its front door for one compressed internship week, leaving real accounts the owner can sign in with, a per-person log, and a bug list.

**Architecture:** A small Node toolkit (`sim/actor.cjs`) wraps `@supabase/supabase-js` with the exact RPC/table/bucket calls the app's services make, logging every call. Person data lives in `sim/people.cjs`. Each phase is a set of scripts under `sim/phases/`, one per person, written and run by a subagent acting in character; the coordinator runs phases in order and merges findings into `sim/bugs.md` and `sim/RUN.md`.

**Tech Stack:** Node ≥ 18 (`node` on PATH), `@supabase/supabase-js@2.95` (already in `node_modules`), `node:assert`, `node:fs`. No new dependencies. No app code changes.

**Spec:** `docs/superpowers/specs/2026-09-19-usage-simulation-design.md`

## Global Constraints

- Only accounts under `@sim.engineertrack.test`; only `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` from `.env`; never a service-role key; never raw SQL.
- Wrapper names and argument names mirror `src/services/*` one to one (spec §4); a wrapper that must differ is a finding, not a fix.
- The simulation changes nothing under `app/` or `src/`. Findings go to `sim/bugs.md`.
- Internship window: `start = today − 6`, `end = today` (local date, timezone `Europe/Istanbul`).
- Language of people and content: Turkish; account `language: 'tr'`; `consent_version: '1.0'` (`PRIVACY_POLICY_VERSION`).
- Phases run in order 0 → 8; inside a phase, one subagent per person may run in parallel. A phase agent never signs in as someone else (except the phase 8 auditor).
- Every phase agent writes `sim/log/<slug>.md` and appends to `sim/bugs.md` with the `bug()` helper; nothing is reported in chat only.
- Commit outputs by explicit path (`git add sim/... && git commit -- sim/...`), never `git add -A`.
- Secrets never land in `sim/`: the toolkit reads `.env`; `accounts.md` holds sim passwords only.

---

### Task 1: The actor toolkit

**Files:**
- Create: `sim/actor.cjs`
- Create: `sim/fixtures.cjs`
- Create: `sim/report.cjs`
- Create: `sim/selftest.cjs`
- Create: `sim/README.md`

**Interfaces:**
- Produces: `Actor` class, `loadEnv()`, `todayIso()`, `daysAgoIso(n)`, `note(slug, text)`, `bug({ who, did, expected, got, code, severity })`, `expectRefusal(actor, code, fn)`; fixtures `pngBytes()`, `pdfBytes(title)`; report helpers `appendLog(slug, line)`, `appendBug(entry)`, `readAccounts()`, `writeAccount(row)`.

- [ ] **Step 1: Write the failing self-test**

`sim/selftest.cjs`:
```js
// node sim/selftest.cjs — no network. Checks the pure parts of the toolkit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pngBytes, pdfBytes } = require('./fixtures.cjs');
const { loadEnv, todayIso, daysAgoIso, slugify, RpcError, parseCode } = require('./actor.cjs');
const { formatLogLine, formatBug } = require('./report.cjs');

const png = pngBytes();
assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
const pdf = pdfBytes('Elif Kaya');
assert.equal(pdf.slice(0, 5).toString(), '%PDF-', 'PDF header');
assert.ok(pdf.toString().includes('Elif Kaya'));

const env = loadEnv(path.join(__dirname, '..', '.env'));
assert.ok(env.EXPO_PUBLIC_SUPABASE_URL.startsWith('https://'));
assert.ok(env.EXPO_PUBLIC_SUPABASE_ANON_KEY.length > 20);

assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(daysAgoIso(0), todayIso());
assert.ok(daysAgoIso(6) < todayIso());

assert.equal(slugify('Doç. Dr. Selin Aydın'), 'selin-aydin');
assert.equal(parseCode(new RpcError('PENDING_REVIEWS: 2')).code, 'PENDING_REVIEWS');
assert.equal(parseCode(new RpcError('PENDING_REVIEWS: 2')).detail, '2');
assert.equal(parseCode(new Error('boom')).code, 'UNKNOWN');

const line = formatLogLine({ at: '2026-09-19T09:00:00.000Z', who: 'elif-kaya', name: 'submit_assignment', args: { p_note: 'x' }, ok: true, result: 'abc' });
assert.ok(line.includes('submit_assignment') && line.includes('→'));
const bugText = formatBug({ who: 'elif-kaya', did: 'submit', expected: 'ok', got: 'ERR', code: 'X', severity: 'wrong' });
assert.ok(bugText.startsWith('- **[wrong]**'));
fs.mkdirSync(path.join(__dirname, 'log'), { recursive: true });
console.log('selftest ok');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node sim/selftest.cjs`
Expected: `Error: Cannot find module './fixtures.cjs'`

- [ ] **Step 3: Write the fixtures**

`sim/fixtures.cjs`:
```js
// Tiny generated files for evidence uploads. Under 1 KB each.
const zlib = require('node:zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A 2×2 ink-blue PNG. */
function pngBytes() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.from([0, 0x12, 0x31, 0x5e, 0x12, 0x31, 0x5e]);
  const idat = zlib.deflateSync(Buffer.concat([row, row]));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
/** A one-page PDF whose only text is the title. */
function pdfBytes(title) {
  const text = `BT /F1 18 Tf 40 750 Td (${title.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
module.exports = { pngBytes, pdfBytes };
```

- [ ] **Step 4: Write the report helpers**

`sim/report.cjs`:
```js
const fs = require('node:fs');
const path = require('node:path');
const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'log');
const BUGS = path.join(ROOT, 'bugs.md');
const ACCOUNTS = path.join(ROOT, 'accounts.md');

function short(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? '' : s.length > 160 ? s.slice(0, 157) + '…' : s;
}
function formatLogLine({ at, who, name, args, ok, result, error }) {
  const head = `- \`${at.slice(11, 19)}\` **${name}** ${short(args)}`;
  return ok ? `${head} → ${short(result)}` : `${head} → **ERROR** ${short(error)}`;
}
function appendLog(slug, line) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${slug}\n\n`);
  fs.appendFileSync(file, line + '\n');
}
function formatBug({ who, did, expected, got, code, severity, reproduces }) {
  return `- **[${severity}]** ${who} — ${did}. Expected: ${expected}. Got: ${got}${code ? ` (\`${code}\`)` : ''}.${reproduces === false ? ' Did not reproduce on retry.' : ''}`;
}
function appendBug(entry) {
  if (!fs.existsSync(BUGS)) fs.writeFileSync(BUGS, '# Simulation findings\n\nSeverity: blocker = flow cannot continue · wrong = rule/data wrong · rough = works but reads badly.\n\n');
  fs.appendFileSync(BUGS, formatBug(entry) + '\n');
}
const ACCOUNT_HEADER = '# Simulation accounts\n\nAll under `@sim.engineertrack.test`. Group join code and student codes are filled as they are created.\n\n| Role | Name | Email | Password | Company | Character | Student code | Group code | Avatar |\n|---|---|---|---|---|---|---|---|---|\n';
function writeAccount(row) {
  if (!fs.existsSync(ACCOUNTS)) fs.writeFileSync(ACCOUNTS, ACCOUNT_HEADER);
  const cells = [row.role, row.name, row.email, row.password, row.company || '', row.character || '', row.studentCode || '', row.groupCode || '', row.avatar || ''];
  const text = fs.readFileSync(ACCOUNTS, 'utf8');
  const line = `| ${cells.join(' | ')} |`;
  const existing = text.split('\n').findIndex((l) => l.includes(`| ${row.email} |`));
  if (existing === -1) fs.appendFileSync(ACCOUNTS, line + '\n');
  else { const lines = text.split('\n'); lines[existing] = line; fs.writeFileSync(ACCOUNTS, lines.join('\n')); }
}
function readAccounts() {
  if (!fs.existsSync(ACCOUNTS)) return [];
  return fs.readFileSync(ACCOUNTS, 'utf8').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Role') && !l.startsWith('|---'))
    .map((l) => { const c = l.split('|').slice(1, -1).map((s) => s.trim());
      return { role: c[0], name: c[1], email: c[2], password: c[3], company: c[4], character: c[5], studentCode: c[6], groupCode: c[7], avatar: c[8] }; });
}
module.exports = { formatLogLine, appendLog, formatBug, appendBug, writeAccount, readAccounts, LOG_DIR, BUGS, ACCOUNTS };
```

- [ ] **Step 5: Write the actor**

`sim/actor.cjs`:
```js
// The one way the simulation talks to Supabase: the app's front door.
// Wrapper names and argument names mirror src/services/*.
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { appendLog, appendBug, formatLogLine } = require('./report.cjs');

const TZ = 'Europe/Istanbul';
const CONSENT_VERSION = '1.0';

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
function localDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function todayIso() { return localDate(new Date()); }
function daysAgoIso(n) { return localDate(new Date(Date.now() - n * 86400000)); }
function slugify(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'i')
    .toLowerCase().replace(/\b(doç|dr|prof)\.?\s*/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
class RpcError extends Error {}
function parseCode(err) {
  const raw = (err && err.message || '').trim();
  const sep = raw.indexOf(':');
  const code = sep === -1 ? raw : raw.slice(0, sep).trim();
  const detail = sep === -1 ? undefined : raw.slice(sep + 1).trim();
  return /^[A-Z_]{3,}$/.test(code) ? { code, detail } : { code: 'UNKNOWN', detail: raw };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Actor {
  constructor(person) {
    this.person = person; this.slug = person.slug; this.userId = null;
    const env = loadEnv();
    this.client = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  log(entry) { appendLog(this.slug, formatLogLine({ at: new Date().toISOString(), who: this.slug, ...entry })); }
  note(text) { appendLog(this.slug, `- _${new Date().toISOString().slice(11, 19)}_ ${text}`); }
  bug(entry) { appendBug({ who: this.slug, ...entry }); this.note(`BUG [${entry.severity}] ${entry.did} — got ${entry.got}`); }

  /** Mirrors authService.signUp; asserts a session (email confirmation must be off). */
  async signUp({ email, password, firstName, lastName, role, language = 'tr', avatarId }) {
    const data = { first_name: firstName, last_name: lastName, role, language, consent_version: CONSENT_VERSION };
    if (role === 'student' && avatarId) data.student_avatar_id = avatarId;
    let res = await this.client.auth.signUp({ email, password, options: { data } });
    if (res.error && /rate limit|too many/i.test(res.error.message)) { // spec §8: pause, do not fail
      this.note('sign-up rate-limited, waiting 60 s'); await sleep(60000);
      res = await this.client.auth.signUp({ email, password, options: { data } });
    }
    this.log({ name: 'auth.signUp', args: { email, role }, ok: !res.error, result: res.data?.user?.id, error: res.error?.message });
    if (res.error) throw new RpcError(res.error.message);
    if (!res.data.session) throw new RpcError('NO_SESSION: email confirmation is on');
    this.userId = res.data.user.id;
    return res.data;
  }
  async signIn(email, password) {
    const res = await this.client.auth.signInWithPassword({ email, password });
    this.log({ name: 'auth.signIn', args: { email }, ok: !res.error, result: res.data?.user?.id, error: res.error?.message });
    if (res.error) throw new RpcError(res.error.message);
    this.userId = res.data.user.id;
    return res.data;
  }
  async rpc(name, args = {}) {
    const res = await this.client.rpc(name, args);
    this.log({ name, args, ok: !res.error, result: res.data, error: res.error?.message });
    if (res.error) throw new RpcError(res.error.message);
    return res.data;
  }
  /** A logged PostgREST query. `build` receives the table builder and returns the awaited query. */
  async table(name, label, build) {
    const res = await build(this.client.from(name));
    this.log({ name: `table.${name}.${label}`, args: {}, ok: !res.error, result: res.data, error: res.error?.message });
    if (res.error) throw new RpcError(res.error.message);
    return res.data;
  }
  async upload(bucket, filePath, bytes, contentType) {
    const res = await this.client.storage.from(bucket).upload(filePath, bytes, { contentType, upsert: false });
    this.log({ name: `storage.${bucket}.upload`, args: { path: filePath, bytes: bytes.length }, ok: !res.error, result: res.data?.path, error: res.error?.message });
    if (res.error) throw new RpcError(res.error.message);
    return this.client.storage.from(bucket).getPublicUrl(filePath).data.publicUrl; // what logService returns
  }
  /** Passes only when fn fails with the stable code; logs either way, files a bug when it does not. */
  async expectRefusal(code, did, fn) {
    try { const r = await fn(); this.bug({ did, expected: `refusal ${code}`, got: `success ${JSON.stringify(r)}`, code, severity: 'wrong' }); return false; }
    catch (e) { const { code: got } = parseCode(e); if (got === code) { this.note(`expected refusal ${code} for: ${did}`); return true; }
      this.bug({ did, expected: `refusal ${code}`, got: e.message, code: got, severity: 'wrong' }); return false; }
  }
  /** Runs fn; a failure is filed as a bug and swallowed so the person's day goes on. */
  async attempt(did, fn, severity = 'wrong') {
    try { return await fn(); }
    catch (e) { const { code, detail } = parseCode(e); this.bug({ did, expected: 'success', got: detail ? `${code}: ${detail}` : e.message, code, severity }); return undefined; }
  }

  // ---- wrappers, in the services' vocabulary ----
  recordConsent() { return this.rpc('record_consent', { p_version: CONSENT_VERSION }); }
  setStudentAvatar(avatarId) { return this.rpc('set_student_avatar', { p_avatar_id: avatarId }); }
  upsertStudentProfile(updates) {
    return this.table('student_profiles', 'update', (q) => q.update(updates).eq('id', this.userId).select().maybeSingle())
      .then((row) => row || this.table('student_profiles', 'insert', (q) => q.insert({ id: this.userId, ...updates }).select().single()));
  }
  createGroup(name, term) { return this.table('internship_groups', 'insert', (q) => q.insert({ advisor_id: this.userId, name, term: term || null }).select().single()); }
  myGroups() { return this.table('internship_groups', 'select', (q) => q.select('*').eq('advisor_id', this.userId).order('created_at', { ascending: false })); }
  validateGroupCode(code) { return this.rpc('validate_group_code', { p_code: code.toUpperCase().trim() }); }
  joinGroupByCode(code) { return this.rpc('join_group_by_code', { p_code: code.toUpperCase().trim() }); }
  closeMembership(membershipId) { return this.rpc('close_membership', { p_membership_id: membershipId }); }
  getMyStudentCode() { return this.rpc('get_my_student_code'); }
  createStudentCode() { return this.table('student_codes', 'insert', (q) => q.insert({ student_id: this.userId }).select().single()); }
  linkStudentByCode(code, role = 'mentor') { return this.rpc('link_student_by_code', { p_code: code, p_role: role }); }
  listFramework() {
    return Promise.all([
      this.table('competencies', 'select', (q) => q.select('*').order('display_order')),
      this.table('competency_kpis', 'select', (q) => q.select('*').order('level').order('kpi_index')),
    ]).then(([competencies, kpis]) => ({ competencies, kpis }));
  }
  listTriplets(kpiId) { return this.table('kpi_triplets', 'select', (q) => q.select('id, kpi_id, triplet_index, objective, task, criterion').eq('kpi_id', kpiId).order('triplet_index')); }
  setGroupTargets(groupId, targets) {
    return this.table('group_competency_targets', 'delete', (q) => q.delete().eq('group_id', groupId))
      .then(() => targets.length ? this.table('group_competency_targets', 'insert', (q) => q.insert(targets.map((t) => ({ group_id: groupId, competency_id: t.competencyId, target_level: t.targetLevel })))) : []);
  }
  createAssignment(input) {
    return this.table('group_assignments', 'insert', (q) => q.insert({ group_id: input.groupId, triplet_id: input.tripletId, title: input.title,
      description: input.description ?? null, objective: input.objective, criterion: input.criterion, due_date: input.dueDate ?? null, created_by: this.userId }).select().single());
  }
  updateAssignment(id, patch) { return this.table('group_assignments', 'update', (q) => q.update(patch).eq('id', id).select().single()); }
  publishAssignments(ids) { return this.rpc('publish_assignments', { p_ids: ids }); }
  groupAssignmentCounts(groupId) { return this.rpc('group_assignment_counts', { p_group_id: groupId }); }
  listMyAssignments() { return this.table('group_assignments', 'select', (q) => q.select('*, kpi_triplets(competency_kpis(level, competencies(id, name))), assignment_submissions(*)').not('published_at', 'is', null).order('created_at')); }
  listPendingReviews() { return this.table('assignment_submissions', 'select', (q) => q.select('*, group_assignments(*)').eq('status', 'submitted').order('submitted_at')); }
  submitAssignment(assignmentId, note, reflection, photos, documents, selfLevel) {
    return this.rpc('submit_assignment', { p_assignment_id: assignmentId, p_note: note, p_reflection: reflection,
      p_photos: photos.map((p) => ({ uri: p.uri, caption: p.caption ?? null })),
      p_documents: documents.map((d) => ({ uri: d.uri, file_name: d.fileName, file_type: d.fileType, file_size: d.fileSize })),
      p_self_level: selfLevel ?? null });
  }
  reviewAssignment(submissionId, approved, note, level) { return this.rpc('review_assignment', { p_submission_id: submissionId, p_approved: approved, p_note: note, p_level: level ?? null }); }
  setSubmissionSharing(submissionId, share) { return this.rpc('set_submission_sharing', { p_submission_id: submissionId, p_share: share }); }
  uploadPhoto(scopeId) { return this.upload('log-photos', `${this.userId}/${scopeId}/${Date.now()}.png`, require('./fixtures.cjs').pngBytes(), 'image/png'); }
  uploadDocument(scopeId, fileName) { return this.upload('log-documents', `${this.userId}/${scopeId}/${Date.now()}_${fileName}`, require('./fixtures.cjs').pdfBytes(this.person.name), 'application/pdf'); }
  getCompetencyProgress(studentId) { return this.rpc('get_competency_progress', { p_student_id: studentId }); }
  getWorkingKpis(studentId) { return this.rpc('get_working_kpis', { p_student_id: studentId }); }
  competencySelfVsMentor(studentId) { return this.rpc('competency_self_vs_mentor', { p_student_id: studentId }); }
  getMyGroupLeaderboard(limit = 20) { return this.rpc('get_my_group_leaderboard', { p_limit: limit }); }
  syncMyGrowthAwards() { return this.rpc('sync_my_growth_awards'); }
  listFeedPosts(groupId, before = null, limit = 20) { return this.rpc('list_feed_posts', { p_group_id: groupId, p_before: before, p_limit: limit }); }
  listFeedPending(groupId) { return this.rpc('list_feed_pending', { p_group_id: groupId }); }
  createFeedPost(groupId, kind, body, options = null, attachments = [], draft = false) { return this.rpc('create_feed_post', { p_group_id: groupId, p_kind: kind, p_body: body, p_options: options, p_attachments: attachments, p_draft: draft }); }
  uploadFeedAttachment(groupId, fileName, bytes, mime) { return this.upload('feed-attachments', `${groupId}/${Date.now()}-sim/${fileName}`, bytes, mime).then(() => `${groupId}/${Date.now()}-sim/${fileName}`); }
  publishFeedPost(postId) { return this.rpc('publish_feed_post', { p_post_id: postId }); }
  voteFeedPoll(postId, optionId) { return this.rpc('vote_feed_poll', { p_post_id: postId, p_option_id: optionId }); }
  removeFeedPost(postId) { return this.rpc('remove_feed_post', { p_post_id: postId }); }
  likePost(postId) { return this.table('feed_likes', 'insert', (q) => q.insert({ post_id: postId, user_id: this.userId })); }
  unlikePost(postId) { return this.table('feed_likes', 'delete', (q) => q.delete().eq('post_id', postId).eq('user_id', this.userId)); }
  addComment(postId, body) { return this.table('feed_comments', 'insert', (q) => q.insert({ post_id: postId, author_id: this.userId, body })); }
  listComments(postId) { return this.table('feed_comments', 'select', (q) => q.select('id, post_id, author_id, body, created_at').eq('post_id', postId).order('created_at')); }
  deleteComment(commentId) { return this.table('feed_comments', 'delete', (q) => q.delete().eq('id', commentId)); }
  listConversations(groupId = null) { return this.rpc('list_conversations', { p_group_id: groupId }); }
  listMessages(conversationId, before = null, limit = 30) { return this.rpc('list_messages', { p_conversation_id: conversationId, p_before: before, p_limit: limit }); }
  listMessageContacts(groupId) { return this.rpc('list_message_contacts', { p_group_id: groupId }); }
  listMentorMessageContacts() { return this.rpc('list_mentor_message_contacts', {}); }
  openConversation(groupId, otherId) { return this.rpc('open_conversation', { p_group_id: groupId, p_other_id: otherId }); }
  openCase(groupId, studentId) { return this.rpc('open_case', { p_group_id: groupId, p_student_id: studentId }); }
  listCaseCandidates(groupId) { return this.rpc('list_case_candidates', { p_group_id: groupId }); }
  sendMessage(conversationId, body) { return this.rpc('send_message', { p_conversation_id: conversationId, p_body: body }); }
  markConversationRead(conversationId) { return this.rpc('mark_conversation_read', { p_conversation_id: conversationId }); }
  blockConversation(conversationId, block) { return this.rpc('block_conversation', { p_conversation_id: conversationId, p_block: block }); }
  unreadMessageCount() { return this.rpc('unread_message_count', {}); }
  internshipPeople() { return this.rpc('internship_people'); }
  internshipWeek(studentId, from) { return this.rpc('internship_week', { p_student_id: studentId, p_from: from }); }
  internshipTotals(studentId) { return this.rpc('internship_totals', { p_student_id: studentId }); }
  internshipOpenDay(studentId, date, reason = '') { return this.rpc('internship_open_day', { p_student_id: studentId, p_date: date, p_timezone: TZ, p_reason: reason.trim() }); }
  internshipSaveLog(day, form, submit) {
    return this.rpc('internship_save_log', { p_day: day.id, p_version: day.version, p_experience: form.experience.trim(), p_learning: form.learning.trim(),
      p_next_step: form.nextStep.trim(), p_support: form.support, p_submit: submit, p_reason: (form.reason || '').trim(), p_task: form.taskId ?? null, p_attachment: form.attachment ?? null });
  }
  internshipReview(days, status, note = '') { return this.rpc('internship_review', { p_days: days.map((d) => ({ id: d.id, version: d.version })), p_status: status, p_note: note.trim() }); }
  internshipNote(day, note, correction = false) { return this.rpc('internship_note', { p_day: day.id, p_version: day.version, p_note: note.trim(), p_correction: correction }); }
  internshipEvents(dayId) { return this.rpc('internship_events', { p_day: dayId }); }
  internshipGroupAttendance(groupId) { return this.rpc('internship_group_attendance', { p_group_id: groupId }); }
  internshipClosureStatus(studentId, groupId) { return this.rpc('internship_closure_status', { p_student_id: studentId, p_group_id: groupId }); }
  closeInternship(studentId, groupId) { return this.rpc('close_internship', { p_student_id: studentId, p_group_id: groupId }); }
  reopenInternship(studentId, groupId, reason) { return this.rpc('reopen_internship', { p_student_id: studentId, p_group_id: groupId, p_reason: reason }); }
  getInternshipReport(studentId, groupId) { return this.rpc('get_internship_report', { p_student_id: studentId, p_group_id: groupId }); }
  listNotifications() { return this.table('notifications', 'select', (q) => q.select('*').eq('user_id', this.userId).order('created_at', { ascending: false }).limit(50)); }
  markNotificationRead(id) { return this.table('notifications', 'update', (q) => q.update({ is_read: true }).eq('id', id)); }
  createNotification(userId, title, body, type, data = {}) { return this.table('notifications', 'insert', (q) => q.insert({ user_id: userId, title, body, type, data })); }
  myProfile() { return this.table('profiles', 'select', (q) => q.select('*').eq('id', this.userId).single()); }
  groupMembers(groupId) { return this.table('group_memberships', 'select', (q) => q.select('*, profiles_public(*)').eq('group_id', groupId).is('left_at', null)); }
}
module.exports = { Actor, RpcError, parseCode, loadEnv, todayIso, daysAgoIso, slugify, sleep, TZ, CONSENT_VERSION };
```

- [ ] **Step 6: Run the self-test**

Run: `node sim/selftest.cjs`
Expected: `selftest ok`.

- [ ] **Step 7: Write the README**

`sim/README.md`:
```markdown
# Usage simulation

Agents play one advisor, seven students and seven mentors through the app's
front door (anon key + real sign-in + the same RPCs the client calls).
Spec: `docs/superpowers/specs/2026-09-19-usage-simulation-design.md`.

- `actor.cjs` — the toolkit; wrapper names mirror `src/services/*`.
- `people.cjs` — the fifteen people (Task 2).
- `phases/NN-<slug>.cjs` — one script per person per phase; `node sim/phases/01-selin-aydin.cjs`.
- `log/<slug>.md`, `bugs.md`, `accounts.md`, `RUN.md` — outputs.
- `node sim/selftest.cjs` — offline check of the pure parts.

Only `@sim.engineertrack.test` accounts are ever created. No app code changes.
```

- [ ] **Step 8: Commit**

```bash
git add sim/actor.cjs sim/fixtures.cjs sim/report.cjs sim/selftest.cjs sim/README.md
git commit -m "sim: actor toolkit, fixtures, report helpers" -- sim/actor.cjs sim/fixtures.cjs sim/report.cjs sim/selftest.cjs sim/README.md
```

---

### Task 2: The people

**Files:**
- Create: `sim/people.cjs`
- Modify: `sim/selftest.cjs` (append checks)

**Interfaces:**
- Produces: `ADVISOR`, `STUDENTS` (7), `MENTORS` (7), `byRole(role)`, `bySlug(slug)`, `mentorOf(studentSlug)`; each person `{ slug, name, firstName, lastName, email, password, role, language, company?, character, avatar?, mentorSlug?, studentSlug?, style? }`.

- [ ] **Step 1: Append the failing checks to the self-test**

Append to `sim/selftest.cjs` before `console.log('selftest ok')`:
```js
const people = require('./people.cjs');
assert.equal(people.STUDENTS.length, 7);
assert.equal(people.MENTORS.length, 7);
assert.ok(people.STUDENTS.every((s) => s.email.endsWith('@sim.engineertrack.test')));
assert.ok(people.STUDENTS.every((s) => people.mentorOf(s.slug).studentSlug === s.slug));
assert.equal(new Set([people.ADVISOR, ...people.STUDENTS, ...people.MENTORS].map((p) => p.email)).size, 15);
assert.equal(people.bySlug('elif-kaya').company, 'Marmara Su ve Kanalizasyon İdaresi');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node sim/selftest.cjs`
Expected: `Cannot find module './people.cjs'`

- [ ] **Step 3: Write the people**

`sim/people.cjs`:
```js
// Spec §2. Characters drive what each person does in phases 2–7.
const { slugify } = require('./actor.cjs');
const DOMAIN = 'sim.engineertrack.test';
function person(p) {
  const slug = slugify(p.name);
  return { slug, language: 'tr', email: `${slug.replace(/-/g, '.')}@${DOMAIN}`, password: `Sim-${p.firstName}-2026!`, ...p };
}
const ADVISOR = person({ name: 'Selin Aydın', firstName: 'Selin', lastName: 'Aydın', role: 'advisor', title: 'Doç. Dr.',
  character: 'Runs the group carefully: sets targets first, publishes six tasks, announces, polls, follows up, closes.' });
const STUDENTS = [
  { name: 'Elif Kaya', firstName: 'Elif', lastName: 'Kaya', gender: 'f', avatar: '02', company: 'Marmara Su ve Kanalizasyon İdaresi', department: 'Arıtma Tesisi İşletme',
    character: 'Meticulous: journal every day, evidence on every task, rates herself honestly.', mentorSlug: 'hakan-demir' },
  { name: 'Burak Şahin', firstName: 'Burak', lastName: 'Şahin', gender: 'm', avatar: '05', company: 'Ege Çevre Danışmanlık', department: 'ÇED ve İzin Birimi',
    character: 'Late: submits at the last moment, misses one day\'s journal, gets a revision and resubmits.', mentorSlug: 'ayca-yildiz' },
  { name: 'Zeynep Arslan', firstName: 'Zeynep', lastName: 'Arslan', gender: 'f', avatar: '03', company: 'Ankara Büyükşehir Belediyesi Çevre Koruma Dairesi', department: 'Hava Kalitesi Şubesi',
    character: 'Terse: short notes, forgets evidence once, turns stream sharing off on one task, tries to join the group twice.', mentorSlug: 'murat-koc' },
  { name: 'Mert Yılmaz', firstName: 'Mert', lastName: 'Yılmaz', gender: 'm', avatar: '07', company: 'İzmir Atık Yönetimi A.Ş.', department: 'Düzenli Depolama Sahası',
    character: 'Over-confident: rates himself 3 (independent) on everything; the mentor disagrees.', mentorSlug: 'gamze-ozturk' },
  { name: 'Ayşe Çelik', firstName: 'Ayşe', lastName: 'Çelik', gender: 'f', avatar: '01', company: 'Karadeniz ÇED ve Çevre Hizmetleri', department: 'Saha Ölçüm Ekibi',
    character: 'Quiet: does the work, never messages, never comments; her mentor leaves one submission pending.', mentorSlug: 'emre-aksoy' },
  { name: 'Can Doğan', firstName: 'Can', lastName: 'Doğan', gender: 'm', avatar: '08', company: 'DSİ 5. Bölge Su Kalitesi Laboratuvarı', department: 'Numune Analiz',
    character: 'Questioning: messages the advisor and the mentor, comments on every post, asks for a case thread.', mentorSlug: 'selin-kurt' },
  { name: 'Deniz Yıldırım', firstName: 'Deniz', lastName: 'Yıldırım', gender: 'f', avatar: '04', company: 'Boğaziçi Geri Dönüşüm Tesisleri', department: 'Ayrıştırma Hattı',
    character: 'Absent one day (excused), opens a past day with a reason, likes but rarely posts.', mentorSlug: 'oguz-ari' },
].map((s) => person({ ...s, role: 'student' }));
const MENTORS = [
  { name: 'Hakan Demir', firstName: 'Hakan', lastName: 'Demir', studentSlug: 'elif-kaya', style: 'Reviews promptly, approves with a two-line note.' },
  { name: 'Ayça Yıldız', firstName: 'Ayça', lastName: 'Yıldız', studentSlug: 'burak-sahin', style: 'Strict: sends work back once with a precise reason.' },
  { name: 'Murat Koç', firstName: 'Murat', lastName: 'Koç', studentSlug: 'zeynep-arslan', style: 'Approves everything, never writes a note.' },
  { name: 'Gamze Öztürk', firstName: 'Gamze', lastName: 'Öztürk', studentSlug: 'mert-yilmaz', style: 'Rates lower than the student, writes why.' },
  { name: 'Emre Aksoy', firstName: 'Emre', lastName: 'Aksoy', studentSlug: 'ayse-celik', style: 'Slow: leaves one submission pending until the closure attempt.' },
  { name: 'Selin Kurt', firstName: 'Selin', lastName: 'Kurt', studentSlug: 'can-dogan', style: 'Replies to everything, marks one day partial with a note.' },
  { name: 'Oğuz Arı', firstName: 'Oğuz', lastName: 'Arı', studentSlug: 'deniz-yildirim', style: 'Records the absence as excused, asks for a correction on one journal.' },
].map((m) => person({ ...m, role: 'mentor', company: STUDENTS.find((s) => s.slug === m.studentSlug).company }));
const ALL = [ADVISOR, ...STUDENTS, ...MENTORS];
const byRole = (role) => ALL.filter((p) => p.role === role);
const bySlug = (slug) => ALL.find((p) => p.slug === slug);
const mentorOf = (studentSlug) => MENTORS.find((m) => m.studentSlug === studentSlug);
const GROUP = { name: 'ÇEV 400 Staj — Güz 2026', term: 'Güz 2026' };
module.exports = { ADVISOR, STUDENTS, MENTORS, ALL, GROUP, byRole, bySlug, mentorOf, DOMAIN };
```

- [ ] **Step 4: Run the self-test**

Run: `node sim/selftest.cjs`
Expected: `selftest ok`

- [ ] **Step 5: Commit**

```bash
git add sim/people.cjs sim/selftest.cjs
git commit -m "sim: the fifteen people" -- sim/people.cjs sim/selftest.cjs
```

---

### Task 3: Phase 0 — the probe

**Files:**
- Create: `sim/phases/00-probe.cjs`
- Create: `sim/RUN.md`

**Interfaces:**
- Consumes: `Actor.signUp`, `Actor.signIn`, `Actor.rpc`.
- Produces: a go/no-go line in `sim/RUN.md`.

- [ ] **Step 1: Write the probe**

`sim/phases/00-probe.cjs`:
```js
// Gate: does sign-up return a session? If not, email confirmation is on and the run must stop.
const fs = require('node:fs');
const path = require('node:path');
const { Actor, parseCode } = require('../actor.cjs');
(async () => {
  const stamp = Date.now();
  const probe = new Actor({ slug: 'probe', name: 'Probe' });
  const email = `probe.${stamp}@sim.engineertrack.test`;
  let verdict;
  try {
    await probe.signUp({ email, password: 'Sim-Probe-2026!', firstName: 'Probe', lastName: String(stamp), role: 'student', avatarId: '01' });
    const profile = await probe.myProfile();
    await probe.recordConsent();
    verdict = `GO — sign-up returned a session; profile row exists (role=${profile.role}, language=${profile.language}). Probe account ${email} left for the owner to delete.`;
  } catch (e) {
    const { code, detail } = parseCode(e);
    verdict = code === 'NO_SESSION'
      ? `STOP — sign-up returned no session: email confirmation is on. Turn it off (Authentication › Providers › Email › Confirm email) and rerun.`
      : `STOP — probe failed: ${code} ${detail || ''}`;
  }
  const run = path.join(__dirname, '..', 'RUN.md');
  if (!fs.existsSync(run)) fs.writeFileSync(run, '# Simulation run\n\n');
  fs.appendFileSync(run, `## Phase 0 — probe (${new Date().toISOString()})\n\n${verdict}\n\n`);
  console.log(verdict);
  process.exit(verdict.startsWith('GO') ? 0 : 1);
})();
```

- [ ] **Step 2: Run it**

Run: `node sim/phases/00-probe.cjs`
Expected: `GO — …` and exit 0. On `STOP`, hand the message to the owner and do not proceed to Task 4.

- [ ] **Step 3: Commit**

```bash
git add sim/phases/00-probe.cjs sim/RUN.md sim/log/probe.md
git commit -m "sim: phase 0 probe" -- sim/phases/00-probe.cjs sim/RUN.md sim/log/probe.md
```

---

### Task 4: Phase 1 — the advisor sets up the group

**Files:**
- Create: `sim/phases/01-selin-aydin.cjs`
- Create: `sim/state.json` (written by the script: group id, join code, assignment ids, post ids)

**Interfaces:**
- Consumes: Task 1 wrappers; `people.ADVISOR`, `people.GROUP`.
- Produces: `sim/state.json` `{ groupId, joinCode, assignments: [{ id, title, competencyName, level, published }], posts: { announcementId, pollId, pollOptionIds, draftAnnouncementId }, targets: [...] }`; `accounts.md` row for the advisor with the group code.

- [ ] **Step 1: Write the script**

`sim/phases/01-selin-aydin.cjs`:
```js
const fs = require('node:fs');
const path = require('node:path');
const { Actor, daysAgoIso } = require('../actor.cjs');
const { ADVISOR, GROUP } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const { pngBytes, pdfBytes } = require('../fixtures.cjs');
const STATE = path.join(__dirname, '..', 'state.json');

(async () => {
  const me = new Actor(ADVISOR);
  await me.signUp({ email: ADVISOR.email, password: ADVISOR.password, firstName: ADVISOR.firstName, lastName: ADVISOR.lastName, role: 'advisor' });
  writeAccount({ role: 'advisor', name: `${ADVISOR.title} ${ADVISOR.name}`, email: ADVISOR.email, password: ADVISOR.password, character: ADVISOR.character });

  // 1. group
  const group = await me.createGroup(GROUP.name, GROUP.term);
  me.note(`Grup açıldı: ${group.name}, katılım kodu ${group.join_code}`);
  writeAccount({ role: 'advisor', name: `${ADVISOR.title} ${ADVISOR.name}`, email: ADVISOR.email, password: ADVISOR.password, character: ADVISOR.character, groupCode: group.join_code });

  // 2. targets: all six competencies, levels 2 or 3
  const { competencies, kpis } = await me.listFramework();
  if (competencies.length !== 6) me.bug({ did: 'read the framework', expected: '6 competencies', got: `${competencies.length}`, severity: 'wrong' });
  const targets = competencies.map((c, i) => ({ competencyId: c.id, targetLevel: i % 2 === 0 ? 2 : 3 }));
  await me.attempt('set competency targets', () => me.setGroupTargets(group.id, targets));

  // 3. tasks: one per competency at level 1 or 2 (within scope), plus two extra; six published, two drafts
  const drafts = [];
  for (const [i, c] of competencies.entries()) {
    const level = Math.min(targets[i].targetLevel, 2);
    const kpi = kpis.find((k) => k.competency_id === c.id && k.level === level);
    if (!kpi) { me.bug({ did: `find a KPI for ${c.name} L${level}`, expected: 'one row', got: 'none', severity: 'wrong' }); continue; }
    const triplets = await me.listTriplets(kpi.id);
    const trip = triplets[i % triplets.length];
    const row = await me.attempt(`draft task from ${c.name} L${level}`, () => me.createAssignment({ groupId: group.id, tripletId: trip.id,
      title: trip.task, objective: trip.objective, criterion: trip.criterion, dueDate: daysAgoIso(-2), description: i === 0 ? 'Ölçüm cihazının kalibrasyon kaydını da ekleyin.' : undefined }));
    if (row) drafts.push({ id: row.id, title: row.title, competencyName: c.name, level, published: false });
  }
  // two extra from the first competency's second triplet
  const firstKpi = kpis.find((k) => k.competency_id === competencies[0].id && k.level === 1);
  const extra = await me.listTriplets(firstKpi.id);
  for (const trip of extra.slice(1, 3)) {
    const row = await me.attempt('draft an extra task', () => me.createAssignment({ groupId: group.id, tripletId: trip.id, title: trip.task, objective: trip.objective, criterion: trip.criterion }));
    if (row) drafts.push({ id: row.id, title: row.title, competencyName: competencies[0].name, level: 1, published: false });
  }
  // edit one title, out-of-scope attempt (level above target) must be refused
  await me.attempt('edit a draft title', () => me.updateAssignment(drafts[0].id, { title: drafts[0].title + ' (revize)' }));
  const highest = competencies.find((_, i) => targets[i].targetLevel === 2);
  const kpiOut = kpis.find((k) => k.competency_id === highest.id && k.level === 4);
  const tripOut = (await me.listTriplets(kpiOut.id))[0];
  await me.expectRefusal('NOT_IN_SCOPE', 'draft a task above the target level', () => me.createAssignment({ groupId: group.id, tripletId: tripOut.id, title: tripOut.task, objective: tripOut.objective, criterion: tripOut.criterion }));
  const toPublish = drafts.slice(0, 6).map((d) => d.id);
  const published = await me.attempt('publish six tasks', () => me.publishAssignments(toPublish));
  drafts.forEach((d) => { d.published = toPublish.includes(d.id); });
  if (published !== 6) me.bug({ did: 'publish six tasks', expected: '6', got: String(published), severity: 'wrong' });
  const counts = await me.attempt('read assignment counts', () => me.groupAssignmentCounts(group.id));
  me.note(`Sayaçlar: ${JSON.stringify(counts)}`);

  // 4. stream: announcement with photo + document + link, a poll, a draft announcement
  const photoPath = `${group.id}/${Date.now()}-sim/oryantasyon.png`;
  await me.upload('feed-attachments', photoPath, pngBytes(), 'image/png');
  const docPath = `${group.id}/${Date.now()}-sim/staj-rehberi.pdf`;
  await me.upload('feed-attachments', docPath, pdfBytes('Staj Rehberi'), 'application/pdf');
  const announcementId = await me.attempt('post an announcement with three attachments', () => me.createFeedPost(group.id, 'announcement',
    'Herkese merhaba. Staj haftası başladı: her gün stajdayım kaydını açmayı ve günlüğünüzü aynı gün yazmayı unutmayın. Rehber ekte.',
    null, [
      { kind: 'photo', target: photoPath, name: 'oryantasyon.png', mime: 'image/png', size: 100 },
      { kind: 'document', target: docPath, name: 'staj-rehberi.pdf', mime: 'application/pdf', size: 600 },
      { kind: 'link', target: 'https://www.csb.gov.tr/', name: 'Bakanlık' },
    ]));
  const pollId = await me.attempt('post a poll', () => me.createFeedPost(group.id, 'poll', 'Bu hafta hangi konuda kısa bir çevrimiçi oturum isterdiniz?',
    ['Atıksu arıtma prosesleri', 'ÇED mevzuatı', 'Saha ölçüm teknikleri', 'Rapor yazımı']));
  const draftAnnouncementId = await me.attempt('save a draft announcement', () => me.createFeedPost(group.id, 'announcement', 'Cuma günü 15:00\'te grup görüşmesi yapacağız (taslak).', null, [], true));
  const feed = await me.attempt('read the stream', () => me.listFeedPosts(group.id));
  const poll = (feed || []).find((p) => p.id === pollId);
  const pending = await me.attempt('read pending drafts', () => me.listFeedPending(group.id));
  if (!(pending || []).some((p) => p.id === draftAnnouncementId)) me.bug({ did: 'list pending drafts', expected: 'the draft announcement', got: JSON.stringify(pending), severity: 'wrong' });

  fs.writeFileSync(STATE, JSON.stringify({ groupId: group.id, joinCode: group.join_code, advisorId: me.userId, targets, assignments: drafts,
    posts: { announcementId, pollId, pollOptionIds: poll ? poll.poll.options.map((o) => o.id) : [], draftAnnouncementId } }, null, 2));
  me.note('Faz 1 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `node sim/phases/01-selin-aydin.cjs`
Expected: exit 0; `sim/state.json` exists with `joinCode` and 8 assignments (6 published); `sim/log/selin-aydin.md` shows the calls. Read the log: any `ERROR` line that was not an expected refusal becomes a bug entry (the script files most itself; file by hand what it did not).

If the `list_feed_posts` row shape differs from `poll.poll.options[].id` (check `src/services/feed.ts` `toPost`), fix the state extraction in the script — not the app — and note it in the log.

- [ ] **Step 3: Commit**

```bash
git add sim/phases/01-selin-aydin.cjs sim/state.json sim/log/selin-aydin.md sim/accounts.md sim/bugs.md
git commit -m "sim: phase 1 — advisor sets up the group" -- sim/phases/01-selin-aydin.cjs sim/state.json sim/log/selin-aydin.md sim/accounts.md sim/bugs.md
```

---

### Task 5: Phase 2 — students join (seven scripts, run in parallel)

**Files:**
- Create: `sim/phases/02-<slug>.cjs` for each of the seven students
- Modify: `sim/state.json` (each script adds `students[slug] = { userId, studentCode, membershipId }`)
- Create: `sim/lib/state.cjs` (read/merge helper so seven parallel writers do not clobber each other)

**Interfaces:**
- Consumes: `state.joinCode`, `state.posts`.
- Produces: `state.students[slug]`, `accounts.md` rows for students with their student code.

- [ ] **Step 1: Write the state helper**

`sim/lib/state.cjs`:
```js
const fs = require('node:fs');
const path = require('node:path');
const FILE = path.join(__dirname, '..', 'state.json');
function read() { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
/** Re-reads, applies patch(state), writes. Parallel writers each patch one key, so last-write-wins on the whole file is avoided. */
function merge(patch) {
  for (let i = 0; i < 5; i++) {
    try { const s = read(); patch(s); fs.writeFileSync(FILE, JSON.stringify(s, null, 2)); return s; }
    catch (e) { if (i === 4) throw e; }
  }
}
module.exports = { read, merge, FILE };
```

- [ ] **Step 2: Write Elif's script (the template every student agent adapts)**

`sim/phases/02-elif-kaya.cjs`:
```js
const { Actor, daysAgoIso, todayIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('elif-kaya');

(async () => {
  const me = new Actor(P);
  const s = state.read();
  await me.signUp({ email: P.email, password: P.password, firstName: P.firstName, lastName: P.lastName, role: 'student', avatarId: P.avatar });
  writeAccount({ role: 'student', name: P.name, email: P.email, password: P.password, company: P.company, character: P.character, avatar: P.avatar, groupCode: s.joinCode });
  await me.attempt('confirm the avatar from the profile', () => me.rpc('my_student_avatar'));

  // internship form (the app forces this before anything else)
  await me.attempt('fill the internship form', () => me.upsertStudentProfile({
    university: 'Yıldız Teknik Üniversitesi', faculty: 'İnşaat Fakültesi', department: 'Çevre Mühendisliği', department_branch: '',
    student_id: '21012345', company_name: P.company, company_address: 'Kadıköy, İstanbul', company_sector: 'Su ve atıksu',
    internship_start_date: daysAgoIso(6), internship_end_date: todayIso() }));

  // join by code
  const check = await me.attempt('validate the group code', () => me.validateGroupCode(s.joinCode));
  me.note(`validate_group_code → ${JSON.stringify(check)}`);
  const joined = await me.attempt('join the group', () => me.joinGroupByCode(s.joinCode));
  me.note(`join_group_by_code → ${JSON.stringify(joined)}`);
  await me.expectRefusal('INVALID_CODE', 'join with a wrong code', () => me.joinGroupByCode('ZZZZZZ'));

  // student code for the mentor
  let code = await me.attempt('read my student code', () => me.getMyStudentCode());
  code = Array.isArray(code) ? code[0] : code;
  if (!code) { const created = await me.attempt('create a student code', () => me.createStudentCode()); code = created; }
  const studentCode = code && (code.code || code.student_code);
  if (!studentCode) me.bug({ did: 'obtain a student code', expected: 'a 6-char code', got: JSON.stringify(code), severity: 'blocker' });
  writeAccount({ role: 'student', name: P.name, email: P.email, password: P.password, company: P.company, character: P.character, avatar: P.avatar, groupCode: s.joinCode, studentCode });

  // stream: read, vote, react in character (Elif reads carefully and votes)
  const feed = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  const kinds = (feed || []).map((p) => p.kind).sort();
  me.note(`Akışta ${kinds.length} gönderi: ${kinds.join(', ')} (6 görev kartı + duyuru + anket beklenir)`);
  if (s.posts.pollId && s.posts.pollOptionIds[0]) await me.attempt('vote in the poll', () => me.voteFeedPoll(s.posts.pollId, s.posts.pollOptionIds[0]));
  await me.attempt('like the announcement', () => me.likePost(s.posts.announcementId));
  await me.attempt('read my notifications', () => me.listNotifications());
  await me.attempt('read my progress (should be all zero)', () => me.getCompetencyProgress(me.userId));

  state.merge((st) => { st.students = st.students || {}; st.students[P.slug] = { userId: me.userId, studentCode, membershipId: joined && joined.membershipId }; });
  me.note('Faz 2 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Write the other six by character**

Same skeleton; the differences, per person (agents write real Turkish addresses/student numbers):
- **Burak** (`02-burak-sahin.cjs`): signs up last (`await sleep(4000)` first), fills the form with a `student_id` that has a trailing space (`'21023456 '`) and notes whether the app trimmed it; does **not** vote; likes nothing.
- **Zeynep** (`02-zeynep-arslan.cjs`): after joining, calls `joinGroupByCode(s.joinCode)` **again** and expects success with the same membership (short-circuit); if it returns a new membership id or an error, file `[wrong]`. Writes a one-word comment on the announcement: `'Tamam.'`.
- **Mert** (`02-mert-yilmaz.cjs`): votes, then votes for a different option (change of vote must succeed); comments `'Bence rapor yazımı, gerisi zaten sahada öğreniliyor.'`.
- **Ayşe** (`02-ayse-celik.cjs`): joins, reads the stream, votes, nothing else.
- **Can** (`02-can-dogan.cjs`): comments on **every** post in the stream (task cards included) with a question each; reads `listMessageContacts(groupId)` and notes who is listed (the advisor must be; classmates must be; his mentor cannot be yet — no mentor linked).
- **Deniz** (`02-deniz-yildirim.cjs`): likes the announcement and the poll, unlikes the poll, votes; fills the form with `internship_end_date` before `internship_start_date` **first** and expects the profile update to fail or the later `internship_open_day` to raise `ID_SETUP` — records which; then fixes the dates.

- [ ] **Step 4: Run all seven in parallel**

Run (PowerShell): `Get-ChildItem sim/phases/02-*.cjs | ForEach-Object { Start-Process node -ArgumentList $_.FullName -NoNewWindow -Wait }` — or seven subagents each running their own `node sim/phases/02-<slug>.cjs`.
Expected: seven exit-0 runs; `state.json.students` has seven entries with student codes; `accounts.md` has eight rows.

- [ ] **Step 5: Commit**

```bash
git add sim/lib/state.cjs sim/phases/02-*.cjs sim/state.json sim/log sim/accounts.md sim/bugs.md
git commit -m "sim: phase 2 — seven students join" -- sim/lib/state.cjs sim/phases/02-*.cjs sim/state.json sim/log sim/accounts.md sim/bugs.md
```

---

### Task 6: Phase 3 — mentors link

**Files:**
- Create: `sim/phases/03-<slug>.cjs` ×7

**Interfaces:**
- Consumes: `state.students[slug].studentCode`.
- Produces: `state.mentors[slug] = { userId }`; `accounts.md` mentor rows.

- [ ] **Step 1: Write Hakan's script (template)**

`sim/phases/03-hakan-demir.cjs`:
```js
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('hakan-demir');

(async () => {
  const me = new Actor(P);
  const s = state.read();
  await me.signUp({ email: P.email, password: P.password, firstName: P.firstName, lastName: P.lastName, role: 'mentor' });
  writeAccount({ role: 'mentor', name: P.name, email: P.email, password: P.password, company: P.company, character: P.style });
  const student = s.students[P.studentSlug];
  await me.expectRefusal('INVALID_CODE', 'link with a made-up code', () => me.linkStudentByCode('ABC123', 'mentor'));
  const linked = await me.attempt('link my student by code', () => me.linkStudentByCode(student.studentCode, 'mentor'));
  me.note(`link_student_by_code → ${JSON.stringify(linked)}`);
  const people = await me.attempt('read my students', () => me.internshipPeople());
  if (!(people || []).some((p) => p.id === student.userId)) me.bug({ did: 'read internship_people after linking', expected: 'my student listed', got: JSON.stringify(people), severity: 'wrong' });
  await me.attempt('read pending reviews (none yet)', () => me.listPendingReviews());
  await me.attempt('read mentor message contacts', () => me.listMentorMessageContacts());
  state.merge((st) => { st.mentors = st.mentors || {}; st.mentors[P.slug] = { userId: me.userId }; });
  me.note('Faz 3 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: The other six**

Same skeleton. Extras: **Ayça** tries to link Elif's code too (a second mentor for the same student) and records whether it is refused and with which code (spec: the student has one mentor; the app's answer is whatever it is — note it). **Emre** signs up, links, and reads nothing else (slow). **Selin Kurt** opens a conversation with her student right away via `listMentorMessageContacts` → `openConversation(groupId, studentId)` → `sendMessage('Hoş geldin Can, sorularını buradan yazabilirsin.')`.

- [ ] **Step 3: Run in parallel, then commit**

```bash
git add sim/phases/03-*.cjs sim/state.json sim/log sim/accounts.md sim/bugs.md
git commit -m "sim: phase 3 — mentors link" -- sim/phases/03-*.cjs sim/state.json sim/log sim/accounts.md sim/bugs.md
```

---

### Task 7: Phase 4 — the students' week

**Files:**
- Create: `sim/phases/04-<slug>.cjs` ×7

**Interfaces:**
- Consumes: `state.assignments` (published ones), `state.students`, `state.mentors`, `state.groupId`.
- Produces: `state.students[slug].submissions = [{ assignmentId, submissionId }]`, `.days = [{ date, id }]`, `.conversations = { advisor?, mentor?, classmate? }`.

- [ ] **Step 1: Write Elif's script (template)**

`sim/phases/04-elif-kaya.cjs`:
```js
const { Actor, daysAgoIso, todayIso } = require('../actor.cjs');
const { bySlug, ADVISOR } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('elif-kaya');
const WEEKDAY = (iso) => { const d = new Date(iso + 'T12:00:00'); return d.getDay() >= 1 && d.getDay() <= 5; };
const JOURNAL = {
  experience: ['Ön çökeltim havuzunda çamur seviyesi ölçümü yaptık; numune alma noktalarını öğrendim.', 'Havalandırma havuzunda çözünmüş oksijen profilini çıkardık.', 'Laboratuvarda KOİ ve AKM analizlerine eşlik ettim.', 'SCADA ekranından pompa arıza kayıtlarını inceledik.', 'Çamur susuzlaştırma ünitesinde polimer dozajı denemesi yapıldı.', 'Deşarj noktasında numune aldık, saha defterini doldurdum.'],
  learning: ['Numune etiketinde saat ve nokta kodunun neden zorunlu olduğunu anladım.', 'DO değeri 2 mg/L altına düşünce nitrifikasyonun bozulduğunu gördüm.', 'KOİ analizinde seyreltme oranının sonucu nasıl etkilediğini öğrendim.', 'Arıza kaydı olmadan bakım planı yapılamıyor.', 'Polimer fazlası çamuru yapışkan hale getiriyor.', 'Deşarj limitleri yönetmelikte tablo 21.1\'de.'],
};

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const mine = s.students[P.slug];
  const days = []; const submissions = [];

  // attendance: today is a real check-in, earlier weekdays are opened with a reason
  const past = [6, 5, 4, 3, 2, 1].map(daysAgoIso).filter(WEEKDAY);
  for (const [i, date] of past.entries()) {
    const id = await me.attempt(`open past day ${date} with a reason`, () => me.internshipOpenDay(me.userId, date, 'Kaydı gün sonunda açamadım, sahadaydım.'));
    if (id) days.push({ date, id });
  }
  const todayId = await me.attempt('check in today', () => me.internshipOpenDay(me.userId, todayIso()));
  if (todayId) days.push({ date: todayIso(), id: todayId });
  await me.expectRefusal('ID_EXISTS', 'open today twice', () => me.internshipOpenDay(me.userId, todayIso())); // note the actual code if different
  const week = await me.attempt('read my week', () => me.internshipWeek(me.userId, daysAgoIso(6)));

  // journals: Elif writes every day, submits every one
  for (const [i, day] of (week || []).entries()) {
    const form = { experience: JOURNAL.experience[i % 6], learning: JOURNAL.learning[i % 6], nextStep: 'Yarın numune planını mentorla gözden geçireceğim.', support: i < 2 ? 1 : 2, reason: '', taskId: null, attachment: null };
    await me.attempt(`save journal draft ${day.day_date}`, () => me.internshipSaveLog(day, form, false));
    const fresh = (await me.internshipWeek(me.userId, daysAgoIso(6))).find((d) => d.id === day.id); // version bumped
    await me.attempt(`submit journal ${day.day_date}`, () => me.internshipSaveLog(fresh, form, true));
  }

  // tasks: evidence on every one, honest self level
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  for (const [i, task] of (tasks || []).slice(0, 4).entries()) {
    const photo = await me.attempt('upload a photo', () => me.uploadPhoto(task.id));
    const doc = await me.attempt('upload a document', () => me.uploadDocument(task.id, 'olcum-tablosu.pdf'));
    const submissionId = await me.attempt(`submit task "${task.title}"`, () => me.submitAssignment(task.id,
      `Görevi ${['pazartesi', 'salı', 'çarşamba', 'perşembe'][i]} tamamladım; ölçüm tablosu ve saha fotoğrafı ekte.`,
      'Bu görevde en çok kalibrasyonun neden her ölçümden önce yapıldığını anladım.',
      photo ? [{ uri: photo, caption: 'Saha fotoğrafı' }] : [], doc ? [{ uri: doc, fileName: 'olcum-tablosu.pdf', fileType: 'application/pdf', fileSize: 600 }] : [], i === 0 ? 1 : 2));
    if (submissionId) submissions.push({ assignmentId: task.id, submissionId });
  }
  await me.expectRefusal('REFLECTION_REQUIRED', 'submit without a reflection', () => me.submitAssignment(tasks[4].id, 'Not', '', [], [], 2));
  await me.expectRefusal('SELF_LEVEL_REQUIRED', 'submit without a self level', () => me.submitAssignment(tasks[4].id, 'Not', 'Yansıma', [], [], undefined));

  // messages: Elif writes to Burak (classmate)
  const contacts = await me.attempt('read message contacts', () => me.listMessageContacts(s.groupId));
  const burak = (contacts || []).find((c) => c.id === s.students['burak-sahin'].userId);
  let classmate;
  if (burak) { classmate = await me.attempt('open a conversation with Burak', () => me.openConversation(s.groupId, burak.id));
    if (classmate) await me.attempt('message Burak', () => me.sendMessage(classmate, 'Burak, ikinci görevin kriterini anladın mı? Ben ölçüm tablosunu ekledim.')); }
  await me.attempt('read notifications', () => me.listNotifications());
  await me.attempt('read unread message count', () => me.unreadMessageCount());
  await me.attempt('sync growth awards', () => me.syncMyGrowthAwards());

  state.merge((st) => { Object.assign(st.students[P.slug], { days, submissions, conversations: { classmate } }); });
  me.note('Faz 4 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: The other six by character**

- **Burak**: opens only today + two past days (misses one); journals: writes drafts for all but submits only two; submits **five** tasks all at once at the end with the same reflection text (`'Yaptım.'` — note whether such a short reflection is accepted; if it is, file `[rough]`), self level 2; replies to Elif's message when he reads it (`listConversations` → `listMessages` → `sendMessage`); reads notifications and marks one read.
- **Zeynep**: journals of one line each; submits three tasks: one with **no evidence at all** (note the app's answer — evidence is not required server-side; file `[rough]` if it went through silently), one photo-only, one both; self level 2; on the photo-only one calls `setSubmissionSharing(submissionId, false)` immediately after submitting; no messages.
- **Mert**: opens all days; journals with `support: 3` every day; submits four tasks with `selfLevel: 3` each and a confident note; messages nobody; likes his own task card in the stream if one appears (it should not yet — tasks are not approved; note what `listFeedPosts` shows).
- **Ayşe**: opens all days, journals every day with `support` 1–2, submits four tasks with evidence and honest levels; sends **no** messages, comments nothing; reads the leaderboard.
- **Can**: everything Ayşe does, plus: opens a conversation with the advisor (`ADVISOR` id from `state.advisorId`) and asks two questions; opens one with his mentor (`state.mentors['selin-kurt'].userId`) and replies to her welcome; comments on his own task card once one exists (none yet — note it); calls `listCaseCandidates(groupId)` as a student and records the refusal code (students cannot open cases).
- **Deniz**: opens all days **except** `daysAgoIso(3)`; journals the rest; submits three tasks with evidence; after the week calls `internshipOpenDay(me.userId, daysAgoIso(3), 'Sağlık raporu, ektedir.')` (the excused day, opened late) and writes a journal saying she was absent; blocks the classmate conversation Elif might open with her (none — instead she opens one with Elif and immediately `blockConversation(id, true)`, then tries `sendMessage` and expects `BLOCKED` — note the real code); unblocks.

- [ ] **Step 3: Run in parallel, commit**

```bash
git add sim/phases/04-*.cjs sim/state.json sim/log sim/bugs.md
git commit -m "sim: phase 4 — the students' week" -- sim/phases/04-*.cjs sim/state.json sim/log sim/bugs.md
```

---

### Task 8: Phase 5 — mentors decide

**Files:**
- Create: `sim/phases/05-<slug>.cjs` ×7

**Interfaces:**
- Consumes: `state.students[slug].days / submissions`, `state.mentors`.
- Produces: `state.mentors[slug].reviewed = [{ submissionId, approved, level }]`, `.attendance = [...]`.

- [ ] **Step 1: Write Hakan's script (template)**

`sim/phases/05-hakan-demir.cjs`:
```js
const { Actor, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('hakan-demir');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const student = s.students[P.studentSlug];
  const reviewed = [];

  // attendance: every day present; one journal gets a note
  const week = await me.attempt('read my student\'s week', () => me.internshipWeek(student.userId, daysAgoIso(6)));
  const pendingDays = (week || []).filter((d) => d.attendance === 'pending');
  await me.attempt(`mark ${pendingDays.length} days present`, () => me.internshipReview(pendingDays, 'present', 'Her gün sahadaydı.'));
  const first = (await me.internshipWeek(student.userId, daysAgoIso(6)))[0];
  if (first) await me.attempt('leave a note on the first journal', () => me.internshipNote(first, 'Numune etiketi kısmı çok iyi; DO ölçüm saatini de yazsaydın tam olurdu.', false));
  await me.attempt('read the day\'s events', () => me.internshipEvents(first.id));

  // reviews: approve promptly with a two-line note and a level
  const pending = await me.attempt('read pending reviews', () => me.listPendingReviews());
  const mineOnly = (pending || []).filter((p) => p.student_id === student.userId);
  if (mineOnly.length !== (pending || []).length) me.bug({ did: 'read pending reviews', expected: 'only my student\'s submissions', got: `${(pending || []).length} rows, ${mineOnly.length} mine`, severity: 'wrong' });
  await me.expectRefusal('LEVEL_REQUIRED', 'approve without a level', () => me.reviewAssignment(mineOnly[0].id, true, 'Onay', undefined));
  for (const [i, sub] of mineOnly.entries()) {
    const level = Math.min(3, (sub.self_level ?? 1) + (i === 1 ? 1 : 0)); // once sees more than the student
    await me.attempt(`approve "${sub.group_assignments.title}"`, () => me.reviewAssignment(sub.id, true, 'Ölçüm tablosu eksiksiz, fotoğraf net.\nBir sonraki görevde birimleri de yaz.', level));
    reviewed.push({ submissionId: sub.id, approved: true, level });
  }
  await me.expectRefusal('ALREADY_APPROVED', 'approve the same submission again', () => me.reviewAssignment(mineOnly[0].id, true, 'tekrar', 2));
  // another student's submission must be refused
  const other = s.students['burak-sahin'].submissions[0];
  if (other) await me.expectRefusal('SUBMISSION_NOT_FOUND', 'review another mentor\'s student', () => me.reviewAssignment(other.submissionId, true, 'x', 2));
  await me.attempt('read the self-vs-mentor comparison', () => me.competencySelfVsMentor(student.userId));
  await me.attempt('read notifications', () => me.listNotifications());
  state.merge((st) => { Object.assign(st.mentors[P.slug], { reviewed }); });
  me.note('Faz 5 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: The other six by style**

- **Ayça**: marks days present; sends **one** of Burak's submissions back (`reviewAssignment(id, false, 'Kriter ölçüm belirsizliğini istiyor; tabloda yok. Ekleyip yeniden gönder.')`), approves the others with levels; then `listFeedPosts` to confirm no card exists for the returned task.
- **Murat**: approves all of Zeynep's with `note: ''` and `level: 2` (note whether an empty note is accepted); marks days present without a note; never reads anything else.
- **Gamze**: approves Mert's with `level: 1` on every one and a note explaining why; reads `competencySelfVsMentor(mert)` and records `gap`/`overRated` (expected negative gap, overRated = tasks).
- **Emre**: marks days present; approves all of Ayşe's **but one** (leaves the newest `submitted`) — this is what phase 7's `PENDING_REVIEWS` relies on; records which one.
- **Selin Kurt**: marks one day `partial` with a note, the rest present; approves Can's; replies in the conversation Can opened; comments on the announcement.
- **Oğuz**: marks Deniz's late-opened day `excused` with the note `'Sağlık raporu görüldü.'`, the rest present; asks for a correction on one journal (`internshipNote(day, 'Öğrendiklerini bir cümleyle netleştir.', true)`); approves her tasks.

- [ ] **Step 3: Run in parallel, commit**

```bash
git add sim/phases/05-*.cjs sim/state.json sim/log sim/bugs.md
git commit -m "sim: phase 5 — mentors decide" -- sim/phases/05-*.cjs sim/state.json sim/log sim/bugs.md
```

---

### Task 9: Phase 6 — students follow up

**Files:**
- Create: `sim/phases/06-<slug>.cjs` ×7 (short)

- [ ] **Step 1: Write Burak's (the one with real work) and the shared tail**

`sim/phases/06-burak-sahin.cjs`:
```js
const { Actor, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('burak-sahin');
(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  const returned = (tasks || []).find((t) => (t.assignment_submissions || []).some((x) => x.status === 'needs_revision'));
  if (!returned) me.bug({ did: 'find the returned task', expected: 'one needs_revision submission', got: 'none', severity: 'wrong' });
  else {
    const photo = await me.attempt('upload the missing table as a photo', () => me.uploadPhoto(returned.id));
    await me.attempt('resubmit with the uncertainty column', () => me.submitAssignment(returned.id, 'Ölçüm belirsizliği sütununu ekledim.', 'Belirsizliği hesaplamadan tablo eksik sayılıyormuş.', photo ? [{ uri: photo, caption: 'Güncel tablo' }] : [], [], 1));
  }
  const approved = (tasks || []).find((t) => (t.assignment_submissions || []).some((x) => x.status === 'approved'));
  if (approved) await me.expectRefusal('ALREADY_APPROVED', 'submit an approved task again', () => me.submitAssignment(approved.id, 'x', 'y', [], [], 2));
  // shared tail
  await me.attempt('read self vs mentor', () => me.competencySelfVsMentor(me.userId));
  await me.attempt('read competency progress', () => me.getCompetencyProgress(me.userId));
  await me.attempt('read working KPIs', () => me.getWorkingKpis(me.userId));
  await me.attempt('read the leaderboard', () => me.getMyGroupLeaderboard(10));
  await me.attempt('read the stream (approved tasks should now be cards)', () => me.listFeedPosts(s.groupId));
  await me.attempt('read notifications', () => me.listNotifications());
  const convs = await me.attempt('read conversations', () => me.listConversations(s.groupId));
  for (const c of (convs || [])) { await me.attempt('read messages', () => me.listMessages(c.id)); await me.attempt('mark read', () => me.markConversationRead(c.id)); }
  me.note('Faz 6 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: The others**

Shared tail only, plus: **Deniz** answers the correction (`internshipSaveLog` on the flagged day with a clearer `learning`, submit = true — read the day fresh first for its `version`); **Zeynep** turns sharing back **on** for the task she hid and checks a card appears in the stream; **Mert** reads his comparison and notes `gap`; **Can** comments on a classmate's approved task card and likes it; **Elif** reads the leaderboard and notes her rank; **Ayşe** only the tail.

- [ ] **Step 3: Run in parallel, commit**

```bash
git add sim/phases/06-*.cjs sim/state.json sim/log sim/bugs.md
git commit -m "sim: phase 6 — students follow up" -- sim/phases/06-*.cjs sim/state.json sim/log sim/bugs.md
```

---

### Task 10: Phase 7 — the advisor reports and closes

**Files:**
- Create: `sim/phases/07-selin-aydin.cjs`
- Create: `sim/phases/07b-emre-aksoy.cjs` (the late approval, run between the two closure attempts)
- Create: `sim/phases/07c-ayse-celik.cjs` (post-closure refusal)

- [ ] **Step 1: Write the advisor's script**

`sim/phases/07-selin-aydin.cjs`:
```js
const { Actor } = require('../actor.cjs');
const { ADVISOR, STUDENTS } = require('../people.cjs');
const state = require('../lib/state.cjs');
const step = process.argv[2] || 'a'; // 'a' = up to the refused closure, 'b' = after Emre approves
(async () => {
  const me = new Actor(ADVISOR);
  await me.signIn(ADVISOR.email, ADVISOR.password);
  const s = state.read();
  const ayse = s.students['ayse-celik'];
  if (step === 'a') {
    for (const st of STUDENTS) {
      const u = s.students[st.slug];
      await me.attempt(`progress of ${st.name}`, () => me.getCompetencyProgress(u.userId));
      await me.attempt(`self vs mentor of ${st.name}`, () => me.competencySelfVsMentor(u.userId));
      await me.attempt(`closure status of ${st.name}`, () => me.internshipClosureStatus(u.userId, s.groupId));
    }
    await me.attempt('group attendance table', () => me.internshipGroupAttendance(s.groupId));
    await me.attempt('remind Burak', () => me.createNotification(s.students['burak-sahin'].userId, 'Görev hatırlatması', 'Selin Aydın: bekleyen görevlerin var.', 'general', {}));
    const candidates = await me.attempt('list case candidates', () => me.listCaseCandidates(s.groupId));
    const caseId = await me.attempt('open a case for Can', () => me.openCase(s.groupId, s.students['can-dogan'].userId));
    if (caseId) await me.attempt('write in the case', () => me.sendMessage(caseId, 'Can, mentorunla birlikte ikinci haftanın hedeflerini burada netleştirelim.'));
    await me.expectRefusal('CASE_EXISTS', 'open the same case twice', () => me.openCase(s.groupId, s.students['can-dogan'].userId)); // note the real code; spec says idempotent -> may succeed with the same id: then file nothing, note it
    await me.attempt('publish the draft announcement', () => me.publishFeedPost(s.posts.draftAnnouncementId));
    const comments = await me.attempt('read comments on the announcement', () => me.listComments(s.posts.announcementId));
    const canComment = (comments || []).find((c) => c.author_id === s.students['can-dogan'].userId);
    if (canComment) await me.attempt('moderate: delete one comment', () => me.deleteComment(canComment.id));
    await me.expectRefusal('PENDING_REVIEWS', 'close Ayşe while a submission awaits her mentor', () => me.closeInternship(ayse.userId, s.groupId));
    me.note('Adım a bitti — Emre onaylasın.');
  } else {
    const closed = await me.attempt('close Ayşe', () => me.closeInternship(ayse.userId, s.groupId));
    const report = await me.attempt('read the report', () => me.getInternshipReport(ayse.userId, s.groupId));
    if (report && !report.includes('Ayşe Çelik')) me.bug({ did: 'read the closure report', expected: 'the student\'s name in the title', got: report.slice(0, 80), severity: 'wrong' });
    if (report && /Yansıma|Ne öğrendim/.test(report)) me.bug({ did: 'read the closure report', expected: 'no free text', got: 'reflection text present', severity: 'wrong' });
    await me.expectRefusal('ALREADY_CLOSED', 'close again', () => me.closeInternship(ayse.userId, s.groupId));
    await me.expectRefusal('REASON_REQUIRED', 'reopen without a reason', () => me.reopenInternship(ayse.userId, s.groupId, '  '));
    await me.attempt('reopen with a reason', () => me.reopenInternship(ayse.userId, s.groupId, 'Eksik bir günlük vardı, öğrenci tamamlayacak.'));
    const again = await me.attempt('close again (version 2)', () => me.closeInternship(ayse.userId, s.groupId));
    if (again && again.reportVersion !== 2) me.bug({ did: 'close a second time', expected: 'reportVersion 2', got: JSON.stringify(again), severity: 'wrong' });
    await me.attempt('closure status', () => me.internshipClosureStatus(ayse.userId, s.groupId));
    state.merge((st) => { st.closed = { studentSlug: 'ayse-celik', closure: closed }; });
    me.note('Faz 7 bitti.');
  }
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Emre's late approval and Ayşe's post-closure attempt**

`07b-emre-aksoy.cjs`: sign in, `listPendingReviews`, approve the remaining one with level 2 and the note `'Geç oldu, kusura bakma.'`.
`07c-ayse-celik.cjs`: sign in; `expectRefusal('INTERNSHIP_CLOSED', …)` for `submitAssignment` on an unsubmitted task, for `internshipOpenDay(today)` (already open — use `internshipSaveLog` on today's journal instead), and for `sendMessage` in any conversation she has (she has none — open one with the advisor first and expect `INTERNSHIP_CLOSED` there too); then `getInternshipReport(me.userId, groupId)` as the student and note that it reads; `listFeedPosts` still works; like a post (must still work — likes are not guarded).

- [ ] **Step 3: Run in order**

`node sim/phases/07-selin-aydin.cjs a` → `node sim/phases/07b-emre-aksoy.cjs` → `node sim/phases/07-selin-aydin.cjs b` → `node sim/phases/07c-ayse-celik.cjs`.

- [ ] **Step 4: Commit**

```bash
git add sim/phases/07*.cjs sim/state.json sim/log sim/bugs.md
git commit -m "sim: phase 7 — reports, case thread, closure" -- sim/phases/07*.cjs sim/state.json sim/log sim/bugs.md
```

---

### Task 11: Phase 8 — the auditor

**Files:**
- Create: `sim/phases/08-audit.cjs`
- Create: `sim/AUDIT.md` (written by the script + the agent's screen-reading notes)

**Interfaces:**
- Consumes: `accounts.md` (all credentials), `state.json`.
- Produces: consistency findings in `bugs.md`; `AUDIT.md` with one section per person listing what each screen's reads return.

- [ ] **Step 1: Write the audit script**

`sim/phases/08-audit.cjs`:
```js
// Signs in as everyone, runs each role's screen reads, checks cross-person consistency and isolation.
const fs = require('node:fs');
const path = require('node:path');
const { Actor, daysAgoIso } = require('../actor.cjs');
const { ALL, STUDENTS, MENTORS, ADVISOR, mentorOf } = require('../people.cjs');
const state = require('../lib/state.cjs');
const OUT = path.join(__dirname, '..', 'AUDIT.md');
const lines = ['# Audit', ''];
const auditor = { slug: 'auditor', name: 'Auditor' };
const actors = {};
async function as(p) { if (!actors[p.slug]) { actors[p.slug] = new Actor({ ...p, slug: 'auditor' }); await actors[p.slug].signIn(p.email, p.password); } return actors[p.slug]; }
function section(title) { lines.push(`## ${title}`, ''); }
function row(label, value) { lines.push(`- ${label}: ${typeof value === 'string' ? value : JSON.stringify(value).slice(0, 300)}`); }

(async () => {
  const s = state.read();
  const A = new Actor(auditor);
  const bug = (entry) => A.bug(entry);

  // students
  const pendingByStudent = {};
  for (const p of STUDENTS) {
    const me = await as(p); section(p.name);
    const tasks = await me.listMyAssignments(); row('tasks (my-tasks)', tasks.map((t) => `${t.title.slice(0, 30)}:${(t.assignment_submissions[0] || {}).status || 'todo'}`));
    pendingByStudent[p.slug] = tasks.filter((t) => (t.assignment_submissions[0] || {}).status === 'submitted').length;
    row('progress (growth)', await me.getCompetencyProgress(me.userId));
    row('self vs mentor', await me.competencySelfVsMentor(me.userId));
    row('week (internship days)', (await me.internshipWeek(me.userId, daysAgoIso(6))).map((d) => `${d.day_date}:${d.attendance}/${d.log_status}`));
    row('stream count', (await me.listFeedPosts(s.groupId)).length);
    row('conversations', (await me.listConversations(s.groupId)).map((c) => c.title || c.kind));
    row('unread', await me.unreadMessageCount());
    row('notifications', (await me.listNotifications()).map((n) => n.type));
    row('closure', await me.internshipClosureStatus(me.userId, s.groupId));
    // isolation: another student's submissions must be invisible
    const other = STUDENTS.find((o) => o.slug !== p.slug);
    const leak = await me.table('assignment_submissions', 'select-other', (q) => q.select('id').eq('student_id', s.students[other.slug].userId));
    if ((leak || []).length) bug({ did: `${p.name} reads ${other.name}'s submissions`, expected: '0 rows', got: `${leak.length}`, severity: 'blocker' });
    lines.push('');
  }
  // mentors: pending count equals the student's submitted rows
  for (const m of MENTORS) {
    const me = await as(m); section(m.name);
    const pending = await me.listPendingReviews(); row('pending reviews', pending.length);
    if (pending.length !== pendingByStudent[m.studentSlug]) bug({ did: `${m.name}'s pending count vs ${m.studentSlug}'s submitted rows`, expected: String(pendingByStudent[m.studentSlug]), got: String(pending.length), severity: 'wrong' });
    row('people', (await me.internshipPeople()).map((x) => x.name));
    row('contacts', (await me.listMentorMessageContacts()).map((x) => x.name));
    lines.push('');
  }
  // advisor: attendance table vs days
  const adv = await as(ADVISOR); section(ADVISOR.name);
  const att = await adv.internshipGroupAttendance(s.groupId); row('attendance', att);
  row('counts', await adv.groupAssignmentCounts(s.groupId));
  row('pending drafts', (await adv.listFeedPending(s.groupId)).length);
  row('members', (await adv.groupMembers(s.groupId)).length);
  // outsider: a mentor reading the advisor's report for a student not theirs
  const stranger = await as(MENTORS[1]);
  await stranger.expectRefusal('REPORT_FORBIDDEN', 'a non-linked mentor reads Ayşe\'s report', () => stranger.getInternshipReport(s.students['ayse-celik'].userId, s.groupId));
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  console.log('audit written');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it, then the screen-reading pass**

Run: `node sim/phases/08-audit.cjs`. Then the auditor agent reads `sim/AUDIT.md` next to the screens that render each read (`app/(student)/dashboard.tsx`, `my-tasks.tsx`, `task-detail.tsx`, `achievements.tsx`, `src/components/screens/FeedScreen.tsx`, `MessagesScreen.tsx`, `src/components/internship/InternshipDaysScreen.tsx`, `app/(mentor)/pending-reviews.tsx`, `review-detail.tsx`, `app/(advisor)/reports.tsx`, `student-monitor.tsx`) and appends to `AUDIT.md` a "Screen notes" section: for each screen, what this data would show that reads oddly — empty titles, `—` where a value exists, dates in the wrong locale, counts that disagree between two screens, a `numberOfLines={1}` that truncates a real title. Each such note that is a defect also goes to `bugs.md` as `[rough]` or `[wrong]`.

- [ ] **Step 3: Commit**

```bash
git add sim/phases/08-audit.cjs sim/AUDIT.md sim/log sim/bugs.md
git commit -m "sim: phase 8 — audit" -- sim/phases/08-audit.cjs sim/AUDIT.md sim/log sim/bugs.md
```

---

### Task 12: Merge and report

**Files:**
- Modify: `sim/bugs.md` (dedupe, order by severity)
- Modify: `sim/RUN.md` (phase summaries and the tally)

- [ ] **Step 1: Dedupe the bug list**

Read `sim/bugs.md`; merge entries that describe the same defect (same code + same operation) into one line listing every person who hit it; order `blocker` → `wrong` → `rough`; keep the original wording of the first reporter.

- [ ] **Step 2: Write the run summary**

Append to `sim/RUN.md`:
```markdown
## Summary

| Phase | People | Calls | Expected refusals that behaved | Bugs filed |
|---|---|---|---|---|
| 1 advisor setup | 1 | … | NOT_IN_SCOPE | … |
| 2 students join | 7 | … | INVALID_CODE ×7, same-code rejoin | … |
| … | | | | |

Accounts: 15 (+1 probe). Group: <name>, code <code>. Tasks: 8 (6 published). Submissions: N. Days: N. Journals: N. Messages: N. Posts: N.

Findings: B blockers, W wrong, R rough — see `bugs.md`.
```
Counts come from `grep -c '\*\*' sim/log/*.md` per phase marker and from `state.json`.

- [ ] **Step 3: Commit and push**

```bash
git add sim/bugs.md sim/RUN.md
git commit -m "sim: merged findings and run summary" -- sim/bugs.md sim/RUN.md
git push origin feature/competency-framework
```

Then tell the owner: the accounts are in `sim/accounts.md`; sign in with any of them; the bug list is `sim/bugs.md`; the probe account `probe.<stamp>@sim.engineertrack.test` can be deleted.
