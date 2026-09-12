/** Keep malformed timestamps out of the UI and tolerate device clock skew. */
export function notificationTimeAgo(
  dateStr: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale: string,
  now = Date.now(),
): string {
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.floor(Math.max(0, now - then) / 60000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('time.daysAgo', { count: days });
  return new Date(dateStr).toLocaleDateString(locale);
}
