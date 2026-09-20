// Phase 7c — Ayşe, after closure. Her record is read-only per the closure
// design (docs/superpowers/specs/2026-09-16-internship-closure-design.md
// §3): no new submissions, no journal edits, no new conversations — but
// reading (her own report, the stream) and likes/comments stay open.
//
// Adaptations (also logged in-band via me.note()):
//  1. submitAssignment must clear REFLECTION_REQUIRED / SELF_LEVEL_REQUIRED
//     first (docs/internship-closure-guards.sql: both checks run BEFORE the
//     INTERNSHIP_CLOSED guard), so a real non-blank reflection and a valid
//     self level (0-3) are sent — otherwise the refusal code would be the
//     wrong one and expectRefusal would wrongly file a bug.
//  2. internshipOpenDay(today) is not called at all: today is already open
//     from an earlier phase (idempotent open), so brief step 2's probe is
//     replaced with internshipSaveLog on the most recent day in her week
//     (her "today" in the story) — the closure guard fires before any
//     version/log_status check, so it refuses the same way whether or not
//     that day was already submitted.
//  3. openConversation(groupId, advisorId): she has never messaged the
//     advisor, so there is no existing conversation. can_message is called
//     before the closure guard in open_conversation, so this only produces
//     INTERNSHIP_CLOSED (rather than some other refusal) if student-advisor
//     messaging is otherwise allowed; if a different code comes back first,
//     that is not INTERNSHIP_CLOSED and would be flagged as [wrong] by
//     expectRefusal, which is a genuine finding (not a script adaptation).
const { Actor, daysAgoIso, parseCode } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('ayse-celik');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const mine = s.students[P.slug] || {};

  // 1. submitAssignment on an unsubmitted task -> INTERNSHIP_CLOSED
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  const untouched = (tasks || []).find((t) => !(t.assignment_submissions || []).some((sub) => sub.student_id === me.userId));
  if (!untouched) {
    me.bug({ did: 'find an unsubmitted published task to probe post-closure', expected: 'at least one task with no submission of mine (phase 4 left two untouched)', got: `tasks seen: ${JSON.stringify((tasks || []).map((t) => ({ id: t.id, subs: (t.assignment_submissions || []).length })))}`, severity: 'wrong' });
  } else {
    await me.expectRefusal('INTERNSHIP_CLOSED', 'submit an unsubmitted task after closure',
      () => me.submitAssignment(untouched.id, 'Deneme (kapanış sonrası).', 'Kapanış sonrası bir yansıma denemesi.', [], [], 2));
  }

  // 2. internshipSaveLog on the most recent day in my week -> INTERNSHIP_CLOSED
  //    (adaptation #2: internshipOpenDay(today) is not probed — today is
  //    already open from an earlier phase, idempotently.)
  const week = await me.attempt('read my week for the fresh version', () => me.internshipWeek(me.userId, daysAgoIso(6)));
  const lastDay = (week && week.length) ? week[week.length - 1] : null;
  if (!lastDay) {
    me.bug({ did: 'find a journal day to probe post-closure', expected: 'at least one internship_days row from earlier phases', got: `week: ${JSON.stringify(week)}`, severity: 'wrong' });
  } else {
    const form = { experience: 'Kapanış sonrası deneme kaydı.', learning: 'Kapanış sonrası deneme kaydı.', nextStep: 'Kapanış sonrası deneme kaydı.', support: 2, reason: '', taskId: null, attachment: null };
    await me.expectRefusal('INTERNSHIP_CLOSED', `save my journal for ${lastDay.day_date} after closure`, () => me.internshipSaveLog(lastDay, form, true));
  }

  // 3. openConversation with the advisor (no existing conversation) -> INTERNSHIP_CLOSED,
  //    or if it somehow opens, sendMessage in it -> INTERNSHIP_CLOSED.
  let opened = false;
  try {
    const convId = await me.openConversation(s.groupId, s.advisorId);
    opened = true;
    me.note(`openConversation with the advisor unexpectedly succeeded (id ${convId}) — trying sendMessage there instead.`);
    await me.expectRefusal('INTERNSHIP_CLOSED', 'send a message to the advisor after closure', () => me.sendMessage(convId, 'Merhaba, kapanış sonrası bir mesaj denemesi.'));
  } catch (e) {
    const { code } = parseCode(e);
    if (code === 'INTERNSHIP_CLOSED') { me.note('expected refusal INTERNSHIP_CLOSED for: open a conversation with the advisor after closure'); }
    else { me.bug({ did: 'open a conversation with the advisor after closure', expected: 'refusal INTERNSHIP_CLOSED', got: e.message, code, severity: 'wrong' }); }
  }

  // 4. getInternshipReport as the student -> must SUCCEED.
  const report = await me.attempt('read my own closure report', () => me.getInternshipReport(me.userId, s.groupId));
  if (report) me.note(`my report is readable (${report.length} chars); first lines: ${JSON.stringify(report.split('\n').slice(0, 5))}`);

  // 5. listFeedPosts must still succeed; likePost on some post must still succeed.
  const stream = await me.attempt('read the stream after closure', () => me.listFeedPosts(s.groupId, null, 50));
  if (stream && stream.length) {
    const target = stream.find((p) => !p.likedByMe) || stream[0];
    if (target.likedByMe) {
      me.note(`already liked post ${target.id} (resume) — skipping like.`);
    } else {
      await me.attempt('like a post after closure (likes are not guarded)', () => me.likePost(target.id));
    }
  } else {
    me.bug({ did: 'find a post to like after closure', expected: 'at least one post in the stream', got: `stream: ${JSON.stringify(stream)}`, severity: 'wrong' });
  }

  state.merge((st) => { Object.assign(st.students[P.slug], { postClosure: { probedUnsubmittedTask: !!untouched, probedDay: lastDay ? lastDay.day_date : null, conversationOpened: opened, reportReadable: !!report, streamReadable: !!(stream && stream.length) } }); });
  me.note('Faz 7c bitti — kapanış sonrası yalnızca okuma ve beğeni açık.');
})().catch((e) => { console.error(e); process.exit(1); });
