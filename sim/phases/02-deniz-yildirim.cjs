// Phase 2 — Deniz Yıldırım joins. Adapted from sim/phases/02-elif-kaya.cjs
// (see that file's header for the shared adaptations: --resume, the
// validate_group_code/join_group_by_code array shape, the membership
// read-back, get_my_student_code's array shape).
//
// Deniz's differences (task-5-brief.md Step 3 / task brief for this agent):
//  1. Fills the internship form FIRST with internship_end_date BEFORE
//     internship_start_date (end = daysAgoIso(6), start = todayIso()) and
//     records what happens — refused, or accepted silently (then files
//     [rough]: the form takes an inverted period; a later
//     internship_open_day would raise ID_SETUP, per
//     docs/internship-days-migration.sql's
//     `sp.internship_end_date < sp.internship_start_date THEN RAISE
//     EXCEPTION 'ID_SETUP'` check — that RPC is retired/out of scope here,
//     so this is a recorded prediction, not an executed call).
//  2. Then fixes the dates (start = daysAgoIso(6), end = todayIso()) with a
//     second upsert.
//  3. In the stream: likes the announcement AND the poll, then unlikes the
//     poll, then votes. Character: absent one day (excused), likes but
//     rarely posts — no comments, no messaging.
const { Actor, daysAgoIso, todayIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('deniz-yildirim');
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

  // internship form — FIRST with an inverted period (end before start)
  const inverted = { university: 'Boğaziçi Üniversitesi', faculty: 'Mühendislik Fakültesi', department: 'Çevre Mühendisliği', department_branch: '',
    student_id: '21045678', company_name: P.company, company_address: 'Kemerburgaz, İstanbul', company_sector: 'Katı atık geri dönüşüm',
    internship_start_date: todayIso(), internship_end_date: daysAgoIso(6) };
  let invertedResult; let invertedRefused = false;
  try {
    invertedResult = await me.upsertStudentProfile(inverted);
    me.note(`inverted-period upsert (end ${inverted.internship_end_date} before start ${inverted.internship_start_date}) → accepted silently: ${JSON.stringify(invertedResult)}`);
    me.bug({ did: 'fill the internship form with internship_end_date before internship_start_date', expected: 'refusal or a validation error (an internship cannot end before it starts)',
      got: `accepted silently — row written with start=${inverted.internship_start_date}, end=${inverted.internship_end_date}; a later internship_open_day call would raise ID_SETUP per docs/internship-days-migration.sql (sp.internship_end_date < sp.internship_start_date), but nothing at write time stops it`,
      severity: 'rough' });
  } catch (e) {
    invertedRefused = true;
    me.note(`inverted-period upsert refused: ${e.message}`);
  }

  // THEN fix the dates
  const fixed = { ...inverted, internship_start_date: daysAgoIso(6), internship_end_date: todayIso() };
  await me.attempt('fix the internship form dates (start before end)', () => me.upsertStudentProfile(fixed));

  // join by code
  const check = await me.attempt('validate the group code', () => me.validateGroupCode(s.joinCode));
  me.note(`validate_group_code → ${JSON.stringify(check)}`);
  const joined = await me.attempt('join the group', () => me.joinGroupByCode(s.joinCode));
  me.note(`join_group_by_code → ${JSON.stringify(joined)}`);
  await me.expectRefusal('INVALID_CODE', 'join with a wrong code', () => me.joinGroupByCode('ZZZZZZ'));

  // the RPC does not return a membership id; read it back directly
  const myMembership = await me.attempt('read my own membership row', () =>
    me.table('group_memberships', 'select-own', (q) => q.select('id, joined_at').eq('student_id', me.userId).eq('group_id', s.groupId).is('left_at', null).maybeSingle()));
  const membershipId = myMembership && myMembership.id;
  if (!membershipId) me.bug({ did: 'read my own membership row after joining', expected: 'one active row', got: JSON.stringify(myMembership), severity: 'wrong' });

  // student code for the mentor
  let code = await me.attempt('read my student code', () => me.getMyStudentCode());
  code = Array.isArray(code) ? code[0] : code;
  if (!code) { const created = await me.attempt('create a student code', () => me.createStudentCode()); code = created; }
  const studentCode = code && (code.code || code.student_code);
  if (!studentCode) me.bug({ did: 'obtain a student code', expected: 'a 6-char code', got: JSON.stringify(code), severity: 'blocker' });
  writeAccount({ role: 'student', name: P.name, email: P.email, password: P.password, company: P.company, character: P.character, avatar: P.avatar, groupCode: s.joinCode, studentCode });

  // stream: likes but rarely posts — likes the announcement and the poll, unlikes the poll, votes; no comments
  const feed = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  const kinds = (feed || []).map((p) => p.kind).sort();
  me.note(`Akışta ${kinds.length} gönderi: ${kinds.join(', ')} (6 görev kartı + duyuru + anket beklenir)`);
  await me.attempt('like the announcement', () => me.likePost(s.posts.announcementId));
  await me.attempt('like the poll', () => me.likePost(s.posts.pollId));
  await me.attempt('unlike the poll', () => me.unlikePost(s.posts.pollId));
  if (s.posts.pollId && s.posts.pollOptionIds[0]) await me.attempt('vote in the poll', () => me.voteFeedPoll(s.posts.pollId, s.posts.pollOptionIds[0]));
  await me.attempt('read my notifications', () => me.listNotifications());
  await me.attempt('read my progress (should be all zero)', () => me.getCompetencyProgress(me.userId));

  state.merge((st) => { st.students = st.students || {}; st.students[P.slug] = { userId: me.userId, studentCode, membershipId }; });
  me.note(`Faz 2 bitti. Inverted-period form ${invertedRefused ? 'was refused (unexpected)' : 'was accepted silently — filed [rough]'}.`);
})().catch((e) => { console.error(e); process.exit(1); });
