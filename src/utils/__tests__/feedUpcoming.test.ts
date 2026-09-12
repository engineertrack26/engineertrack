import { upcomingTasks } from '@/utils/feedUpcoming';

const today = new Date(2026, 8, 12); // 12 Sep 2026, local
const t = (id: string, dueDate?: string) => ({ id, title: id, dueDate });

describe('upcomingTasks', () => {
  it('keeps only tasks due within the window, nearest first', () => {
    const out = upcomingTasks([t('far', '2026-10-30'), t('soon', '2026-09-14'), t('today', '2026-09-12')], today);
    expect(out.map((x) => x.id)).toEqual(['today', 'soon']);
  });

  it('drops overdue tasks and tasks with no due date', () => {
    const out = upcomingTasks([t('late', '2026-09-11'), t('none'), t('ok', '2026-09-20')], today);
    expect(out.map((x) => x.id)).toEqual(['ok']);
  });

  it('includes the last day of the window and excludes the day after', () => {
    const out = upcomingTasks([t('edge', '2026-09-26'), t('past', '2026-09-27')], today);
    expect(out.map((x) => x.id)).toEqual(['edge']);
  });

  it('caps at three, keeping the nearest', () => {
    const out = upcomingTasks([t('d', '2026-09-16'), t('a', '2026-09-13'), t('c', '2026-09-15'), t('b', '2026-09-14')], today);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps input order on the same day', () => {
    const out = upcomingTasks([t('first', '2026-09-13'), t('second', '2026-09-13')], today);
    expect(out.map((x) => x.id)).toEqual(['first', 'second']);
  });

  it('ignores a malformed date rather than throwing', () => {
    expect(upcomingTasks([t('bad', '13/09/2026'), t('ok', '2026-09-13')], today).map((x) => x.id)).toEqual(['ok']);
  });
});
