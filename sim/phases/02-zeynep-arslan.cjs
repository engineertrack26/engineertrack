// Phase 2 — Zeynep Arslan joins. Adapted from 02-elif-kaya.cjs (see that file's
// header for the general adaptations: array-returning RPCs, membership read-back,
// get_my_student_code shape).
//
// Character difference for this phase (task brief Step 3 / dispatch note):
// after joining once, Zeynep calls join_group_by_code AGAIN with the same code
// and is expected to hit a same-group short-circuit — same membership id, no
// new row, left_at still null on the original. group_memberships is read
// before and after the repeat call to check this directly; any error, a new
// membership id, or left_at getting set on the old row is filed as [wrong].
// She also writes exactly one one-word comment on the announcement: 'Tamam.'
// Terse throughout — short notes, minimal extra reading.
const { Actor, daysAgoIso, todayIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('zeynep-arslan');
const RESUME = process.argv.includes('--resume');

(async () => {
  const me = new Actor(P);
  const s = state.read();
  if (RESUME) {
    await me.signIn(P.email, P.password);
    me.note('--resume: signed in.');
  } else {
    await me.signUp({ email: P.email, password: P.password, firstName: P.firstName, lastName: P.lastName, role: 'student', avatarId: P.avatar });
  }
  writeAccount({ role: 'student', name: P.name, email: P.email, password: P.password, company: P.company, character: P.character, avatar: P.avatar, groupCode: s.joinCode });
  await me.attempt('confirm the avatar', () => me.rpc('my_student_avatar'));

  // internship form
  await me.attempt('fill the internship form', () => me.upsertStudentProfile({
    university: 'Gazi Üniversitesi', faculty: 'Mühendislik Fakültesi', department: 'Çevre Mühendisliği', department_branch: '',
    student_id: '21045678', company_name: P.company, company_address: 'Yenimahalle, Ankara', company_sector: 'Hava kalitesi izleme',
    internship_start_date: daysAgoIso(6), internship_end_date: todayIso() }));

  // join by code
  const check = await me.attempt('validate the group code', () => me.validateGroupCode(s.joinCode));
  me.note(`validate_group_code → ${JSON.stringify(check)}`);
  const joined = await me.attempt('join the group', () => me.joinGroupByCode(s.joinCode));
  me.note(`join → ${JSON.stringify(joined)}`);
  await me.expectRefusal('INVALID_CODE', 'join with a wrong code', () => me.joinGroupByCode('ZZZZZZ'));

  // membership right after the first join — canonical id, and the "before" snapshot
  const myMembership = await me.attempt('read my membership row', () =>
    me.table('group_memberships', 'select-own', (q) => q.select('id, joined_at, left_at').eq('student_id', me.userId).eq('group_id', s.groupId).is('left_at', null).maybeSingle()));
  const membershipId = myMembership && myMembership.id;
  if (!membershipId) me.bug({ did: 'read my own membership row after joining', expected: 'one active row', got: JSON.stringify(myMembership), severity: 'wrong' });
  me.note(`membership before repeat join: ${membershipId || 'none'}`);

  // character quirk: join again with the same code. me.attempt already files a
  // [wrong] bug if this throws — the "errors" case is covered automatically.
  const secondJoin = await me.attempt('join the group again (expect same-group short-circuit)', () => me.joinGroupByCode(s.joinCode));
  me.note(`ikinci join → ${JSON.stringify(secondJoin)}`);

  const rowsAfter = await me.attempt('read membership rows after repeat join', () =>
    me.table('group_memberships', 'select-own', (q) => q.select('id, joined_at, left_at').eq('student_id', me.userId).eq('group_id', s.groupId).order('joined_at')));
  const activeAfter = (rowsAfter || []).filter((r) => !r.left_at);
  const sameMembership = !!membershipId && rowsAfter && rowsAfter.length === 1 && activeAfter.length === 1 && activeAfter[0].id === membershipId;
  if (!sameMembership) {
    me.bug({ did: 'repeat join_group_by_code with the same code', expected: 'same membership id, no new row, left_at still null', got: JSON.stringify({ before: membershipId, after: rowsAfter }), severity: 'wrong' });
  } else {
    me.note('Aynı üyelik. Sorun yok.');
  }

  // student code for the mentor
  let code = await me.attempt('read my student code', () => me.getMyStudentCode());
  code = Array.isArray(code) ? code[0] : code;
  if (!code) { const created = await me.attempt('create a student code', () => me.createStudentCode()); code = created; }
  const studentCode = code && (code.code || code.student_code);
  if (!studentCode) me.bug({ did: 'obtain a student code', expected: 'a 6-char code', got: JSON.stringify(code), severity: 'blocker' });
  writeAccount({ role: 'student', name: P.name, email: P.email, password: P.password, company: P.company, character: P.character, avatar: P.avatar, groupCode: s.joinCode, studentCode });

  // stream — terse: read, vote, one short comment
  const feed = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  const kinds = (feed || []).map((p) => p.kind).sort();
  me.note(`Akış: ${kinds.length} gönderi.`);
  if (s.posts.pollId && s.posts.pollOptionIds[0]) await me.attempt('vote in the poll', () => me.voteFeedPoll(s.posts.pollId, s.posts.pollOptionIds[0]));
  await me.attempt('like the announcement', () => me.likePost(s.posts.announcementId));
  await me.attempt('comment on the announcement', () => me.addComment(s.posts.announcementId, 'Tamam.'));
  await me.attempt('read my notifications', () => me.listNotifications());
  await me.attempt('read my progress', () => me.getCompetencyProgress(me.userId));

  state.merge((st) => { st.students = st.students || {}; st.students[P.slug] = { userId: me.userId, studentCode, membershipId }; });
  me.note('Bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
