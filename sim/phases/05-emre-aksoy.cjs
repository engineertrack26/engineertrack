// Phase 5 — Emre Aksoy reviews Ayşe Çelik's week and her submitted tasks.
// Style: slow. Marks every day present, approves all of Ayşe's submissions
// except the newest (latest submitted_at), which is left in `submitted`
// state on purpose — phase 7's PENDING_REVIEWS check needs exactly one
// pending submission of hers. Short notes, fixed level 2 (no escalation
// pattern, unlike the template).
const { Actor, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('emre-aksoy');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const student = s.students[P.studentSlug];
  const reviewed = [];

  // attendance: every day present, short note
  const week = await me.attempt("read my student's week", () => me.internshipWeek(student.userId, daysAgoIso(6)));
  const pendingDays = (week || []).filter((d) => d.attendance === 'pending');
  await me.attempt(`mark ${pendingDays.length} days present`, () => me.internshipReview(pendingDays, 'present', 'Sahada.'));

  // reviews: approve all but the newest (latest submitted_at) — that one stays `submitted`
  const pending = await me.attempt('read pending reviews', () => me.listPendingReviews());
  const mineOnly = (pending || []).filter((p) => p.student_id === student.userId);
  if (mineOnly.length !== (pending || []).length) me.bug({ did: 'read pending reviews', expected: "only my student's submissions", got: `${(pending || []).length} rows, ${mineOnly.length} mine`, severity: 'wrong' });

  const byOldestFirst = [...mineOnly].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
  const leftPending = byOldestFirst[byOldestFirst.length - 1];
  const toApprove = byOldestFirst.slice(0, -1);

  for (const sub of toApprove) {
    await me.attempt(`approve "${sub.group_assignments.title}"`, () => me.reviewAssignment(sub.id, true, 'Uygun.', 2));
    reviewed.push({ submissionId: sub.id, approved: true, level: 2 });
  }
  if (leftPending) {
    me.note(`left "${leftPending.group_assignments.title}" (${leftPending.id}, submitted ${leftPending.submitted_at}) pending on purpose — the newest; kept for phase 7's PENDING_REVIEWS check.`);
  } else {
    me.bug({ did: 'find a submission to leave pending', expected: 'at least one of Ayşe\'s submissions', got: `${mineOnly.length} rows`, severity: 'blocker' });
  }

  await me.attempt('read the self-vs-mentor comparison', () => me.competencySelfVsMentor(student.userId));
  await me.attempt('read notifications', () => me.listNotifications());

  state.merge((st) => {
    Object.assign(st.mentors[P.slug], { reviewed });
    st.mentors[P.slug].leftPending = leftPending ? leftPending.id : null;
  });
  me.note('Faz 5 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
