// Phase 5 — Murat Koç reviews Zeynep Arslan's week and her submitted tasks.
// Style (task-8-brief.md Step 2 / task assignment): approves everything, never
// writes a note. Reads only what is needed to act — no journal note, no
// events, no self-vs-mentor comparison, no notifications, no cross-mentor
// probe (that's Hakan's only, per the common instructions).
//
// Two things this script checks explicitly, per task instructions:
//  1. Whether an empty note ('') is accepted on internship_review and on
//     review_assignment. If refused, the refusal code is logged and the same
//     write is retried once with a single dot ('.').
//  2. Zeynep's three submissions include one with no evidence (no log_photos,
//     no log_documents rows). It is approved like the others; if the approval
//     goes through, that is filed as a [rough] bug — the app let a mentor
//     approve a task with no evidence attached.
const { Actor, parseCode, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('murat-koc');

/** Tries fn with an empty note; on refusal, logs the code and retries once with '.'. */
async function withEmptyNoteFallback(me, did, fn) {
  try {
    const r = await fn('');
    me.note(`empty note accepted for: ${did}`);
    return r;
  } catch (e) {
    const { code } = parseCode(e);
    me.note(`empty note refused for: ${did} — code ${code}; retrying with '.'`);
    return me.attempt(`${did} (retry with '.')`, () => fn('.'));
  }
}

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const student = s.students[P.studentSlug];
  const reviewed = [];

  // attendance: every pending day marked present, empty note.
  const week = await me.attempt("read my student's week", () => me.internshipWeek(student.userId, daysAgoIso(6)));
  const pendingDays = (week || []).filter((d) => d.attendance === 'pending');
  await withEmptyNoteFallback(me, `mark ${pendingDays.length} days present`, (note) => me.internshipReview(pendingDays, 'present', note));

  // reviews: approve every submission, note: '', level: 2 — no exceptions.
  const pending = await me.attempt('read pending reviews', () => me.listPendingReviews());
  const mineOnly = (pending || []).filter((p) => p.student_id === student.userId);

  for (const sub of mineOnly) {
    const title = sub.group_assignments?.title ?? sub.id;
    const photos = await me.attempt(`check photo evidence on "${title}"`, () => me.table('log_photos', 'select-by-submission', (q) => q.select('id').eq('submission_id', sub.id)));
    const docs = await me.attempt(`check document evidence on "${title}"`, () => me.table('log_documents', 'select-by-submission', (q) => q.select('id').eq('submission_id', sub.id)));
    const evidenceChecked = photos !== undefined && docs !== undefined;
    const hasEvidence = (photos && photos.length > 0) || (docs && docs.length > 0);
    if (evidenceChecked && !hasEvidence) {
      me.note(`"${title}" (${sub.id}) has zero photos and zero documents — no-evidence submission.`);
    }

    await withEmptyNoteFallback(me, `approve "${title}"`, (note) => me.reviewAssignment(sub.id, true, note, 2));
    reviewed.push({ submissionId: sub.id, approved: true, level: 2 });

    if (evidenceChecked && !hasEvidence) {
      me.bug({ did: `approve "${title}" with no evidence attached`, expected: 'refusal, or at least a warning', got: 'success — review_assignment approved a submission with zero photos and zero documents', severity: 'rough' });
    }
  }

  state.merge((st) => { Object.assign(st.mentors[P.slug], { reviewed, attendance: pendingDays.map((d) => d.id) }); });
  me.note('Faz 5 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
