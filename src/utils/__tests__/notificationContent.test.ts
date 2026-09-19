import { notificationContent } from '../notificationContent';
import enTasks from '@/i18n/task-content/en.json';
import trTasks from '@/i18n/task-content/tr.json';
import type { NotificationType } from '@/types/notification';

const display = (type: NotificationType, title: string, body: string, language = 'tr') =>
  notificationContent({ type, title, body }, language);

test('persisted task notifications translate catalog titles without rewriting records', () => {
  const key = 'teamwork.1.1.1';
  const item = { type: 'task_assigned' as const, title: 'New Task Assigned', body: `A new task has been assigned: "${enTasks[key].task}".` };
  const snapshot = { ...item };
  expect(notificationContent(item, 'tr-TR')).toEqual({ title: 'Yeni görev atandı', body: `Yeni bir görev atandı: “${trTasks[key].task}”.` });
  expect(item).toEqual(snapshot);
  for (const lang of ['en', 'de', 'el', 'it', 'ro', 'sr']) expect(notificationContent(item, lang)).toEqual({ title: item.title, body: item.body });
});

test.each([
  ['task_submitted', 'Task Submitted', 'Ali submitted "Custom task" for review.', 'Ali, “Custom task” görevini incelemeye gönderdi.'],
  ['task_approved', 'Task Approved!', 'Ece approved your task "Custom task".', 'Ece, “Custom task” çalışmanı onayladı.'],
  ['task_revision_requested', 'Revision Requested', 'Ece requested revisions on your task "Custom task".', 'Ece, “Custom task” çalışmanda revizyon istedi.'],
  ['task_assigned', 'New Task Assigned', '4 new tasks have been assigned.', '4 yeni görev atandı.'],
  ['feed_announcement', 'New announcement', 'Ece posted: Keep this English text.', 'Ece paylaştı: Keep this English text.'],
  ['feed_poll', 'New poll', 'Your advisor asked: Which tool?', 'Danışmanın sordu: Which tool?'],
  ['feed_comment', 'New comment', 'Ali commented on your post.', 'Ali paylaşımına yorum yaptı.'],
  ['feed_task_post', 'New in the feed', 'Ali shared "Custom task".', 'Ali, “Custom task” görevini paylaştı.'],
  ['direct_message', 'Case opened', 'Ece opened a case thread with you.', 'Ece seninle bir konu görüşmesi başlattı.'],
  ['internship_log_submitted', 'Journal submitted', 'Ali submitted the journal for 2026-09-19', 'Ali, 2026-09-19 tarihli staj günlüğünü gönderdi.'],
  ['internship_attendance', 'Attendance decided', '3 day(s) marked partial (2026-09-17 to 2026-09-19)', '3 gün için katılım durumu: kısmi katılım (2026-09-17 – 2026-09-19).'],
  ['internship_feedback', 'Correction answered', 'Ali: 2 day(s) re-decided as present', 'Ali: 2 günün katılım durumu yeniden belirlendi: katıldı.'],
  ['internship_closed', 'Internship closed', 'Ece closed the internship. Records are now read-only; the report is available.', 'Ece stajı tamamladı. Kayıtlar artık salt okunur; rapor hazır.'],
  ['internship_reopened', 'Internship reopened', 'Ece reopened the internship: Keep this reason.', 'Ece stajı yeniden açtı: Keep this reason.'],
  ['level_up', 'Level Up!', 'Congratulations! You reached Level 3!', 'Tebrikler! 3. gelişim aşamasına ulaştın!'],
] as const)('%s system template preserves dynamic content', (type, title, body, expected) => {
  const result = display(type, title, body);
  expect(result.title).not.toBe(title);
  expect(result.body).toBe(expected);
});

test('message previews, mentor feedback and correction notes stay verbatim', () => {
  for (const [type, title] of [
    ['direct_message', 'New message'], ['internship_feedback', 'Feedback on your internship day'],
    ['internship_correction', 'Correction requested'],
  ] as const) {
    const body = 'Ali: Ece posted: Keep my exact words.\nSecond line.';
    expect(display(type, title, body).body).toBe(body);
    expect(display(type, title, body).title).not.toBe(title);
  }
});

test('unknown templates, custom titles and prototype keys are preserved safely', () => {
  expect(display('general', 'Custom', 'A new task has been assigned: "Example".'))
    .toEqual({ title: 'Custom', body: 'A new task has been assigned: "Example".' });
  expect(display('task_assigned', 'Custom title', '4 new tasks have been assigned.').body).toBe('4 new tasks have been assigned.');
  expect(display('task_assigned', 'New Task Assigned', 'Unknown server wording').body).toBe('Unknown server wording');
  expect(display('general', 'constructor', 'Custom').title).toBe('constructor');
});

test('badges and reminders use Turkish text without losing custom values', () => {
  expect(display('badge_earned', 'Badge Earned!', 'You earned the "first_task" badge! Keep up the great work!').body)
    .toBe('“İlk Görev” rozetini kazandın! Böyle devam et!');
  expect(display('badge_earned', 'Badge Earned!', 'You earned the "custom_badge" badge! Keep up the great work!').body)
    .toContain('custom_badge');
  expect(display('general', 'Task Reminder', 'Ece noticed you have not submitted a task recently. Please take a look at your tasks.').body)
    .toBe('Ece, bir süredir görev göndermediğini fark etti. Lütfen görevlerini kontrol et.');
});

test('already Turkish task templates still localize ready-catalog titles', () => {
  const key = 'teamwork.1.1.1';
  expect(display('task_approved', 'Görevin onaylandı', `Ece, “${enTasks[key].task}” çalışmanı onayladı.`).body)
    .toBe(`Ece, “${trTasks[key].task}” çalışmanı onayladı.`);
});
