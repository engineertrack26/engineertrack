// Phase 2 — Ayşe Çelik joins. Adapted from the template (sim/phases/02-elif-kaya.cjs).
// Character (brief Step 3, quiet): join, read the stream, vote in the poll — and
// nothing else social: no likes, no comments, no messages. Otherwise same as the template.
//
// Adaptations carried over from the template (see task-5a-report.md for detail):
//  1. --resume flag: a crash mid-way is recovered by signing in instead of signing up again.
//  2. validate_group_code / join_group_by_code are RETURNS TABLE(...) — PostgREST returns
//     an array of rows, not a single object; join_group_by_code's row is the GROUP's id,
//     not a membership id, so the real membership id is read back from group_memberships.
//  3. get_my_student_code is also RETURNS TABLE(code TEXT) — an array, empty when no code
//     exists yet.
const { Actor, daysAgoIso, todayIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('ayse-celik');
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
    university: 'Karadeniz Teknik Üniversitesi', faculty: 'Mühendislik Fakültesi', department: 'Çevre Mühendisliği', department_branch: '',
    student_id: '21034567', company_name: P.company, company_address: 'Ortahisar, Trabzon', company_sector: 'ÇED ve çevre danışmanlığı',
    internship_start_date: daysAgoIso(6), internship_end_date: todayIso() }));

  // join by code
  const check = await me.attempt('validate the group code', () => me.validateGroupCode(s.joinCode));
  me.note(`validate_group_code → ${JSON.stringify(check)} (array — RETURNS TABLE)`);
  const joined = await me.attempt('join the group', () => me.joinGroupByCode(s.joinCode));
  me.note(`join_group_by_code → ${JSON.stringify(joined)} (also an array; row is {id, name, term, advisor_name} — the GROUP's id, no membershipId field)`);
  await me.expectRefusal('INVALID_CODE', 'join with a wrong code', () => me.joinGroupByCode('ZZZZZZ'));

  // the RPC does not return a membership id; read it back directly
  const myMembership = await me.attempt('read my own membership row', () =>
    me.table('group_memberships', 'select-own', (q) => q.select('id, joined_at').eq('student_id', me.userId).eq('group_id', s.groupId).is('left_at', null).maybeSingle()));
  const membershipId = myMembership && myMembership.id;
  if (!membershipId) me.bug({ did: 'read my own membership row after joining', expected: 'one active row', got: JSON.stringify(myMembership), severity: 'wrong' });

  // student code for the mentor
  let code = await me.attempt('read my student code', () => me.getMyStudentCode());
  me.note(`get_my_student_code → ${JSON.stringify(code)} (array; empty when no code exists yet)`);
  code = Array.isArray(code) ? code[0] : code;
  if (!code) { const created = await me.attempt('create a student code', () => me.createStudentCode()); code = created; }
  const studentCode = code && (code.code || code.student_code);
  if (!studentCode) me.bug({ did: 'obtain a student code', expected: 'a 6-char code', got: JSON.stringify(code), severity: 'blocker' });
  writeAccount({ role: 'student', name: P.name, email: P.email, password: P.password, company: P.company, character: P.character, avatar: P.avatar, groupCode: s.joinCode, studentCode });

  // stream: read and vote only — quiet, no likes, no comments, no messages
  const feed = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  const kinds = (feed || []).map((p) => p.kind).sort();
  me.note(`Akışta ${kinds.length} gönderi: ${kinds.join(', ')} (6 görev kartı + duyuru + anket beklenir). Sessizce okudu, beğenmedi, yorum yapmadı.`);
  if (s.posts.pollId && s.posts.pollOptionIds[0]) await me.attempt('vote in the poll', () => me.voteFeedPoll(s.posts.pollId, s.posts.pollOptionIds[0]));
  await me.attempt('read my notifications', () => me.listNotifications());
  await me.attempt('read my progress (should be all zero)', () => me.getCompetencyProgress(me.userId));

  state.merge((st) => { st.students = st.students || {}; st.students[P.slug] = { userId: me.userId, studentCode, membershipId }; });
  me.note('Faz 2 bitti. Sessiz karakter: beğeni, yorum ve mesaj yok.');
})().catch((e) => { console.error(e); process.exit(1); });
