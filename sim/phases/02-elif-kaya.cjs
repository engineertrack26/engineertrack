// Phase 2 — Elif Kaya joins. Template for the other six students' scripts.
//
// Adaptations from the brief's literal skeleton (see me.note() calls below
// for the same, logged in-band):
//  1. --resume flag: the script signs up once; a crash mid-way is recovered
//     by signing in instead (auth.users already has the row, a second
//     signUp would fail).
//  2. validate_group_code / join_group_by_code are RETURNS TABLE(...)
//     functions. PostgREST returns their result as an ARRAY of rows, not a
//     single object with a `membershipId` field the way the brief's
//     skeleton guessed. join_group_by_code's row is
//     { id, name, term, advisor_name } (the GROUP's id, not a membership
//     id) — there is no membershipId anywhere in its return value. The
//     script reads group_memberships directly (own row, RLS-visible) to
//     get the real membership id state.json needs.
//  3. get_my_student_code is RETURNS TABLE(code TEXT) — also an array; a
//     student with no code yet gets back an empty array, not null/undefined.
const { Actor, daysAgoIso, todayIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('elif-kaya');
const RESUME = process.argv.includes('--resume');

(async () => {
  const me = new Actor(P);
  const s = state.read();
  if (RESUME) {
    await me.signIn(P.email, P.password);
    me.note('Resumed with sign-in (--resume): a previous run crashed mid-way.');
  } else {
    await me.signUp({ email: P.email, password: P.password, firstName: P.firstName, lastName: P.lastName, role: 'student', avatarId: P.avatar });
  }
  writeAccount({ role: 'student', name: P.name, email: P.email, password: P.password, company: P.company, character: P.character, avatar: P.avatar, groupCode: s.joinCode });
  await me.attempt('confirm the avatar from the profile', () => me.rpc('my_student_avatar'));

  // internship form (the app forces this before anything else)
  await me.attempt('fill the internship form', () => me.upsertStudentProfile({
    university: 'Yıldız Teknik Üniversitesi', faculty: 'İnşaat Fakültesi', department: 'Çevre Mühendisliği', department_branch: '',
    student_id: '21012345', company_name: P.company, company_address: 'Kadıköy, İstanbul', company_sector: 'Su ve atıksu',
    internship_start_date: daysAgoIso(6), internship_end_date: todayIso() }));

  // join by code
  const check = await me.attempt('validate the group code', () => me.validateGroupCode(s.joinCode));
  me.note(`validate_group_code → ${JSON.stringify(check)} (an ARRAY of rows — RETURNS TABLE; adaptation #2)`);
  const joined = await me.attempt('join the group', () => me.joinGroupByCode(s.joinCode));
  me.note(`join_group_by_code → ${JSON.stringify(joined)} (also an array; the row is {id, name, term, advisor_name} — the GROUP's id, no membershipId field at all)`);
  await me.expectRefusal('INVALID_CODE', 'join with a wrong code', () => me.joinGroupByCode('ZZZZZZ'));

  // the RPC does not return a membership id (adaptation #2); read it back directly
  const myMembership = await me.attempt('read my own membership row', () =>
    me.table('group_memberships', 'select-own', (q) => q.select('id, joined_at').eq('student_id', me.userId).eq('group_id', s.groupId).is('left_at', null).maybeSingle()));
  const membershipId = myMembership && myMembership.id;
  if (!membershipId) me.bug({ did: 'read my own membership row after joining', expected: 'one active row', got: JSON.stringify(myMembership), severity: 'wrong' });

  // student code for the mentor
  let code = await me.attempt('read my student code', () => me.getMyStudentCode());
  me.note(`get_my_student_code → ${JSON.stringify(code)} (array; empty when no code exists yet — adaptation #3)`);
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

  state.merge((st) => { st.students = st.students || {}; st.students[P.slug] = { userId: me.userId, studentCode, membershipId }; });
  me.note('Faz 2 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
