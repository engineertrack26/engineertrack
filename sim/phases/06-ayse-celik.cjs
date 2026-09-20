// Phase 6 — Ayşe follows up: shared tail only (task-9-brief.md Step 2: "Ayşe only
// the tail"). Quiet character — no messages, no comments, no likes. Three of her
// four submissions are approved (mentor Emre); the fourth is left `submitted` on
// purpose (mentor_review_pending finding from phase 5) — this script does not
// touch it: no resubmission, no refusal probe against it.
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('ayse-celik');
(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const mine = s.students[P.slug] || {};

  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  const approvedTitles = (tasks || []).filter((t) => (t.assignment_submissions || []).some((x) => x.status === 'approved')).map((t) => t.title);
  const pending = (tasks || []).filter((t) => (t.assignment_submissions || []).some((x) => x.status === 'submitted'));
  if (pending.length) me.note(`leaving "${pending.map((t) => t.title).join(', ')}" untouched — mentor Emre left it pending on purpose (phase 5), no resubmission or refusal probe.`);

  // shared tail
  await me.attempt('read self vs mentor', () => me.competencySelfVsMentor(me.userId));
  await me.attempt('read competency progress', () => me.getCompetencyProgress(me.userId));
  await me.attempt('read working KPIs', () => me.getWorkingKpis(me.userId));
  await me.attempt('read the leaderboard', () => me.getMyGroupLeaderboard(10));
  const feed = await me.attempt('read the stream (approved tasks should now be cards)', () => me.listFeedPosts(s.groupId));
  const taskCards = (feed || []).filter((p) => p.kind === 'task');
  if (taskCards[0]) me.note(`sample task-card row (once, to see its shape): ${JSON.stringify(taskCards[0])}`);
  const missingTitles = approvedTitles.filter((title) => !taskCards.some((p) => JSON.stringify(p).includes(title)));
  me.note(`stream has ${taskCards.length} task card(s) total; ${approvedTitles.length - missingTitles.length}/${approvedTitles.length} of my approved tasks found among them.`);
  if (missingTitles.length > 0) {
    me.bug({ did: `find a stream card for my approved task(s): ${missingTitles.join(', ')}`, expected: 'a task post for each', got: `${taskCards.length} task cards among ${(feed || []).length} posts (kinds: ${[...new Set((feed || []).map((p) => p.kind))].join(', ')})`, severity: 'wrong' });
  }

  const notifications = await me.attempt('read notifications', () => me.listNotifications());
  const approvalNotifs = (notifications || []).filter((n) => n.type === 'task_approved');
  if (approvedTitles.length > 0 && approvalNotifs.length === 0) {
    me.bug({ did: 'find a task_approved notification for my approved submissions', expected: 'at least one task_approved notification', got: `${(notifications || []).length} notification(s), types: ${[...new Set((notifications || []).map((n) => n.type))].join(', ')}`, severity: 'wrong' });
  }

  const convs = await me.attempt('read conversations', () => me.listConversations(s.groupId));
  for (const c of (convs || [])) {
    await me.attempt('read messages', () => me.listMessages(c.id));
    await me.attempt('mark read', () => me.markConversationRead(c.id));
  }

  state.merge((st) => { st.students[P.slug].followUp = { approvedTitles, taskCardsFound: approvedTitles.length - missingTitles.length, approvalNotifs: approvalNotifs.length }; });
  me.note('Faz 6 bitti. Sessiz karakter: sadece ortak kuyruk çalıştırıldı, mesaj/yorum/beğeni yok.');
})().catch((e) => { console.error(e); process.exit(1); });
