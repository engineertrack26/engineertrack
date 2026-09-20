// Phase 6 — Can follows up. Shared tail (see student-followup-common.md) plus
// Can's extra: find a classmate's approved task card in the stream (kind
// 'task', author not Can), like it and comment a question, read the
// comments back with listComments to confirm his is there, read Selin
// Kurt's latest reply in his mentor conversation and answer it, and check
// the advisor conversation for a reply (none expected yet).
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('can-dogan');
(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const mine = s.students[P.slug] || {};
  const conversations = mine.conversations || {};

  // shared tail: approved tasks should now be cards in the stream.
  const stream = await me.attempt('read the stream (approved tasks should now be cards)', () => me.listFeedPosts(s.groupId));
  for (const sub of (mine.submissions || [])) {
    const card = (stream || []).find((post) => post.kind === 'task' && (post.submission_id === sub.submissionId || (post.submission && post.submission.id === sub.submissionId) || post.assignment_id === sub.assignmentId));
    if (!card) me.bug({ did: `find a stream card for my approved task (assignment ${sub.assignmentId})`, expected: 'a task post', got: `kinds/titles seen: ${JSON.stringify((stream || []).map((p) => ({ kind: p.kind, title: p.task && p.task.title })))}`, severity: 'wrong' });
  }

  // Can's delta: a classmate's approved task card — like it and ask a question.
  const classmateCard = (stream || []).find((post) => {
    if (post.kind !== 'task') return false;
    const authorId = post.student_id || post.studentId || post.author_id || (post.task && post.task.studentId) || (post.submission && post.submission.student_id);
    return authorId && authorId !== me.userId;
  });
  if (!classmateCard) {
    me.bug({ did: 'find a classmate\'s approved task card in the stream', expected: 'a kind: task post authored by someone other than me', got: `stream kinds/authors seen: ${JSON.stringify((stream || []).map((p) => ({ kind: p.kind, authorId: p.student_id || p.studentId || p.author_id })))}`, severity: 'wrong' });
  } else {
    me.note(`classmate task card found: ${JSON.stringify(classmateCard)}`);
    await me.attempt('like the classmate\'s task card', () => me.likePost(classmateCard.id));
    const questionBody = 'Elinize sağlık! Bu görevde numune alma sırasında karşılaştığınız en zor kısım neydi, biraz anlatır mısınız?';
    await me.attempt('comment a question on the classmate\'s task card', () => me.addComment(classmateCard.id, questionBody));
    const comments = await me.attempt('read the comments back', () => me.listComments(classmateCard.id));
    const mineComment = (comments || []).find((c) => (c.author_id === me.userId || c.authorId === me.userId) && c.body === questionBody);
    if (!mineComment) {
      me.bug({ did: 'confirm my comment appears in listComments(postId)', expected: 'my question comment in the list', got: `comments seen: ${JSON.stringify(comments)}`, severity: 'wrong' });
    } else {
      me.note('confirmed: my comment is in listComments for the card.');
    }
  }

  // Can's delta: read Selin Kurt's latest reply in the mentor conversation, and answer it.
  let mentorConv = conversations.mentor || (s.mentors && s.mentors['selin-kurt'] && s.mentors['selin-kurt'].conversationWithCan);
  if (!mentorConv) {
    me.bug({ did: 'find my recorded mentor conversation to read Selin Kurt\'s reply', expected: 'a recorded conversation id from phase 4', got: 'none in state.students[can-dogan].conversations.mentor or state.mentors[selin-kurt].conversationWithCan', severity: 'wrong' });
  } else {
    const mentorMessages = await me.attempt('read messages with my mentor', () => me.listMessages(mentorConv));
    const mentorUserId = s.mentors && s.mentors['selin-kurt'] && s.mentors['selin-kurt'].userId;
    const herMessages = (mentorMessages || []).filter((m) => (m.sender_id || m.senderId) === mentorUserId);
    const latest = herMessages[herMessages.length - 1];
    if (!latest) {
      me.bug({ did: 'find Selin Kurt\'s latest reply in our conversation', expected: 'at least one message from her', got: `messages seen: ${JSON.stringify(mentorMessages)}`, severity: 'wrong' });
    } else {
      me.note(`Selin Kurt's latest reply: ${JSON.stringify(latest)}`);
      const myMessages = (mentorMessages || []).filter((m) => (m.sender_id || m.senderId) === me.userId);
      const alreadyAnswered = myMessages.some((m) => new Date(m.created_at || m.createdAt) > new Date(latest.created_at || latest.createdAt));
      if (alreadyAnswered) {
        me.note('already answered Selin Kurt\'s latest reply (resume) — skipping.');
      } else {
        await me.attempt('answer Selin Kurt\'s latest reply', () => me.sendMessage(mentorConv, 'Anladım, çok teşekkürler Selin Hanım! Notlarınızı dikkate alıp bir sonraki görevde uygulayacağım.'));
      }
    }
    await me.attempt('mark mentor conversation read', () => me.markConversationRead(mentorConv));
  }

  // Can's delta: check the advisor conversation for a reply (none expected yet).
  const advisorConv = conversations.advisor;
  if (!advisorConv) {
    me.bug({ did: 'find my recorded advisor conversation', expected: 'a recorded conversation id from phase 4', got: 'none in state.students[can-dogan].conversations.advisor', severity: 'wrong' });
  } else {
    const advisorMessages = await me.attempt('read messages with the advisor', () => me.listMessages(advisorConv));
    const advisorUserId = s.advisorId;
    const herReply = (advisorMessages || []).some((m) => (m.sender_id || m.senderId) === advisorUserId);
    if (herReply) {
      me.note(`advisor did reply, unexpectedly: ${JSON.stringify(advisorMessages)}`);
    } else {
      me.note('no reply yet from the advisor in our conversation — as expected at this point.');
    }
    await me.attempt('mark advisor conversation read', () => me.markConversationRead(advisorConv));
  }

  // shared tail
  await me.attempt('read self vs mentor', () => me.competencySelfVsMentor(me.userId));
  await me.attempt('read competency progress', () => me.getCompetencyProgress(me.userId));
  await me.attempt('read working KPIs', () => me.getWorkingKpis(me.userId));
  await me.attempt('read the leaderboard', () => me.getMyGroupLeaderboard(10));
  const notifications = await me.attempt('read notifications', () => me.listNotifications());
  const hasApprovalNotif = (notifications || []).some((n) => n.type === 'task_approved');
  if ((mine.submissions || []).length > 0 && !hasApprovalNotif) {
    me.bug({ did: 'find a task_approved notification for my approved submissions', expected: 'at least one task_approved notification', got: `types seen: ${JSON.stringify((notifications || []).map((n) => n.type))}`, severity: 'wrong' });
  }
  const convs = await me.attempt('read conversations', () => me.listConversations(s.groupId));
  for (const c of (convs || [])) { await me.attempt('read messages', () => me.listMessages(c.id)); await me.attempt('mark read', () => me.markConversationRead(c.id)); }

  state.merge((st) => { st.students[P.slug].followUp = { likedClassmateCard: !!classmateCard, mentorConv: mentorConv || null, advisorConv: advisorConv || null }; });
  me.note('Faz 6 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
