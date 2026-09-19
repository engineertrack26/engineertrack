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
    .toLowerCase().replace(/\b(doc|dr|prof)\.?\s*/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
  uploadFeedAttachment(groupId, fileName, bytes, mime) {
    const filePath = `${groupId}/${Date.now()}-sim/${fileName}`;
    return this.upload('feed-attachments', filePath, bytes, mime).then(() => filePath);
  }
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
