// Phase 2 — Mert Yılmaz joins. Adapted from the template (sim/phases/02-elif-kaya.cjs).
//
// Adaptations carried over from the template (see task-5a-report.md for detail):
//  1. --resume flag: a crash mid-way is recovered by signing in instead of signing up again.
//  2. validate_group_code / join_group_by_code are RETURNS TABLE(...) — PostgREST returns
//     an array of rows, not a single object; join_group_by_code's row is the GROUP's id,
//     not a membership id, so the real membership id is read back from group_memberships.
//  3. get_my_student_code is also RETURNS TABLE(code TEXT) — an array, empty when no code
//     exists yet.
//
// Character difference for this phase (over-confident): votes in the poll, then votes
// again for a DIFFERENT option — a change of vote, which vote_feed_poll implements as
// an upsert (ON CONFLICT (post_id, user_id) DO UPDATE ... SET option_id) so it must
// succeed and must not create a second vote row. The stream is re-read afterwards to
// confirm the poll row now shows the new option as myOptionId, that the option vote
// counts still sum to totalVotes (internal consistency, always checkable), and — best
// effort, since other students' phase-2 scripts may run concurrently — that totalVotes
// only grew by one voter (mine), not two, across my own vote-then-change. Then he
// comments on the poll and likes the announcement.
const { Actor, daysAgoIso, todayIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('mert-yilmaz');
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
    university: 'Dokuz Eylül Üniversitesi', faculty: 'Mühendislik Fakültesi', department: 'Çevre Mühendisliği', department_branch: '',
    student_id: '21056789', company_name: P.company, company_address: 'Gaziemir, İzmir', company_sector: 'Katı atık yönetimi',
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

  // stream: read, vote, CHANGE the vote to a different option, verify, comment on
  // the poll, like the announcement — over-confident: sure of himself, votes fast,
  // then changes his mind and is sure THAT was right too.
  const feed = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  const kinds = (feed || []).map((p) => p.kind).sort();
  me.note(`Akışta ${kinds.length} gönderi: ${kinds.join(', ')} (6 görev kartı + duyuru + anket beklenir)`);
  const pollBefore = (feed || []).find((p) => p.id === s.posts.pollId);
  const totalBefore = pollBefore && pollBefore.poll ? pollBefore.poll.totalVotes : undefined;
  me.note(`Oy vermeden önce anket: totalVotes=${totalBefore}, myOptionId=${pollBefore && pollBefore.poll && pollBefore.poll.myOptionId}`);

  if (s.posts.pollId && s.posts.pollOptionIds[0]) {
    const firstOptionId = s.posts.pollOptionIds[0];
    const secondOptionId = s.posts.pollOptionIds.find((id) => id !== firstOptionId) || s.posts.pollOptionIds[1];
    await me.attempt('vote in the poll', () => me.voteFeedPoll(s.posts.pollId, firstOptionId));
    me.note(`İlk oy: ${firstOptionId}. Emin ama fikrini değiştiriyor.`);
    await me.attempt('change my vote to a different option', () => me.voteFeedPoll(s.posts.pollId, secondOptionId));
    me.note(`Oy değiştirildi: ${secondOptionId}.`);

    const feedAfter = await me.attempt('re-read the stream after changing my vote', () => me.listFeedPosts(s.groupId));
    const pollAfter = (feedAfter || []).find((p) => p.id === s.posts.pollId);
    const poll = pollAfter && pollAfter.poll;
    me.note(`Oy değiştirdikten sonra anket: ${JSON.stringify(poll)}`);

    if (!poll || poll.myOptionId !== secondOptionId) {
      me.bug({ did: 'confirm the changed vote shows as myOptionId after re-reading the stream',
        expected: `myOptionId = ${secondOptionId}`, got: JSON.stringify(poll), severity: 'wrong' });
    } else {
      me.note('myOptionId doğru şekilde yeni seçeneği gösteriyor.');
    }

    const sumVotes = poll ? poll.options.reduce((a, o) => a + o.votes, 0) : undefined;
    if (poll && sumVotes !== poll.totalVotes) {
      me.bug({ did: 'check that poll option vote counts sum to totalVotes after changing my vote',
        expected: `sum of options.votes (${sumVotes}) === totalVotes`, got: `totalVotes=${poll.totalVotes}, options=${JSON.stringify(poll.options)}`, severity: 'wrong' });
    } else if (poll) {
      me.note(`Toplamlar tutarlı: options toplamı = totalVotes = ${poll.totalVotes}.`);
    }

    if (typeof totalBefore === 'number' && poll && poll.totalVotes !== totalBefore + 1) {
      // Best-effort: other students' phase-2 scripts may vote concurrently, which
      // would also move this number. Only filed as a real bug when combined with
      // the sum-consistency check above also failing (a genuine double-count),
      // otherwise noted as inconclusive because of the parallel run.
      if (sumVotes !== poll.totalVotes) {
        me.bug({ did: 'confirm a changed vote is not double-counted (voter count should rise by exactly one, mine)',
          expected: `totalVotes = ${totalBefore + 1} (before ${totalBefore} + my one vote)`, got: `totalVotes=${poll.totalVotes}`, severity: 'wrong' });
      } else {
        me.note(`totalVotes ${totalBefore} → ${poll.totalVotes}, beklenen ${totalBefore + 1} değil ama options toplamı tutarlı; paralel çalışan diğer öğrenci scriptleri de aynı ankete oy vermiş olabilir, bu yüzden kesin hata olarak işaretlenmedi.`);
      }
    }

    await me.attempt('comment on the poll', () => me.addComment(s.posts.pollId, 'Bence rapor yazımı, gerisi zaten sahada öğreniliyor.'));
  }
  await me.attempt('like the announcement', () => me.likePost(s.posts.announcementId));
  await me.attempt('read my notifications', () => me.listNotifications());
  await me.attempt('read my progress (should be all zero)', () => me.getCompetencyProgress(me.userId));

  state.merge((st) => { st.students = st.students || {}; st.students[P.slug] = { userId: me.userId, studentCode, membershipId }; });
  me.note('Faz 2 bitti. Emin: kendini her konuda 3 (bağımsız) olarak değerlendirecek — mentor katılmayacak.');
})().catch((e) => { console.error(e); process.exit(1); });
