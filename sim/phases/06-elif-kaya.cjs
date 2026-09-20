// Phase 6 — Elif follows up: shared tail plus reading her approval notes
// against her own self levels, checking the leaderboard for her rank, and
// confirming a task_approved notification exists per approval (4 expected).
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('elif-kaya');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();

  // Extra: read Hakan's approval notes on the four tasks — self level vs his.
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  const mine = s.students[P.slug];
  const pairs = [];
  for (const t of (tasks || [])) {
    const sub = (t.assignment_submissions || []).find((x) => x.student_id === me.userId && x.status === 'approved');
    if (sub) pairs.push({ title: t.title, selfLevel: sub.self_level, mentorLevel: sub.mentor_level, mentorNote: sub.mentor_note });
  }
  if (pairs.length !== 4) me.bug({ did: 'find 4 approved tasks with mentor levels', expected: '4', got: `${pairs.length}: ${JSON.stringify(pairs)}`, severity: 'wrong' });
  const bumped = pairs.filter((p) => p.mentorLevel === p.selfLevel + 1);
  if (bumped.length < 1) me.bug({ did: 'find a task where Hakan rated one level above my self level', expected: 'at least one pair with mentorLevel = selfLevel + 1', got: JSON.stringify(pairs), severity: 'wrong' });
  for (const p of pairs) me.note(`"${p.title}": kendi seviyem ${p.selfLevel}, Hakan Hoca'nın verdiği ${p.mentorLevel} — notu: "${p.mentorNote}"`);
  me.note(bumped.length ? `Hakan Hoca en az bir görevde (${bumped.map((b) => b.title).join(', ')}) beni kendi değerlendirdiğimden bir seviye üstte gördü — gurur verici.` : 'Hiçbir görevde seviyem yükseltilmemiş.');

  // shared tail
  const selfVsMentor = await me.attempt('read self vs mentor', () => me.competencySelfVsMentor(me.userId));
  await me.attempt('read competency progress', () => me.getCompetencyProgress(me.userId));
  await me.attempt('read working KPIs', () => me.getWorkingKpis(me.userId));
  const board = await me.attempt('read the leaderboard', () => me.getMyGroupLeaderboard(10));
  const myRank = (board || []).findIndex((row) => row.student_id === me.userId || row.user_id === me.userId);
  if (board && myRank === -1) me.bug({ did: 'find myself on the leaderboard', expected: 'a row for me', got: JSON.stringify(board), severity: 'wrong' });
  else if (board) me.note(`Sınıf lider tablosunda ${myRank + 1}. sıradayım (${board.length} kişi arasında).`);

  const feed = await me.attempt('read the stream (approved tasks should now be cards)', () => me.listFeedPosts(s.groupId));
  const myTaskCards = (feed || []).filter((p) => p.kind === 'task' && pairs.some((pr) => pr.title === (p.task && p.task.title)));
  if (pairs.length && myTaskCards.length === 0) me.bug({ did: 'find a stream card for my approved tasks', expected: 'a task post per approved+shared submission', got: `kinds/titles seen: ${JSON.stringify((feed || []).map((p) => ({ kind: p.kind, title: p.task && p.task.title })))}`, severity: 'wrong' });
  else me.note(`Akışta ${myTaskCards.length} görev kartım var.`);

  const notifs = await me.attempt('read notifications', () => me.listNotifications());
  const approvedNotifs = (notifs || []).filter((n) => n.type === 'task_approved');
  if (approvedNotifs.length < 4) me.bug({ did: 'find a task_approved notification per approval', expected: '4', got: `${approvedNotifs.length} found among ${(notifs || []).length} notifications: ${JSON.stringify((notifs || []).map((n) => n.type))}`, severity: 'wrong' });
  else me.note(`4 onay için ${approvedNotifs.length} adet "task_approved" bildirimi var.`);

  const convs = await me.attempt('read conversations', () => me.listConversations(s.groupId));
  for (const c of (convs || [])) { await me.attempt('read messages', () => me.listMessages(c.id)); await me.attempt('mark read', () => me.markConversationRead(c.id)); }

  state.merge((st) => { Object.assign(st.students[P.slug], { followUp: { pairs, myRank: myRank === -1 ? null : myRank + 1, boardSize: (board || []).length, approvedNotifCount: approvedNotifs.length, streamCards: myTaskCards.length, selfVsMentorRows: (selfVsMentor || []).length } }); });
  me.note('Faz 6 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
