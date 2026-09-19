// Spec §2. Characters drive what each person does in phases 2–7.
const { slugify } = require('./actor.cjs');
const DOMAIN = 'sim.engineertrack.test';
function person(p) {
  const slug = slugify(p.name);
  return { slug, language: 'tr', email: `${slug.replace(/-/g, '.')}@${DOMAIN}`, password: `Sim-${p.firstName}-2026!`, ...p };
}
const ADVISOR = person({ name: 'Selin Aydın', firstName: 'Selin', lastName: 'Aydın', role: 'advisor', title: 'Doç. Dr.',
  character: 'Runs the group carefully: sets targets first, publishes six tasks, announces, polls, follows up, closes.' });
const STUDENTS = [
  { name: 'Elif Kaya', firstName: 'Elif', lastName: 'Kaya', gender: 'f', avatar: '02', company: 'Marmara Su ve Kanalizasyon İdaresi', department: 'Arıtma Tesisi İşletme',
    character: 'Meticulous: journal every day, evidence on every task, rates herself honestly.', mentorSlug: 'hakan-demir' },
  { name: 'Burak Şahin', firstName: 'Burak', lastName: 'Şahin', gender: 'm', avatar: '05', company: 'Ege Çevre Danışmanlık', department: 'ÇED ve İzin Birimi',
    character: 'Late: submits at the last moment, misses one day\'s journal, gets a revision and resubmits.', mentorSlug: 'ayca-yildiz' },
  { name: 'Zeynep Arslan', firstName: 'Zeynep', lastName: 'Arslan', gender: 'f', avatar: '03', company: 'Ankara Büyükşehir Belediyesi Çevre Koruma Dairesi', department: 'Hava Kalitesi Şubesi',
    character: 'Terse: short notes, forgets evidence once, turns stream sharing off on one task, tries to join the group twice.', mentorSlug: 'murat-koc' },
  { name: 'Mert Yılmaz', firstName: 'Mert', lastName: 'Yılmaz', gender: 'm', avatar: '07', company: 'İzmir Atık Yönetimi A.Ş.', department: 'Düzenli Depolama Sahası',
    character: 'Over-confident: rates himself 3 (independent) on everything; the mentor disagrees.', mentorSlug: 'gamze-ozturk' },
  { name: 'Ayşe Çelik', firstName: 'Ayşe', lastName: 'Çelik', gender: 'f', avatar: '01', company: 'Karadeniz ÇED ve Çevre Hizmetleri', department: 'Saha Ölçüm Ekibi',
    character: 'Quiet: does the work, never messages, never comments; her mentor leaves one submission pending.', mentorSlug: 'emre-aksoy' },
  { name: 'Can Doğan', firstName: 'Can', lastName: 'Doğan', gender: 'm', avatar: '08', company: 'DSİ 5. Bölge Su Kalitesi Laboratuvarı', department: 'Numune Analiz',
    character: 'Questioning: messages the advisor and the mentor, comments on every post, asks for a case thread.', mentorSlug: 'selin-kurt' },
  { name: 'Deniz Yıldırım', firstName: 'Deniz', lastName: 'Yıldırım', gender: 'f', avatar: '04', company: 'Boğaziçi Geri Dönüşüm Tesisleri', department: 'Ayrıştırma Hattı',
    character: 'Absent one day (excused), opens a past day with a reason, likes but rarely posts.', mentorSlug: 'oguz-ari' },
].map((s) => person({ ...s, role: 'student' }));
const MENTORS = [
  { name: 'Hakan Demir', firstName: 'Hakan', lastName: 'Demir', studentSlug: 'elif-kaya', style: 'Reviews promptly, approves with a two-line note.' },
  { name: 'Ayça Yıldız', firstName: 'Ayça', lastName: 'Yıldız', studentSlug: 'burak-sahin', style: 'Strict: sends work back once with a precise reason.' },
  { name: 'Murat Koç', firstName: 'Murat', lastName: 'Koç', studentSlug: 'zeynep-arslan', style: 'Approves everything, never writes a note.' },
  { name: 'Gamze Öztürk', firstName: 'Gamze', lastName: 'Öztürk', studentSlug: 'mert-yilmaz', style: 'Rates lower than the student, writes why.' },
  { name: 'Emre Aksoy', firstName: 'Emre', lastName: 'Aksoy', studentSlug: 'ayse-celik', style: 'Slow: leaves one submission pending until the closure attempt.' },
  { name: 'Selin Kurt', firstName: 'Selin', lastName: 'Kurt', studentSlug: 'can-dogan', style: 'Replies to everything, marks one day partial with a note.' },
  { name: 'Oğuz Arı', firstName: 'Oğuz', lastName: 'Arı', studentSlug: 'deniz-yildirim', style: 'Records the absence as excused, asks for a correction on one journal.' },
].map((m) => person({ ...m, role: 'mentor', company: STUDENTS.find((s) => s.slug === m.studentSlug).company }));
const ALL = [ADVISOR, ...STUDENTS, ...MENTORS];
const byRole = (role) => ALL.filter((p) => p.role === role);
const bySlug = (slug) => ALL.find((p) => p.slug === slug);
const mentorOf = (studentSlug) => MENTORS.find((m) => m.studentSlug === studentSlug);
const GROUP = { name: 'ÇEV 400 Staj — Güz 2026', term: 'Güz 2026' };
module.exports = { ADVISOR, STUDENTS, MENTORS, ALL, GROUP, byRole, bySlug, mentorOf, DOMAIN };
