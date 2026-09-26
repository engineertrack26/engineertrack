import { competencyContent } from './competencyContent';
import { taskContent } from './taskContent';
import type { StudentInternshipBook } from '@/services/studentInternshipBook';

type Label = (key: string) => string;
const escapeHtml = (value: string | number | null | undefined): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Printable personal record. Dynamic text is escaped and draft journal content is never rendered. */
export function studentInternshipBookHtml(
  book: StudentInternshipBook, language: string, label: Label, generatedAt = new Date(),
): string {
  const t = (key: string) => escapeHtml(label(`studentBook.${key}`));
  const e = escapeHtml;
  const date = (value: string | null | undefined) => value
    ? e(new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(language)) : '—';
  const dateTime = (value: string | null | undefined) => value
    ? e(new Date(value).toLocaleString(language)) : '—';
  const text = (value: string | null | undefined) => value?.trim() ? e(value) : '—';
  const detail = (key: string, value: string | number | null | undefined) =>
    `<div class="detail"><span>${t(key)}</span><strong>${value == null || value === '' ? '—' : e(value)}</strong></div>`;
  const field = (key: string, value: string | null | undefined) => value?.trim()
    ? `<div class="field"><b>${t(key)}</b><p>${e(value)}</p></div>` : '';
  const attendance = (status: string) => t(`attendance_${status}`);
  const taskStatus = (status: string) => t(`task_${status}`);
  const days = [...book.days].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const tasks = [...book.tasks].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id));
  const submittedDays = days.filter(d => d.logStatus === 'submitted').length;
  const presentDays = days.filter(d => d.attendance === 'present').length;
  const approvedTasks = tasks.filter(a => a.status === 'approved').length;

  return `<!DOCTYPE html><html lang="${e(language)}"><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page { size: A4; margin: 15mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #172337; font-size: 10.5pt; line-height: 1.45; }
    h1, h2, h3, p { margin: 0; } h1 { font-size: 24pt; color: #173e70; margin: 12px 0 6px; }
    h2 { font-size: 15pt; color: #173e70; margin: 0 0 12px; border-bottom: 2px solid #d7e4f0; padding-bottom: 5px; }
    h3 { font-size: 11.5pt; margin-bottom: 5px; } .brand { font-size: 10pt; letter-spacing: 2px; color: #2173af; font-weight: bold; }
    .muted { color: #586575; } .cover { padding: 12px 0 20px; } .sub { font-size: 12pt; margin-bottom: 14px; }
    .note { background: #edf4fa; border-left: 4px solid #2173af; padding: 10px 12px; margin: 14px 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 18px; margin: 14px 0; }
    .detail { border-bottom: 1px solid #e3e8ee; padding: 5px 0; }
    .detail span { display: block; font-size: 8pt; color: #5b6776; } .detail strong { font-weight: 600; }
    .stats { display: flex; gap: 8px; margin: 18px 0; } .stat { flex: 1; background: #eff5fb; padding: 10px; border-radius: 5px; }
    .stat b { display: block; font-size: 18pt; color: #173e70; } .stat span { font-size: 8pt; }
    section { margin: 22px 0; } article { border: 1px solid #dde5ec; border-radius: 6px; padding: 11px 13px; margin: 0 0 11px; break-inside: avoid; page-break-inside: avoid; }
    .meta { color: #576476; font-size: 9pt; margin: 2px 0 8px; }
    .pill { display: inline-block; background: #eaf2fa; color: #173e70; padding: 2px 7px; border-radius: 9px; margin-right: 5px; font-size: 8pt; }
    .field { margin: 8px 0 0; } .field b { display: block; color: #42546a; font-size: 8.5pt; }
    .field p { white-space: pre-wrap; overflow-wrap: anywhere; }
    .empty { color: #66717e; font-style: italic; } .small { font-size: 8pt; }
  </style></head><body>
  <div class="cover"><div class="brand">ENGINEERTRACK</div><h1>${t('title')}</h1>
    <p class="sub">${e(book.student.name)}</p><p class="muted">${t('generatedAt')}: ${dateTime(generatedAt.toISOString())}</p>
    <div class="note">${t('disclaimer')}</div>
    <div class="grid">
      ${detail('studentNumber', book.student.studentNumber)}${detail('university', book.student.university)}
      ${detail('department', book.student.department)}${detail('company', book.student.company)}
      ${detail('startDate', date(book.student.startDate))}${detail('endDate', date(book.student.endDate))}
    </div>
    <div class="stats">
      <div class="stat"><b>${days.length}</b><span>${t('recordedDays')}</span></div>
      <div class="stat"><b>${presentDays}</b><span>${t('presentDays')}</span></div>
      <div class="stat"><b>${submittedDays}</b><span>${t('submittedJournals')}</span></div>
      <div class="stat"><b>${approvedTasks}</b><span>${t('approvedTasks')}</span></div>
    </div>
  </div>
  <section><h2>${t('groups')}</h2>${book.groups.length ? book.groups.map(g => `<article>
    <h3>${e(g.name)}</h3><p class="meta">${text(g.term)}</p>
    <div class="grid">${detail('advisor', g.advisor)}${detail('joinedAt', dateTime(g.joinedAt))}
      ${detail('leftAt', g.leftAt ? dateTime(g.leftAt) : label('studentBook.current'))}</div>
  </article>`).join('') : `<p class="empty">${t('noGroups')}</p>`}</section>
  <section><h2>${t('placements')}</h2>${book.placements.length ? book.placements.map(p => `<article>
    <h3>${e(p.company)}</h3><div class="grid">${detail('mentor', p.mentor)}
      ${detail('startDate', date(p.startDate))}${detail('endDate', date(p.endDate))}</div>
  </article>`).join('') : `<p class="empty">${t('noPlacements')}</p>`}</section>
  <section><h2>${t('competencies')}</h2><p class="meta">${t('competencyNote')}</p>
    ${book.competencies.length ? book.competencies.map(c => `<article><h3>${e(competencyContent(c.name, language))}</h3>
      <p class="meta">${e(c.groupName)} · ${t('targetLevel')}: ${e(c.targetLevel)} · ${t('reachedLevel')}: ${e(c.reachedLevel)}</p>
    </article>`).join('') : `<p class="empty">${t('noCompetencies')}</p>`}</section>
  <section><h2>${t('tasks')}</h2>${tasks.length ? tasks.map(a => `<article>
    <h3>${e(taskContent(a.title, language))}</h3>
    <p class="meta">${e(a.groupName)} · ${dateTime(a.submittedAt)} · <span class="pill">${taskStatus(a.status)}</span></p>
    ${field('objective', taskContent(a.objective, language, 'objective'))}
    ${field('criterion', taskContent(a.criterion, language, 'criterion'))}
    ${field('description', a.description)}${field('studentNote', a.studentNote)}
    ${field('reflection', a.reflection)}${field('reviewerNote', a.reviewerNote)}
    <div class="grid">${detail('reviewedBy', a.reviewedBy)}${detail('reviewedAt', a.reviewedAt ? dateTime(a.reviewedAt) : '')}</div>
    <p class="meta">${t('selfLevel')}: ${a.selfLevel ?? '—'} · ${t('reviewerLevel')}: ${a.reviewerLevel ?? '—'}</p>
  </article>`).join('') : `<p class="empty">${t('noTasks')}</p>`}</section>
  <section><h2>${t('days')}</h2><p class="meta">${t('daysNote')}</p>
    ${days.length ? days.map(d => `<article><h3>${date(d.date)} · ${e(d.company)}</h3>
      <p class="meta"><span class="pill">${attendance(d.attendance)}</span>
        <span class="pill">${d.logStatus === 'submitted' ? t('journalSubmitted') : t('journalNotSubmitted')}</span></p>
      <div class="grid">${detail('checkInAt', d.checkInAt ? dateTime(d.checkInAt) : '')}
        ${detail('decidedBy', d.decidedBy)}${detail('decidedAt', d.decidedAt ? dateTime(d.decidedAt) : '')}</div>
      ${field('attendanceNote', d.attendanceNote)}
      ${d.correctionRequested ? `<p class="meta">${t('correctionRequested')}</p>` : ''}
      ${d.logStatus === 'submitted' ? `${field('taskTitle', d.taskTitle ? taskContent(d.taskTitle, language) : null)}
        ${field('competency', d.competencyName ? competencyContent(d.competencyName, language) : null)}
        ${field('experience', d.experience)}${field('learning', d.learning)}${field('nextStep', d.nextStep)}
        ${d.supportLevel != null ? `<p class="meta">${t('supportLevel')}: ${e(d.supportLevel)}</p>` : ''}
        ${field('attachmentName', d.attachmentName)}` : ''}
    </article>`).join('') : `<p class="empty">${t('noDays')}</p>`}</section>
  <p class="muted small">${t('footer')}</p></body></html>`;
}
