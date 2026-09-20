// Phase 6 — Burak follows up: answers Ayça's revision, probes ALREADY_APPROVED,
// runs the shared tail, and replies to Elif once more.
// Per task-9-brief.md Step 1 (script given verbatim) + "Also: reply to Elif once
// more in your conversation" from the dispatch.
const { Actor, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('burak-sahin');
(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  const returned = (tasks || []).find((t) => (t.assignment_submissions || []).some((x) => x.status === 'needs_revision'));
  if (!returned) me.bug({ did: 'find the returned task', expected: 'one needs_revision submission', got: 'none', severity: 'wrong' });
  else {
    const sub = (returned.assignment_submissions || []).find((x) => x.status === 'needs_revision');
    me.note(`Ayça sent back "${returned.title}" with mentor_note: "${sub && sub.mentor_note}".`);
    const photo = await me.attempt('upload the missing table as a photo', () => me.uploadPhoto(returned.id));
    await me.attempt('resubmit with the uncertainty column', () => me.submitAssignment(returned.id, 'Ölçüm belirsizliği sütununu ekledim.', 'Belirsizliği hesaplamadan tablo eksik sayılıyormuş.', photo ? [{ uri: photo, caption: 'Güncel tablo' }] : [], [], 1));
  }
  const approved = (tasks || []).find((t) => (t.assignment_submissions || []).some((x) => x.status === 'approved'));
  if (approved) await me.expectRefusal('ALREADY_APPROVED', 'submit an approved task again', () => me.submitAssignment(approved.id, 'x', 'y', [], [], 2));
  // shared tail
  await me.attempt('read self vs mentor', () => me.competencySelfVsMentor(me.userId));
  await me.attempt('read competency progress', () => me.getCompetencyProgress(me.userId));
  await me.attempt('read working KPIs', () => me.getWorkingKpis(me.userId));
  await me.attempt('read the leaderboard', () => me.getMyGroupLeaderboard(10));
  const feed = await me.attempt('read the stream (approved tasks should now be cards)', () => me.listFeedPosts(s.groupId));
  const mine = s.students[P.slug] || {};
  const approvedTitles = (tasks || []).filter((t) => (t.assignment_submissions || []).some((x) => x.status === 'approved')).map((t) => t.title);
  const taskCards = (feed || []).filter((p) => p.kind === 'task');
  if (taskCards[0]) me.note(`sample task-card row (once, to see its shape): ${JSON.stringify(taskCards[0])}`);
  const missingTitles = approvedTitles.filter((title) => !taskCards.some((p) => JSON.stringify(p).includes(title)));
  me.note(`stream has ${taskCards.length} task card(s) total; ${approvedTitles.length - missingTitles.length}/${approvedTitles.length} of my approved tasks found among them.`);
  if (missingTitles.length > 0) {
    me.bug({ did: `find a stream card for my approved task(s): ${missingTitles.join(', ')}`, expected: 'a task post for each', got: `${taskCards.length} task cards among ${(feed || []).length} posts (kinds: ${[...new Set((feed || []).map((p) => p.kind))].join(', ')})`, severity: 'wrong' });
  }
  await me.attempt('read notifications', () => me.listNotifications());
  const convs = await me.attempt('read conversations', () => me.listConversations(s.groupId));
  for (const c of (convs || [])) {
    const messages = await me.attempt('read messages', () => me.listMessages(c.id));
    if (c.id === (mine.conversations && mine.conversations.classmate)) {
      const elifId = s.students['elif-kaya'] && s.students['elif-kaya'].userId;
      const fromElif = (messages || []).filter((m) => m.senderId === elifId).slice(-1)[0];
      if (fromElif) me.note(`Elif's latest: "${fromElif.body}"`);
      await me.attempt('reply to Elif once more', () => me.sendMessage(c.id, 'Elif, beşini de yolladım demin, biri düzeltmeden geri geldi ama onu da hallettim. Kolay gelsin, umarım seninkiler tek seferde geçer :)'));
    }
    await me.attempt('mark read', () => me.markConversationRead(c.id));
  }
  me.note('Faz 6 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
