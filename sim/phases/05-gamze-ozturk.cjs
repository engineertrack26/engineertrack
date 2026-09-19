// Phase 5 — Gamze Öztürk reviews Mert Yılmaz's week and his submitted tasks.
// Style: rates lower than the student, writes why. Mert self-rates 3
// (independent) on everything; Gamze approves all four at level 1 with a note
// explaining the gap, then checks that competency_self_vs_mentor reflects it
// (negative gap, overRated = task count) — filing [wrong] if the sign or the
// counts are off.
const { Actor, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('gamze-ozturk');

const NOTE = 'Bağımsız çalışabildiğini düşünmüyorum; adımların çoğunda yönlendirme gerekti, bu yüzden seviye 1 veriyorum. Kendini 3 (bağımsız) olarak değerlendirmişsin ama gözlemlediğim bu değil — bir sonraki görevde daha az yönlendirmeyle ilerlemeyi hedefle.';

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const student = s.students[P.studentSlug];
  const reviewed = [];

  // attendance: every day present
  const week = await me.attempt("read my student's week", () => me.internshipWeek(student.userId, daysAgoIso(6)));
  const pendingDays = (week || []).filter((d) => d.attendance === 'pending');
  await me.attempt(`mark ${pendingDays.length} days present`, () => me.internshipReview(pendingDays, 'present', 'Sahadaydı.'));

  // reviews: approve all four at level 1, note explains why he is not yet independent
  const pending = await me.attempt('read pending reviews', () => me.listPendingReviews());
  const mineOnly = (pending || []).filter((p) => p.student_id === student.userId);
  if (mineOnly.length !== (pending || []).length) {
    me.bug({ did: 'read pending reviews', expected: "only my student's submissions", got: `${(pending || []).length} rows, ${mineOnly.length} mine`, severity: 'wrong' });
  } else {
    me.note(`listPendingReviews → ${(pending || []).length} row(s), all mine.`);
  }

  const selfLevels = mineOnly.map((sub) => sub.self_level);
  me.note(`Mert'in ${mineOnly.length} teslimindeki self_level: ${JSON.stringify(selfLevels)} (karakteri: her konuda kendini 3/bağımsız değerlendiriyor).`);
  if (selfLevels.some((l) => l !== 3)) me.note('adaptation: not every self_level in the live data is 3 — approving at level 1 with the explanatory note regardless, per style (mentor rates lower than the student on every submission).');

  for (const sub of mineOnly) {
    await me.attempt(`approve "${sub.group_assignments.title}"`, () => me.reviewAssignment(sub.id, true, NOTE, 1));
    reviewed.push({ submissionId: sub.id, approved: true, level: 1 });
  }

  // verify the comparison reflects the downgrade: negative gap, overRated = task count
  const comparison = await me.attempt('read the self-vs-mentor comparison', () => me.competencySelfVsMentor(student.userId));
  for (const row of (comparison || []).filter((r) => r.tasks > 0)) {
    const expectedGap = row.avgMentor - row.avgSelf;
    if (row.gap !== expectedGap) {
      me.bug({ did: `competency_self_vs_mentor gap formula for ${row.code}`, expected: `gap = avgMentor - avgSelf = ${expectedGap}`, got: row.gap, severity: 'wrong' });
    } else if (row.gap >= 0) {
      me.bug({ did: `competency_self_vs_mentor gap sign for ${row.code}`, expected: 'negative (mentor rated lower than self)', got: `gap ${row.gap} (avgSelf ${row.avgSelf}, avgMentor ${row.avgMentor})`, severity: 'wrong' });
    } else {
      me.note(`${row.code}: gap ${row.gap} (avgSelf ${row.avgSelf}, avgMentor ${row.avgMentor}) — correctly negative.`);
    }

    if (row.overRated !== row.tasks) {
      me.bug({ did: `competency_self_vs_mentor overRated count for ${row.code}`, expected: `overRated = tasks = ${row.tasks}`, got: row.overRated, severity: 'wrong' });
    } else {
      me.note(`${row.code}: overRated ${row.overRated} = tasks ${row.tasks} — correct.`);
    }
  }

  state.merge((st) => { Object.assign(st.mentors[P.slug], { reviewed }); });
  me.note('Faz 5 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
