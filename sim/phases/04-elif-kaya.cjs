// Phase 4 — Elif's week. Template for the other six students' scripts.
//
// Adaptations from the brief's literal skeleton (see me.note() calls below
// for the same, logged in-band):
//  1. me.signIn, not me.signUp — Elif's account already exists from phase 2.
//  2. "open today twice": internship_open_day is idempotent BY DESIGN for a
//     repeat call on the same (student, date) pair — see
//     docs/internship-days-migration.sql, the branch `IF FOUND THEN ...
//     RETURN existing.id; -- idempotent reconnect/double tap; never changes
//     the original check-in time`. So the second call does not raise
//     ID_EXISTS (the brief's guess) or any other refusal — it SUCCEEDS and
//     returns the exact same internship_days id as the first call, with no
//     new row inserted. That is not "a duplicate day" (no duplicate row
//     exists), so per the brief's own fallback rule ("if a different stable
//     code comes back, note it and treat it as the expected refusal — do
//     not file") this is treated as expected/documented behaviour, not
//     filed as a bug. Only a second call returning a genuinely different id
//     would be a real duplicate-day bug, and this is checked explicitly
//     below rather than assumed.
//  3. Resume safety instead of a --from=<step> flag: internship_open_day is
//     naturally idempotent (adaptation #2) and submit_assignment is safe to
//     repeat while the row is not yet 'approved' (self-assessment-migration.sql:
//     the INSERT ... ON CONFLICT DO UPDATE guard only blocks a resubmit once
//     a mentor has approved — ALREADY_APPROVED). The one non-idempotent step
//     is internship_save_log on an already-'submitted' day (it demands a
//     p_reason to touch a submitted day again — ID_REASON). So instead of a
//     coarse step index, each loop below re-checks live state (day.log_status,
//     the assignment's own assignment_submissions row for this student) and
//     skips with a me.note() if that piece is already done — safe to rerun
//     the whole script after a crash without redoing finished work or
//     hitting ID_REASON.
const { Actor, daysAgoIso, todayIso, parseCode } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('elif-kaya');
const WEEKDAY = (iso) => { const d = new Date(iso + 'T12:00:00'); return d.getDay() >= 1 && d.getDay() <= 5; };
const JOURNAL = {
  experience: ['Ön çökeltim havuzunda çamur seviyesi ölçümü yaptık; numune alma noktalarını öğrendim.', 'Havalandırma havuzunda çözünmüş oksijen profilini çıkardık.', 'Laboratuvarda KOİ ve AKM analizlerine eşlik ettim.', 'SCADA ekranından pompa arıza kayıtlarını inceledik.', 'Çamur susuzlaştırma ünitesinde polimer dozajı denemesi yapıldı.', 'Deşarj noktasında numune aldık, saha defterini doldurdum.'],
  learning: ['Numune etiketinde saat ve nokta kodunun neden zorunlu olduğunu anladım.', 'DO değeri 2 mg/L altına düşünce nitrifikasyonun bozulduğunu gördüm.', 'KOİ analizinde seyreltme oranının sonucu nasıl etkilediğini öğrendim.', 'Arıza kaydı olmadan bakım planı yapılamıyor.', 'Polimer fazlası çamuru yapışkan hale getiriyor.', 'Deşarj limitleri yönetmelikte tablo 21.1\'de.'],
};

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  me.note('Signed in (adaptation #1): Elif already exists from phase 2, so this script does not sign up again.');
  const s = state.read();
  const mine = s.students[P.slug];
  const days = [];
  const submissions = [];

  // attendance: today is a real check-in, earlier weekdays are opened with a reason
  const past = [6, 5, 4, 3, 2, 1].map(daysAgoIso).filter(WEEKDAY);
  for (const date of past) {
    const id = await me.attempt(`open past day ${date} with a reason`, () => me.internshipOpenDay(me.userId, date, 'Kaydı gün sonunda açamadım, sahadaydım.'));
    if (id) days.push({ date, id });
  }
  const todayId = await me.attempt('check in today', () => me.internshipOpenDay(me.userId, todayIso()));
  if (todayId) days.push({ date: todayIso(), id: todayId });

  // "open today twice" (adaptation #2): not run through expectRefusal, since
  // the real behaviour is a SUCCESS, not a refusal.
  try {
    const secondId = await me.internshipOpenDay(me.userId, todayIso());
    if (secondId === todayId) {
      me.note(`open today a second time succeeded and returned the SAME internship_days id (${secondId}) as the first check-in — idempotent by design (docs/internship-days-migration.sql: "idempotent reconnect/double tap; never changes the original check-in time"). Not the ID_EXISTS refusal the brief guessed, and not a duplicate day either since no new row exists; treated as expected behaviour, not filed.`);
    } else {
      me.bug({ did: 'open today twice', expected: 'a refusal, or the same day id back if idempotent by design', got: `success with a DIFFERENT id (${secondId} vs first id ${todayId}) — a genuine duplicate day`, severity: 'wrong' });
    }
  } catch (e) {
    const { code } = parseCode(e);
    if (code === 'ID_EXISTS') me.note('expected refusal ID_EXISTS for: open today twice');
    else me.note(`open today twice was refused with code ${code} (not the brief's guessed ID_EXISTS) — a different stable code, treated as the expected refusal per the brief, not filed.`);
  }

  const week = await me.attempt('read my week', () => me.internshipWeek(me.userId, daysAgoIso(6)));

  // journals: Elif writes every day, submits every one
  for (const [i, day] of (week || []).entries()) {
    if (day.log_status === 'submitted') { me.note(`journal ${day.day_date} already submitted (resume) — skipping.`); continue; }
    const form = { experience: JOURNAL.experience[i % 6], learning: JOURNAL.learning[i % 6], nextStep: 'Yarın numune planını mentorla gözden geçireceğim.', support: i < 2 ? 1 : 2, reason: '', taskId: null, attachment: null };
    await me.attempt(`save journal draft ${day.day_date}`, () => me.internshipSaveLog(day, form, false));
    const freshWeek = await me.attempt('re-read my week for the fresh version', () => me.internshipWeek(me.userId, daysAgoIso(6)));
    const fresh = (freshWeek || []).find((d) => d.id === day.id); // version bumped by the draft save
    if (fresh) await me.attempt(`submit journal ${day.day_date}`, () => me.internshipSaveLog(fresh, form, true));
  }

  // tasks: evidence on every one, honest self level
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  for (const [i, task] of (tasks || []).slice(0, 4).entries()) {
    const already = (task.assignment_submissions || []).find((sub) => sub.student_id === me.userId);
    if (already) { me.note(`task "${task.title}" already has a submission (status ${already.status}, resume) — skipping.`); if (already.id) submissions.push({ assignmentId: task.id, submissionId: already.id }); continue; }
    const photo = await me.attempt('upload a photo', () => me.uploadPhoto(task.id));
    const doc = await me.attempt('upload a document', () => me.uploadDocument(task.id, 'olcum-tablosu.pdf'));
    const submissionId = await me.attempt(`submit task "${task.title}"`, () => me.submitAssignment(task.id,
      `Görevi ${['pazartesi', 'salı', 'çarşamba', 'perşembe'][i]} tamamladım; ölçüm tablosu ve saha fotoğrafı ekte.`,
      'Bu görevde en çok kalibrasyonun neden her ölçümden önce yapıldığını anladım.',
      photo ? [{ uri: photo, caption: 'Saha fotoğrafı' }] : [], doc ? [{ uri: doc, fileName: 'olcum-tablosu.pdf', fileType: 'application/pdf', fileSize: 600 }] : [], i === 0 ? 1 : 2));
    if (submissionId) submissions.push({ assignmentId: task.id, submissionId });
  }
  if (tasks && tasks[4]) {
    await me.expectRefusal('REFLECTION_REQUIRED', 'submit without a reflection', () => me.submitAssignment(tasks[4].id, 'Not', '', [], [], 2));
    await me.expectRefusal('SELF_LEVEL_REQUIRED', 'submit without a self level', () => me.submitAssignment(tasks[4].id, 'Not', 'Yansıma', [], [], undefined));
  } else {
    me.note('fewer than 5 published assignments — skipped the REFLECTION_REQUIRED / SELF_LEVEL_REQUIRED probes (no spare task to use).');
  }

  // messages: Elif writes to Burak (classmate)
  const contacts = await me.attempt('read message contacts', () => me.listMessageContacts(s.groupId));
  const burak = (contacts || []).find((c) => c.id === s.students['burak-sahin'].userId);
  let classmate = (mine && mine.conversations && mine.conversations.classmate) || undefined;
  if (burak) {
    classmate = await me.attempt('open a conversation with Burak', () => me.openConversation(s.groupId, burak.id));
    if (classmate) await me.attempt('message Burak', () => me.sendMessage(classmate, 'Burak, ikinci görevin kriterini anladın mı? Ben ölçüm tablosunu ekledim.'));
  } else {
    me.bug({ did: 'find Burak in message contacts', expected: 'Burak Şahin listed as a group contact', got: JSON.stringify(contacts), severity: 'wrong' });
  }
  await me.attempt('read notifications', () => me.listNotifications());
  await me.attempt('read unread message count', () => me.unreadMessageCount());
  await me.attempt('sync growth awards', () => me.syncMyGrowthAwards());

  state.merge((st) => { Object.assign(st.students[P.slug], { days, submissions, conversations: { classmate } }); });
  me.note('Faz 4 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
