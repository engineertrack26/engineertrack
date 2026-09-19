import type { AppNotification, NotificationType } from '@/types/notification';
import { taskContent } from './taskContent';
import { BADGES } from '@/types/gamification';
import tr from '@/i18n/locales/tr.json';

// Display-only compatibility for persisted English system notifications.
// Match both type and exact known wording; never translate arbitrary user text.
const titles: Partial<Record<NotificationType, Record<string, string>>> = {
  task_assigned: { 'New Task Assigned': 'Yeni görev atandı' },
  task_submitted: { 'Task Submitted': 'Görev incelemeye gönderildi' },
  task_approved: { 'Task Approved!': 'Görevin onaylandı' },
  task_revision_requested: { 'Revision Requested': 'Görevin için revizyon istendi' },
  feed_announcement: { 'New announcement': 'Yeni duyuru' },
  feed_poll: { 'New poll': 'Yeni anket' },
  feed_comment: { 'New comment': 'Yeni yorum' },
  feed_task_post: { 'New in the feed': 'Akışta yeni paylaşım' },
  direct_message: { 'New message': 'Yeni mesaj', 'Case opened': 'Konu görüşmesi açıldı' },
  internship_log_submitted: { 'Journal submitted': 'Staj günlüğü gönderildi' },
  internship_attendance: { 'Attendance decided': 'Katılım durumu belirlendi' },
  internship_correction: { 'Correction requested': 'Düzeltme istendi' },
  internship_feedback: {
    'Correction answered': 'Düzeltme talebi yanıtlandı',
    'Feedback on your internship day': 'Staj günün için geri bildirim',
  },
  internship_closed: { 'Internship closed': 'Staj tamamlandı' },
  internship_reopened: { 'Internship reopened': 'Staj yeniden açıldı' },
  level_up: { 'Level Up!': 'Yeni gelişim aşaması!' },
  badge_earned: { 'Badge Earned!': 'Rozet kazandın!' },
  general: { 'Task Reminder': 'Görev hatırlatması' },
};

const attendance: Record<string, string> = {
  present: 'katıldı', partial: 'kısmi katılım', absent: 'katılmadı', excused: 'mazeretli',
};
const fallbackActors: Record<string, string> = {
  'A student': 'Bir öğrenci', 'Your advisor': 'Danışmanın', 'The advisor': 'Danışman', 'Someone': 'Bir kullanıcı',
};
const actor = (name: string) => Object.hasOwn(fallbackActors, name) ? fallbackActors[name] : name;
function badgeName(key: string): string {
  const badge = BADGES.find(b => b.key === key);
  let value: unknown = tr;
  for (const part of badge?.nameKey.split('.') ?? []) {
    value = value && typeof value === 'object' && Object.hasOwn(value, part)
      ? (value as Record<string, unknown>)[part] : undefined;
  }
  return typeof value === 'string' ? value : key;
}

export function notificationContent(item: Pick<AppNotification, 'type' | 'title' | 'body'>, language: string) {
  const original = { title: item.title, body: item.body };
  if (language.toLowerCase().split(/[-_]/)[0] !== 'tr') return original;
  const known = titles[item.type];
  if (!known || (!Object.hasOwn(known, item.title) && !Object.values(known).includes(item.title))) return original;
  const title = known && Object.hasOwn(known, item.title) ? known[item.title] : item.title;
  const task = (value: string) => value === 'a task' ? 'bir görev' : taskContent(value, language);
  let body = item.body;
  // Each pattern is anchored to the complete system template. Captured names,
  // message previews, notes and custom task titles remain untouched.
  switch (item.type) {
    case 'task_assigned':
      body = body.replace(/^A new task has been assigned: "([\s\S]*)"\.$/, (_, value) => `Yeni bir görev atandı: “${task(value)}”.`)
        .replace(/^(\d+) new tasks have been assigned\.$/, '$1 yeni görev atandı.')
        .replace(/^Yeni bir görev atandı: “([\s\S]*)”\.$/, (_, value) => `Yeni bir görev atandı: “${task(value)}”.`);
      break;
    case 'task_submitted':
      body = body.replace(/^(.+) submitted "([\s\S]*)" for review\.$/, (_, name, value) => `${actor(name)}, “${task(value)}” görevini incelemeye gönderdi.`);
      break;
    case 'task_approved':
      body = body.replace(/^(.+) approved your task "([\s\S]*)"\.$/, (_, name, value) => `${actor(name)}, “${task(value)}” çalışmanı onayladı.`)
        .replace(/^(.+), “([\s\S]*)” çalışmanı onayladı\.$/, (_, name, value) => `${name}, “${task(value)}” çalışmanı onayladı.`);
      break;
    case 'task_revision_requested':
      body = body.replace(/^(.+) requested revisions on your task "([\s\S]*)"\.$/, (_, name, value) => `${actor(name)}, “${task(value)}” çalışmanda revizyon istedi.`)
        .replace(/^(.+), “([\s\S]*)” çalışmanda revizyon istedi\.$/, (_, name, value) => `${name}, “${task(value)}” çalışmanda revizyon istedi.`);
      break;
    case 'feed_announcement':
      body = body.replace(/^(.+?) posted: ([\s\S]*)$/, (_, name, preview) => `${actor(name)} paylaştı: ${preview}`);
      break;
    case 'feed_poll':
      body = body.replace(/^(.+?) asked: ([\s\S]*)$/, (_, name, preview) => `${actor(name)} sordu: ${preview}`);
      break;
    case 'feed_comment':
      body = body.replace(/^(.+) commented on your post\.$/, (_, name) => `${actor(name)} paylaşımına yorum yaptı.`);
      break;
    case 'feed_task_post':
      body = body.replace(/^(.+) shared "([\s\S]*)"\.$/, (_, name, value) => `${actor(name)}, “${task(value)}” görevini paylaştı.`);
      break;
    case 'direct_message':
      // A message may itself contain system-like English text. Do not rewrite it.
      if (item.title === 'Case opened') body = body.replace(/^(.+) opened a case thread with you\.$/, (_, name) => `${actor(name)} seninle bir konu görüşmesi başlattı.`);
      break;
    case 'internship_log_submitted':
      body = body.replace(/^(.*) submitted the journal for (\d{4}-\d{2}-\d{2})$/, (_, name, date) => `${actor(name)}, ${date} tarihli staj günlüğünü gönderdi.`);
      break;
    case 'internship_attendance':
      body = body.replace(/^(\d+) day\(s\) marked (present|partial|absent|excused) \((\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\)$/, (_, count, status, start, end) => `${count} gün için katılım durumu: ${attendance[status]} (${start} – ${end}).`);
      break;
    case 'internship_feedback':
      if (item.title === 'Correction answered') body = body.replace(/^(.*): (\d+) day\(s\) re-decided as (present|partial|absent|excused)$/, (_, name, count, status) => `${name}: ${count} günün katılım durumu yeniden belirlendi: ${attendance[status]}.`);
      break;
    case 'internship_closed':
      body = body.replace(/^(.+) closed the internship\. Records are now read-only; the report is available\.$/, (_, name) => `${actor(name)} stajı tamamladı. Kayıtlar artık salt okunur; rapor hazır.`);
      break;
    case 'internship_reopened':
      body = body.replace(/^(.+?) reopened the internship: ([\s\S]*)$/, (_, name, reason) => `${actor(name)} stajı yeniden açtı: ${reason}`);
      break;
    case 'level_up':
      body = body.replace(/^Congratulations! You reached Level (\d+)!$/, 'Tebrikler! $1. gelişim aşamasına ulaştın!');
      break;
    case 'badge_earned':
      body = body.replace(/^You earned the "(.+)" badge! Keep up the great work!$/, (_, key) => `“${badgeName(key)}” rozetini kazandın! Böyle devam et!`);
      break;
    case 'general':
      if (item.title === 'Task Reminder') body = body.replace(/^(.+) noticed you have not submitted a task recently\. Please take a look at your tasks\.$/, (_, name) => `${name}, bir süredir görev göndermediğini fark etti. Lütfen görevlerini kontrol et.`);
      break;
  }
  return { title, body };
}
