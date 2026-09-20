// Phase 6 — Mert follows up. Character: over-confident (task-7-brief.md,
// task-9-brief.md Step 2). Gamze approved all four of his tasks at level 1
// while he rated himself 3 on every one. Mert messages nobody (established
// in phase 4) — he does not write to his mentor. Instead he reads the
// comparison, reads her notes on each submission, and vents in the log only.
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('mert-yilmaz');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();

  // Re-read my tasks to see Gamze's per-submission mentor_level / mentor_note
  // (assignment_submissions(*) embed — see student-followup-common.md).
  const tasks = await me.attempt('read my tasks (to see mentor levels and notes)', () => me.listMyAssignments());
  const reviewed = [];
  for (const t of (tasks || [])) {
    const sub = (t.assignment_submissions || []).find((x) => x.student_id === me.userId && x.status === 'approved');
    if (sub) reviewed.push({ title: t.title, selfLevel: sub.self_level, mentorLevel: sub.mentor_level, mentorNote: sub.mentor_note });
  }
  if (reviewed.length) {
    me.note(`Onaylanan ${reviewed.length} görevimin hepsinde mentor_level 1, ama ben hepsine self_level 3 vermiştim: ${JSON.stringify(reviewed.map((r) => ({ title: r.title, self: r.selfLevel, mentor: r.mentorLevel })))}`);
    for (const r of reviewed) me.note(`Gamze'nin notu ("${r.title}"): "${r.mentorNote}"`);
  } else {
    me.bug({ did: 'find my four approved submissions with mentor levels', expected: '4 approved submissions with mentor_level set', got: `${reviewed.length} found`, severity: 'wrong' });
  }

  // The comparison itself: gap = avgMentor - avgSelf, expected -2 on every
  // competency that has one of my approved+rated tasks; overRated should be true.
  const cmp = await me.attempt('read self vs mentor comparison', () => me.competencySelfVsMentor(me.userId));
  if (cmp && cmp.length) {
    for (const row of cmp) {
      me.note(`Karşılaştırma — ${row.name}: avgSelf ${row.avgSelf}, avgMentor ${row.avgMentor}, gap ${row.gap}, overRated ${row.overRated}, tasks ${row.tasks}.`);
      if (row.gap !== -2 || row.overRated !== true) {
        me.bug({ did: `check gap/overRated for competency "${row.name}"`, expected: 'gap -2, overRated true (mentor rated 1, I rated 3 on every reviewed task here)', got: `gap ${row.gap}, overRated ${row.overRated}`, severity: 'wrong' });
      }
    }
    me.note('Dört görevimin hepsine mentor seviye 1 verdi, ben 3 demiştim — itiraf: biraz canım sıkıldı. Gamze\'nin notunda "adımların çoğunda yönlendirme gerekti" diyor; haklı olabilir ama bunu daha en baştan, görev sırasında söyleseydi keşke. Yine de saygılıyım, bir şey yazmayacağım — sadece bir sonraki görevde daha dikkatli değerlendireceğim kendimi.');
  } else {
    me.bug({ did: 'read competency_self_vs_mentor for my four approved tasks', expected: 'at least one row with gap -2', got: cmp ? 'empty array' : 'no data', severity: 'wrong' });
  }

  // Mert messages nobody — explicit in character (see phase 4). No message is sent.
  me.note('Mesajlaşma: yine kimseye mesaj yok (karakter gereği) — sadece günlüğe not düştüm, mentoruma yazmadım.');

  // Shared tail.
  await me.attempt('read competency progress', () => me.getCompetencyProgress(me.userId));
  await me.attempt('read working KPIs', () => me.getWorkingKpis(me.userId));
  await me.attempt('read the leaderboard', () => me.getMyGroupLeaderboard(10));

  const feed = await me.attempt('read the stream (my four approved tasks should now be cards)', () => me.listFeedPosts(s.groupId));
  if (feed) {
    const mine = (s.students[P.slug].submissions || []).map((x) => x.assignmentId);
    const myCards = feed.filter((p) => p.kind === 'task' && p.authorId === me.userId);
    me.note(`Akışta kind sayımı: ${JSON.stringify(feed.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] || 0) + 1; return acc; }, {}))}; kendi task kartlarım: ${myCards.length}/${mine.length}.`);
    if (myCards.length < mine.length) {
      me.bug({ did: 'find a stream card for each of my 4 approved tasks', expected: '4 task-kind posts authored by me', got: `${myCards.length} found (kinds seen: ${JSON.stringify(feed.map((p) => p.kind))})`, severity: 'wrong' });
    }
  }

  await me.attempt('read notifications', () => me.listNotifications());
  const convs = await me.attempt('read conversations', () => me.listConversations(s.groupId));
  for (const c of (convs || [])) {
    await me.attempt('read messages', () => me.listMessages(c.id));
    await me.attempt('mark read', () => me.markConversationRead(c.id));
  }

  state.merge((st) => { st.students[P.slug].followUp = { reviewedCount: reviewed.length, comparisonRows: (cmp || []).length, streamCards: (feed || []).filter((p) => p.kind === 'task' && p.authorId === me.userId).length }; });
  me.note('Faz 6 bitti. Sonuç canımı sıktı ama kimseye yazmadım, sadece kendime not aldım.');
})().catch((e) => { console.error(e); process.exit(1); });
