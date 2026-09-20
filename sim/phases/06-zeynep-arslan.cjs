// Phase 6 — Zeynep follows up. Terse, in character (Step 2 of the task-9 brief).
// Extra beyond the shared tail: all three tasks approved by Murat; the
// photo-only submission had share_to_feed = false since phase 4 — confirm
// the stream reflects that, flip sharing on, confirm a card appears, flip
// it back off, confirm the card (and its comments) are gone.
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('zeynep-arslan');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const mine = s.students[P.slug];
  const subs = mine.submissions || [];
  const hidden = subs[1]; // photo-only, share_to_feed = false since phase 4
  const shownIds = [subs[0], subs[2]].filter(Boolean).map((x) => x.submissionId);

  const findCard = (posts, submissionId) => (posts || []).find((p) => p.kind === 'task' && p.task && p.task.submissionId === submissionId);

  let posts = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  let sharingOnWorked = null;
  let sharingOffWorked = null;

  for (const id of shownIds) {
    const card = findCard(posts, id);
    if (!card) me.bug({ did: `find a stream card for my approved task (submission ${id})`, expected: 'a task post', got: `kinds/titles seen: ${(posts || []).map((p) => `${p.kind}:${p.task ? p.task.title : p.body}`).join(' | ')}`, severity: 'wrong' });
    else me.note(`card present for shown submission ${id}: post ${card.id}.`);
  }

  if (hidden) {
    const hiddenCard = findCard(posts, hidden.submissionId);
    if (hiddenCard) me.bug({ did: 'confirm the hidden (share_to_feed=false) submission has no stream card', expected: 'no card', got: `card ${hiddenCard.id} found`, severity: 'wrong' });
    else me.note(`no card for hidden submission ${hidden.submissionId}, as expected.`);

    await me.attempt('turn sharing back on for the hidden task', () => me.setSubmissionSharing(hidden.submissionId, true));
    posts = await me.attempt('re-read the stream after turning sharing on', () => me.listFeedPosts(s.groupId));
    const nowCard = findCard(posts, hidden.submissionId);
    if (!nowCard) { sharingOnWorked = false; me.bug({ did: 'find a stream card after turning sharing back on', expected: 'a task post to appear', got: `kinds/titles seen: ${(posts || []).map((p) => `${p.kind}:${p.task ? p.task.title : p.body}`).join(' | ')}`, severity: 'wrong' }); }
    else { sharingOnWorked = true; me.note(`card appeared after re-sharing: post ${nowCard.id}.`); }

    await me.attempt('turn sharing off again for the same task', () => me.setSubmissionSharing(hidden.submissionId, false));
    posts = await me.attempt('re-read the stream after turning sharing off again', () => me.listFeedPosts(s.groupId));
    const goneCard = findCard(posts, hidden.submissionId);
    if (goneCard) { sharingOffWorked = false; me.bug({ did: 'confirm the card disappears after turning sharing off again', expected: 'no card (post deleted with its comments)', got: `card ${goneCard.id} still present`, severity: 'wrong' }); }
    else { sharingOffWorked = true; me.note('card disappeared after turning sharing off again, as expected.'); }
  } else {
    me.note('no hidden (photo-only) submission id in state — skipped the sharing toggle probe.');
  }

  // shared tail
  await me.attempt('read self vs mentor', () => me.competencySelfVsMentor(me.userId));
  await me.attempt('read competency progress', () => me.getCompetencyProgress(me.userId));
  await me.attempt('read working KPIs', () => me.getWorkingKpis(me.userId));
  await me.attempt('read the leaderboard', () => me.getMyGroupLeaderboard(10));
  await me.attempt('read notifications', () => me.listNotifications());
  const convs = await me.attempt('read conversations', () => me.listConversations(s.groupId));
  for (const c of (convs || [])) { await me.attempt('read messages', () => me.listMessages(c.id)); await me.attempt('mark read', () => me.markConversationRead(c.id)); }

  state.merge((st) => { st.students[P.slug].followUp = { sharingOnWorked, sharingOffWorked }; });
  me.note('Faz 6 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
