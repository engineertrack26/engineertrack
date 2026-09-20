// Phase 6b — Can, follow-up correction. The controller flagged that my
// phase-6 run's five "no stream card" [wrong] entries were false positives:
// listFeedPosts(groupId) only returns its first page (default limit 20),
// and the stream had grown to ~30+ posts by the time I ran, so my four
// approved-task cards and a classmate's card were sitting on page 2. This
// script pages through the stream properly (looping listFeedPosts with
// p_before) and finishes the part phase 6 could not reach: liking and
// commenting a question on a classmate's approved task card, then reading
// the comments back to confirm mine is there. It also fixes a second bug
// I found in my own phase-6 script while investigating: listMessages
// returns messages newest-first, but phase 6 picked
// herMessages[herMessages.length - 1] as "her latest reply", which is
// actually her oldest (the welcome message) — so it wrongly concluded I had
// already answered her latest reply (the one approving all four tasks) and
// never did. This script answers it now. All actions here are guarded to
// be safe to re-run (idempotent) in case phase 6b itself needs a retry.
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('can-dogan');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const mine = s.students[P.slug] || {};

  me.note('CORRECTION (controller review of phase 6): the five [wrong] "no stream card for my approved task" / "no classmate card" entries filed in phase 6 (18:02:29) were false positives, not product bugs. listFeedPosts(groupId) with no explicit p_before/p_limit defaults to the first 20 posts; by the time I ran phase 6 the stream held ~32 posts (six students\' worth of approved tasks plus polls/announcements), so my own four cards and every classmate card were past page 1. The controller removed those five entries from sim/bugs.md and merged the sixth (missing task_approved notification) into one [rough], noting it is created client-side by the mentor app. This script pages through the stream correctly and completes the classmate-card interaction.');

  // Page through the whole stream (p_before = createdAt of the last row seen).
  let stream = [];
  let before = null;
  for (let i = 0; i < 10; i++) {
    const page = await me.attempt(`read the stream, page ${i + 1}`, () => me.listFeedPosts(s.groupId, before, 50));
    if (!page || page.length === 0) break;
    stream = stream.concat(page);
    if (page.length < 50) break;
    before = page[page.length - 1].createdAt;
  }
  me.note(`stream paged fully: ${stream.length} posts total (kinds: ${JSON.stringify(stream.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] || 0) + 1; return acc; }, {}))}).`);

  // Confirm my four approved submissions all have a stream card, this time across the full paged stream.
  for (const sub of (mine.submissions || [])) {
    const card = stream.find((post) => post.kind === 'task' && post.task && post.task.submissionId === sub.submissionId);
    if (!card) me.bug({ did: `find a stream card for my approved task (assignment ${sub.assignmentId}), across the full paged stream`, expected: 'a task post', got: `${stream.length} posts paged, none matched submissionId ${sub.submissionId}`, severity: 'wrong' });
    else me.note(`confirmed my card for submission ${sub.submissionId}: "${card.task.title}".`);
  }

  // The part phase 6 could not reach: a classmate's approved task card — like it and ask a question.
  const classmateCard = stream.find((post) => post.kind === 'task' && post.authorId && post.authorId !== me.userId);
  if (!classmateCard) {
    me.bug({ did: 'find a classmate\'s approved task card in the stream (full paged stream)', expected: 'a kind: task post authored by someone other than me', got: `${stream.length} posts paged; authors seen: ${JSON.stringify(stream.filter((p) => p.kind === 'task').map((p) => p.authorName))}`, severity: 'wrong' });
  } else {
    me.note(`classmate task card found: "${classmateCard.task.title}" by ${classmateCard.authorName} (post ${classmateCard.id}).`);
    if (classmateCard.likedByMe) {
      me.note('already liked the classmate\'s card (resume) — skipping like.');
    } else {
      await me.attempt('like the classmate\'s task card', () => me.likePost(classmateCard.id));
    }
    const questionBody = 'Elinize sağlık! Bu görevde numune alma sırasında karşılaştığınız en zor kısım neydi, biraz anlatır mısınız?';
    const existingComments = await me.attempt('read the comments before commenting', () => me.listComments(classmateCard.id));
    const alreadyCommented = (existingComments || []).some((c) => (c.author_id === me.userId || c.authorId === me.userId) && c.body === questionBody);
    if (alreadyCommented) {
      me.note('already posted my question on the classmate\'s card (resume) — skipping comment.');
    } else {
      await me.attempt('comment a question on the classmate\'s task card', () => me.addComment(classmateCard.id, questionBody));
    }
    const comments = await me.attempt('read the comments back', () => me.listComments(classmateCard.id));
    const mineComment = (comments || []).find((c) => (c.author_id === me.userId || c.authorId === me.userId) && c.body === questionBody);
    if (!mineComment) {
      me.bug({ did: 'confirm my comment appears in listComments(postId)', expected: 'my question comment in the list', got: `comments seen: ${JSON.stringify(comments)}`, severity: 'wrong' });
    } else {
      me.note('confirmed: my comment is in listComments for the card.');
    }
  }

  // Fix: correctly find Selin Kurt's LATEST reply (messages sort newest-first, not oldest-first)
  // and answer it if I have not already.
  const mentorConv = (mine.conversations && mine.conversations.mentor) || (s.mentors && s.mentors['selin-kurt'] && s.mentors['selin-kurt'].conversationWithCan);
  if (mentorConv) {
    const mentorMessages = await me.attempt('re-read messages with my mentor', () => me.listMessages(mentorConv));
    const mentorUserId = s.mentors && s.mentors['selin-kurt'] && s.mentors['selin-kurt'].userId;
    const byNewestFirst = (mentorMessages || []).slice().sort((a, b) => new Date(b.createdAt || b.created_at) - new Date(a.createdAt || a.created_at));
    const herLatest = byNewestFirst.find((m) => (m.senderId || m.sender_id) === mentorUserId);
    if (!herLatest) {
      me.bug({ did: 'find Selin Kurt\'s latest reply in our conversation (re-check)', expected: 'at least one message from her', got: `messages seen: ${JSON.stringify(mentorMessages)}`, severity: 'wrong' });
    } else {
      me.note(`Selin Kurt's real latest reply (sorted correctly this time): ${JSON.stringify(herLatest)}`);
      const myLatestAfterHers = byNewestFirst.some((m) => (m.senderId || m.sender_id) === me.userId && new Date(m.createdAt || m.created_at) > new Date(herLatest.createdAt || herLatest.created_at));
      if (myLatestAfterHers) {
        me.note('already answered Selin Kurt\'s real latest reply (resume) — skipping.');
      } else {
        await me.attempt('answer Selin Kurt\'s latest reply (the one approving all four tasks)', () => me.sendMessage(mentorConv, 'Çok teşekkürler Selin Hanım, dört görevi de değerlendirdiğiniz için! Notlarınızı okudum, bir sonraki haftada uygulayacağım.'));
      }
    }
    await me.attempt('mark mentor conversation read (re-check)', () => me.markConversationRead(mentorConv));
  }

  state.merge((st) => {
    st.students[P.slug].followUp = Object.assign({}, st.students[P.slug].followUp, {
      likedClassmateCard: !!classmateCard,
      classmateCardId: classmateCard ? classmateCard.id : null,
      streamPaginationNote: 'listFeedPosts default page (20) missed cards past page 1 in phase 6; confirmed via full pagination in phase 6b.',
    });
  });
  me.note('Faz 6b (düzeltme) bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
