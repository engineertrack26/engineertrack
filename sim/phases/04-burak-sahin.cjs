// Phase 4 — Burak Şahin's week. Adapted from sim/phases/04-elif-kaya.cjs
// (the template — see its header comments for the general adaptations:
// signIn not signUp, internship_open_day's idempotency, and the
// resume-safety pattern used below instead of a --from=<step> flag).
//
// Character (task-7-brief.md Step 2, Burak — late, last-minute):
//  - Opens only today + two past weekdays (misses the other three weekdays
//    in the six-day window entirely — no attempt is even made for them).
//    The two he does open are the two most recent past weekdays, i.e. the
//    ones still plausible to backfill without a stretch of a reason.
//  - Writes journal DRAFTS for all three days he opens, but SUBMITS only
//    two of them — the two past days. Today's journal is left as a draft
//    on purpose (he runs out of time before sending it).
//  - Submits FIVE tasks all at once, at the very end of the script, each
//    with the exact same one-word reflection 'Yaptım.', self level 2, and
//    one photo (no document) — a real test of whether such a minimal
//    reflection is accepted.
//  - Reads his conversations, finds Elif's message (from her phase-4 run,
//    which by state.json has already produced a conversation+message
//    addressed to him), reads it, and replies in character.
//  - Reads notifications and marks one read; reads the unread message
//    count both before and after replying to Elif.
const { Actor, daysAgoIso, todayIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('burak-sahin');
const WEEKDAY = (iso) => { const d = new Date(iso + 'T12:00:00'); return d.getDay() >= 1 && d.getDay() <= 5; };
const JOURNAL = {
  experience: ['ÇED başvuru dosyasındaki eksiklik listesini kontrol ettim, iki kalem eksik çıktı.', 'Firma ile saha ziyareti öncesi kontrol formunu hazırladık, ekipmanı listeledik.'],
  learning: ['Eksiklik yazısı gönderilmeden dosya incelemeye alınmıyormuş, bunu bilmiyordum.', 'Saha ziyareti raporunda fotoğraf eki zorunluymuş, unutmayacağım.'],
};

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  me.note('Signed in (adaptation, per template): Burak already exists from phase 2, so this script does not sign up again.');
  const s = state.read();
  const mine = s.students[P.slug] || {};
  const days = mine.days ? [...mine.days] : [];
  const submissions = mine.submissions ? [...mine.submissions] : [];

  // attendance: today + the two most recent past weekdays only. The other
  // three weekdays in the window are missed entirely — no call is made for
  // them, in character (a late intern who only catches up on the tail end).
  const allPastWeekdays = [6, 5, 4, 3, 2, 1].map(daysAgoIso).filter(WEEKDAY); // oldest -> newest
  const missed = allPastWeekdays.slice(0, -2);
  const past = allPastWeekdays.slice(-2);
  me.note(`In character: missing ${missed.join(', ') || '(none in window)'} entirely — only opening ${past.join(' and ')} plus today.`);
  for (const date of past) {
    if (days.find((d) => d.date === date)) { me.note(`day ${date} already open (resume) — skipping.`); continue; }
    const id = await me.attempt(`open past day ${date} with a reason`, () => me.internshipOpenDay(me.userId, date, 'Dosya teslim gününe yetiştirmeye çalışıyordum, günü zamanında kapatamamışım.'));
    if (id) days.push({ date, id });
  }
  if (!days.find((d) => d.date === todayIso())) {
    const todayId = await me.attempt('check in today', () => me.internshipOpenDay(me.userId, todayIso()));
    if (todayId) days.push({ date: todayIso(), id: todayId });
  } else {
    me.note('today already open (resume) — skipping.');
  }

  const week = await me.attempt('read my week', () => me.internshipWeek(me.userId, daysAgoIso(6)));
  const openDates = new Set(days.map((d) => d.date));
  const myDays = (week || []).filter((d) => openDates.has(d.day_date)).sort((a, b) => a.day_date.localeCompare(b.day_date));
  const submitDates = new Set(past); // the two past days get submitted; today's stays a draft

  // journals: drafts for all three days opened, submits only two
  for (const [i, day] of myDays.entries()) {
    if (day.log_status === 'submitted') { me.note(`journal ${day.day_date} already submitted (resume) — skipping.`); continue; }
    const form = { experience: JOURNAL.experience[i % 2], learning: JOURNAL.learning[i % 2], nextStep: 'Yarın eksiklik listesini mentöre ileteceğim.', support: 2, reason: '', taskId: null, attachment: null };
    await me.attempt(`save journal draft ${day.day_date}`, () => me.internshipSaveLog(day, form, false));
    if (submitDates.has(day.day_date)) {
      const freshWeek = await me.attempt('re-read my week for the fresh version', () => me.internshipWeek(me.userId, daysAgoIso(6)));
      const fresh = (freshWeek || []).find((d) => d.id === day.id); // version bumped by the draft save
      if (fresh) await me.attempt(`submit journal ${day.day_date}`, () => me.internshipSaveLog(fresh, form, true));
    } else {
      me.note(`journal ${day.day_date} left as a draft on purpose (the "drafts for three, submits two" trait) — today's journal stays unsent.`);
    }
  }

  // tasks: all five submitted together, right at the end, each with the
  // exact same one-word reflection and self level — a deliberate minimal-
  // effort probe of whether the app accepts it.
  const REFLECTION = 'Yaptım.';
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  const candidates = (tasks || []).slice(0, 5);
  let acceptedCount = 0;
  for (const [i, task] of candidates.entries()) {
    const already = (task.assignment_submissions || []).find((sub) => sub.student_id === me.userId);
    if (already) { me.note(`task "${task.title}" already has a submission (status ${already.status}, resume) — skipping.`); if (already.id) submissions.push({ assignmentId: task.id, submissionId: already.id }); continue; }
    const photo = await me.attempt('upload a photo', () => me.uploadPhoto(task.id));
    const submissionId = await me.attempt(`submit task "${task.title}"`, () => me.submitAssignment(task.id,
      'Son ana kaldı ama yetiştirdim, fotoğrafı ekliyorum.', REFLECTION,
      photo ? [{ uri: photo, caption: 'Kanıt fotoğrafı' }] : [], [], 2));
    if (submissionId) { submissions.push({ assignmentId: task.id, submissionId }); acceptedCount++; }
  }
  if (acceptedCount > 0) {
    me.bug({ did: `submit ${acceptedCount} task(s) with the same one-word reflection "${REFLECTION}" (self level 2, one photo each, no document)`,
      expected: 'the app to require more than a bare non-empty string for a reflection — or at least surface a soft warning — since REFLECTION_REQUIRED only guards emptiness, not substance',
      got: 'accepted silently on every submission, identical text and all, with no minimum length or word-count enforced anywhere in the flow', severity: 'rough' });
  }

  // messages: unread count before, find + read Elif's message, reply, unread count after
  const unreadBefore = await me.attempt('read unread message count (before)', () => me.unreadMessageCount());
  const conversations = await me.attempt('read my conversations', () => me.listConversations(s.groupId));
  const elifId = s.students['elif-kaya'] && s.students['elif-kaya'].userId;
  const withElif = (conversations || []).find((c) => c.otherId === elifId);
  let classmate = (mine.conversations && mine.conversations.classmate) || (withElif && withElif.id);
  if (withElif) {
    classmate = withElif.id;
    const messages = await me.attempt('read messages with Elif', () => me.listMessages(withElif.id));
    const fromElif = (messages || []).find((m) => m.senderId === elifId);
    if (fromElif) {
      me.note(`Elif wrote: "${fromElif.body}"`);
      await me.attempt('reply to Elif', () => me.sendMessage(withElif.id, 'Elif, açıkçası daha bakamadım, dosyalar son ana kaldı bende de :) Bu akşam beşini birden yolluyorum, kriterine de o zaman tam bakarım.'));
    } else {
      me.note('a conversation with Elif exists but no message from her was found in it yet — nothing to reply to.');
    }
  } else {
    me.bug({ did: 'find a conversation with Elif via list_conversations', expected: "Elif's conversation to appear (per state.json she already opened one and messaged Burak in her phase-4 run)", got: JSON.stringify(conversations), severity: 'wrong' });
  }
  const unreadAfter = await me.attempt('read unread message count (after)', () => me.unreadMessageCount());
  me.note(`unread message count before replying: ${JSON.stringify(unreadBefore)}, after: ${JSON.stringify(unreadAfter)}.`);

  // notifications: read, mark one read
  const notifications = await me.attempt('read notifications', () => me.listNotifications());
  if (notifications && notifications[0]) {
    await me.attempt(`mark notification "${notifications[0].title}" read`, () => me.markNotificationRead(notifications[0].id));
  } else {
    me.note('no notifications to mark read.');
  }

  state.merge((st) => { Object.assign(st.students[P.slug], { days, submissions, conversations: { classmate } }); });
  me.note('Faz 4 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
