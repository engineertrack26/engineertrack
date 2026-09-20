// Phase 7b — Emre's late approval. Emre is Ayşe's mentor and (per his
// character in sim/people.cjs) left her fourth submission pending until the
// advisor's closure attempt forces the issue. Run between the two halves of
// 07-selin-aydin.cjs: after `07-selin-aydin.cjs a` hits the real
// PENDING_REVIEWS refusal, this script approves the remaining submission so
// `07-selin-aydin.cjs b` can close Ayşe for real.
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('emre-aksoy');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const mine = s.mentors['emre-aksoy'] || {};

  const pending = await me.attempt('list pending reviews', () => me.listPendingReviews());
  const target = (pending || []).find((sub) => sub.id === mine.leftPending);
  if (!target) {
    me.bug({ did: 'find the left-pending submission in listPendingReviews', expected: `submission ${mine.leftPending}`, got: `pending reviews seen: ${JSON.stringify((pending || []).map((p) => p.id))}`, severity: 'blocker' });
  } else {
    me.note(`found the left-pending submission: "${target.group_assignments ? target.group_assignments.title : target.id}".`);
    await me.attempt('approve the remaining submission (level 2)', () => me.reviewAssignment(target.id, true, 'Geç oldu, kusura bakma.', 2));
  }

  state.merge((st) => {
    st.mentors['emre-aksoy'].reviewed = (st.mentors['emre-aksoy'].reviewed || []).concat(
      target ? [{ submissionId: target.id, approved: true, level: 2, late: true }] : []
    );
    delete st.mentors['emre-aksoy'].leftPending;
  });
  me.note('Faz 7b bitti — geç onay tamamlandı.');
})().catch((e) => { console.error(e); process.exit(1); });
