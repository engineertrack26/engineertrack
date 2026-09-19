// Phase 2 — Burak Şahin joins. Adapted from sim/phases/02-elif-kaya.cjs (template).
//
// Character (task-5-brief.md Step 3): late, last-minute intern.
//  - Signs up LAST: `await sleep(4000)` before signUp, so his account lands
//    after the others in a parallel run.
//  - Fills the internship form with a `student_id` that has a TRAILING
//    SPACE ('21023456 '), then reads the student_profiles row back to see
//    whether the app/DB trimmed it. Files `[rough]` if not.
//  - Does NOT vote in the poll. Likes nothing.
//  - Otherwise follows the template: validate + join, wrong-code refusal,
//    student code, read the stream, read notifications, read progress.
//
// Same adaptations as the template (see its header comment for detail):
//  1. --resume flag for recovery after a crash (signIn instead of signUp).
//  2. validate_group_code / join_group_by_code return an ARRAY of rows
//     (RETURNS TABLE); join_group_by_code's row has no membershipId — the
//     membership id is read back directly from group_memberships.
//  3. get_my_student_code is also RETURNS TABLE — an array, [] when none.
const { Actor, daysAgoIso, todayIso, sleep } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('burak-sahin');
const RESUME = process.argv.includes('--resume');

(async () => {
  const me = new Actor(P);
  const s = state.read();

  if (!RESUME) {
    me.note('Son anda yetişiyor: sign-up öncesi 4 sn bekleme (karakter gereği, en son katılan o).');
    await sleep(4000);
  }
  if (RESUME) {
    await me.signIn(P.email, P.password);
    me.note('Resumed with sign-in (--resume): a previous run crashed mid-way.');
  } else {
    await me.signUp({ email: P.email, password: P.password, firstName: P.firstName, lastName: P.lastName, role: 'student', avatarId: P.avatar });
  }
  writeAccount({ role: 'student', name: P.name, email: P.email, password: P.password, company: P.company, character: P.character, avatar: P.avatar, groupCode: s.joinCode });
  await me.attempt('confirm the avatar from the profile', () => me.rpc('my_student_avatar'));

  // internship form — deliberately submits student_id with a trailing space
  const trailingSpaceId = '21023456 ';
  await me.attempt('fill the internship form', () => me.upsertStudentProfile({
    university: 'Ege Üniversitesi', faculty: 'Mühendislik Fakültesi', department: 'Çevre Mühendisliği', department_branch: '',
    student_id: trailingSpaceId, company_name: P.company, company_address: 'Bornova, İzmir', company_sector: 'ÇED ve izin danışmanlığı',
    internship_start_date: daysAgoIso(6), internship_end_date: todayIso() }));

  // read the row back to see whether the trailing space survived
  const profileRow = await me.attempt('read my student_profiles row back', () =>
    me.table('student_profiles', 'select-own', (q) => q.select('student_id').eq('id', me.userId).maybeSingle()));
  const readBackId = profileRow && profileRow.student_id;
  me.note(`student_id gönderildi: '${trailingSpaceId}' (sonda boşluk) → geri okunan: '${readBackId}'`);
  if (readBackId === trailingSpaceId) {
    me.bug({ did: "submit student_id '21023456 ' (trailing space) and read student_profiles back", expected: "trimmed to '21023456', or at least not stored/shown with a stray trailing space", got: `stored verbatim as '${readBackId}'`, severity: 'rough' });
  } else if (readBackId === trailingSpaceId.trim()) {
    me.note('Sondaki boşluk kırpıldı (trim edilmiş) — form ya da veritabanı düzeltmiş, sorun yok.');
  } else {
    me.note(`Beklenmeyen değer okundu, ne gönderilenle ne de trim edilmiş haliyle eşleşiyor: '${readBackId}'`);
  }

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

  // stream: read only — Burak does not vote, does not like anything (in character: rushed, barely keeping up)
  const feed = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  const kinds = (feed || []).map((p) => p.kind).sort();
  me.note(`Akışta ${kinds.length} gönderi: ${kinds.join(', ')} (6 görev kartı + duyuru + anket beklenir). Ankete oy vermiyor, hiçbir şeyi beğenmiyor — yetişmeye çalışıyor.`);
  await me.attempt('read my notifications', () => me.listNotifications());
  await me.attempt('read my progress (should be all zero)', () => me.getCompetencyProgress(me.userId));

  state.merge((st) => { st.students = st.students || {}; st.students[P.slug] = { userId: me.userId, studentCode, membershipId }; });
  me.note('Faz 2 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
