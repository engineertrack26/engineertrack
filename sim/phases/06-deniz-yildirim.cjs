// Phase 6 — Deniz follows up (task-9-brief.md Step 2 + student-followup-common.md).
//
// Character-specific: Oğuz tried a correction request on one of her journals
// (2026-09-14, state.mentors['oguz-ari'].correctionDay — advisor-only per
// internship_note's own guard, so his attempt failed and he left the same
// text as ordinary feedback instead; see sim/phases/05-oguz-ari.cjs). Deniz
// reads that day's events and the note, re-reads the week for the fresh
// version, and re-saves the journal with a clearer one-sentence `learning`.
// internship_save_log's own guard (docs/internship-days-migration.sql:205)
// requires p_submit=true AND a non-empty p_reason once a day is already
// `submitted` — and the app's own UI shows exactly that reason field in this
// case (src/components/internship/InternshipDaysScreen.tsx:368), so this is
// not a guess: Deniz fills it in, the way the real screen would ask her to.
//
// Corrections from the controller (relayed after the others' runs), applied
// here directly rather than discovered the hard way:
//  1. list_feed_posts pages at up to 50 and the stream now has ~30 posts —
//     page with p_before (oldest createdAt seen) until a page comes back
//     shorter than the limit, before concluding any card is missing.
//  2. competency_self_vs_mentor.overRated is a COUNT, not a boolean — no
//     `=== true` comparison here.
//  3. The missing `task_approved` notification is already filed once by the
//     controller as [rough] (client-side creation, src/services/mentorReviews.ts)
//     — read and note it, do not re-file it.
const { Actor, parseCode, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('deniz-yildirim');

async function readAllFeedPosts(me, groupId) {
  const posts = [];
  let before = null;
  for (let i = 0; i < 6; i++) {
    const page = await me.attempt(`read the stream (page ${i + 1}, before=${before || 'now'})`, () => me.listFeedPosts(groupId, before, 50));
    if (!page || !page.length) break;
    posts.push(...page);
    if (page.length < 50) break;
    before = page[page.length - 1].createdAt;
  }
  return posts;
}

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const mine = s.students[P.slug] || {};
  const correctionDay = s.mentors['oguz-ari'] && s.mentors['oguz-ari'].correctionDay;

  // --- answer the feedback on the flagged journal ---
  if (!correctionDay) {
    me.bug({ did: "find Oğuz's flagged day in state.mentors['oguz-ari'].correctionDay", expected: 'a { id, date }', got: JSON.stringify(s.mentors['oguz-ari']), severity: 'blocker' });
  } else {
    const events = await me.attempt(`read the flagged day's events (${correctionDay.date})`, () => me.internshipEvents(correctionDay.id));
    const feedback = (events || []).find((e) => e.event_type === 'feedback');
    const correctionTried = (events || []).find((e) => e.event_type === 'correction');
    if (correctionTried) me.note(`internship_events shows a real 'correction' event too — Oğuz's attempt must have gone through after all; worth a second look, not expected per phase 5's log.`);
    if (feedback) me.note(`Oğuz'un notu (${correctionDay.date}): "${feedback.note}" — mentor feedback, correction request değil (danışman yetkisi).`);
    else me.bug({ did: "find Oğuz's note among the flagged day's events", expected: "one 'feedback' event with his text", got: `${(events || []).length} event(s): ${(events || []).map((e) => e.event_type).join(', ') || '(none)'}`, severity: 'wrong' });

    const freshWeek = await me.attempt('re-read my week for the fresh version', () => me.internshipWeek(me.userId, daysAgoIso(6)));
    const day = (freshWeek || []).find((d) => d.id === correctionDay.id);
    if (!day) {
      me.bug({ did: `find ${correctionDay.date} (id ${correctionDay.id}) in my week`, expected: 'a row for that day', got: `${(freshWeek || []).length} day(s), ids: ${(freshWeek || []).map((d) => d.id).join(', ')}`, severity: 'blocker' });
    } else {
      const clearerLearning = 'Bant hızı arttıkça yanlış ayrıştırma oranının da arttığını gördüm; bu yüzden hızı artırırken kalite kontrol noktasıyla eş zamanlı çalışmam gerekiyor.';
      const form = { experience: day.experience, learning: clearerLearning, nextStep: day.next_step, support: day.support_level, reason: 'Mentörümün notu üzerine öğrendiğimi daha net, tek cümlede yazdım.', taskId: day.task_id, attachment: day.attachment };
      try {
        await me.internshipSaveLog(day, form, true);
        me.log({ name: 'internship_save_log (re-save after feedback)', args: { day: day.id }, ok: true, result: null });
        me.note(`journal ${correctionDay.date} yeniden kaydedildi, öğrenme cümlesi netleştirildi: "${clearerLearning}"`);
      } catch (e) {
        const { code, detail } = parseCode(e);
        me.note(`re-saving the submitted journal ${correctionDay.date} was refused with code ${code}${detail ? `: ${detail}` : ''}.`);
        // The app's own screen offers exactly this path (a reason field once submitted) and
        // this call used it, so a refusal here would mean the app gives no way to act on
        // mentor feedback after submission — worth filing, but only then, and only [rough]
        // (a working but awkward flow), not [wrong] (the resubmission itself is by design).
        me.bug({ did: `re-save the submitted journal ${correctionDay.date} with a reason, after mentor feedback`, expected: 'success (submit=true with a non-empty reason, per internship_save_log and the app\'s own "reason" field for a submitted day)', got: `refused: ${code}${detail ? ` (${detail})` : ''}`, severity: 'rough' });
      }
    }
  }

  // --- confirm the excused day ---
  const week = await me.attempt('read my week (attendance check)', () => me.internshipWeek(me.userId, daysAgoIso(6)));
  const excusedDate = '2026-09-16';
  const excusedRow = (week || []).find((d) => d.day_date === excusedDate);
  if (!excusedRow) me.bug({ did: `find ${excusedDate} in my week`, expected: 'a row for that day', got: `${(week || []).length} day(s)`, severity: 'wrong' });
  else if (excusedRow.attendance !== 'excused') me.bug({ did: `confirm ${excusedDate} shows attendance 'excused'`, expected: "attendance: 'excused'", got: `attendance: '${excusedRow.attendance}'`, severity: 'wrong' });
  else me.note(`${excusedDate} attendance confirmed as 'excused'.`);

  // --- shared tail ---
  await me.attempt('read self vs mentor', () => me.competencySelfVsMentor(me.userId));
  await me.attempt('read competency progress', () => me.getCompetencyProgress(me.userId));
  await me.attempt('read working KPIs', () => me.getWorkingKpis(me.userId));
  await me.attempt('read the leaderboard', () => me.getMyGroupLeaderboard(10));

  const posts = await readAllFeedPosts(me, s.groupId);
  const taskCards = posts.filter((p) => p.kind === 'task');
  if (taskCards[0]) me.note(`sample task-card row (once, to see its shape): ${JSON.stringify(taskCards[0])}`);
  const myCards = taskCards.filter((p) => p.authorId === me.userId);
  const expectedCards = (mine.submissions || []).length;
  me.note(`stream has ${posts.length} post(s) total (${taskCards.length} task-kind); ${myCards.length}/${expectedCards} of my approved tasks found among them.`);
  if (myCards.length < expectedCards) {
    me.bug({ did: 'find a stream card for each of my 3 approved tasks', expected: `${expectedCards} task-kind posts authored by me`, got: `${myCards.length} found among ${posts.length} post(s) (kinds: ${[...new Set(posts.map((p) => p.kind))].join(', ')})`, severity: 'wrong' });
  }

  const notifications = await me.attempt('read notifications', () => me.listNotifications());
  const approvalNotifs = (notifications || []).filter((n) => n.type === 'task_approved');
  me.note(`${(notifications || []).length} notification(s) total, ${approvalNotifs.length} task_approved (the missing task_approved notification is a known finding, already filed once by the controller as [rough] — not re-filed here).`);

  const convs = await me.attempt('read conversations', () => me.listConversations(s.groupId));
  for (const c of (convs || [])) {
    await me.attempt('read messages', () => me.listMessages(c.id));
    await me.attempt('mark read', () => me.markConversationRead(c.id));
  }

  state.merge((st) => { st.students[P.slug].followUp = { correctionDayResaved: true, excusedConfirmed: !!excusedRow && excusedRow.attendance === 'excused', streamCards: myCards.length, expectedCards }; });
  me.note('Faz 6 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
