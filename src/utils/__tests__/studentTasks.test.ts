import { filterTasks, isActionable, sortTasks, taskDueDate, taskState } from '../studentTasks';
import type { MyAssignment, SubmissionStatus } from '@/types/assignment';

function task(id: string, status?: SubmissionStatus, dueDate?: string): MyAssignment {
  return { id, title: id, groupId: 'g', tripletId: 't', objective: 'o', criterion: 'c', createdAt: '', dueDate,
    submission: status ? { id: 's', assignmentId: id, studentId: 'u', status, submittedAt: '' } : undefined };
}
describe('student task presentation', () => {
  it('prioritizes revisions, then dated to-dos, without mutating the source', () => {
    const items = [task('undated'), task('done', 'approved'), task('later', undefined, '2026-09-12'),
      task('revise', 'needs_revision', '2026-10-01'), task('earlier', undefined, '2026-09-11'), task('waiting', 'submitted')];
    expect(sortTasks(items).map(a => a.id)).toEqual(['revise', 'earlier', 'later', 'undated', 'waiting', 'done']);
    expect(items[0].id).toBe('undated');
  });
  it('only permits edits for to-do and revision states', () => {
    expect(isActionable(task('todo'))).toBe(true);
    expect(isActionable(task('revise', 'needs_revision'))).toBe(true);
    expect(isActionable(task('waiting', 'submitted'))).toBe(false);
    expect(isActionable(task('done', 'approved'))).toBe(false);
    expect(taskState(task('todo'))).toBe('todo');
  });
  it('combines locale-aware title / competency search with state filters', () => {
    const item = { ...task('İnceleme'), competencyName: 'Ölçüm' };
    expect(filterTasks([item], 'all', ' inceleme ', 'tr')).toEqual([item]);
    expect(filterTasks([item], 'todo', 'ölçüm', 'tr')).toEqual([item]);
    expect(filterTasks([item], 'done', '', 'tr')).toEqual([]);
  });
  it('formats a local calendar date and rejects invalid dates', () => {
    expect(taskDueDate('2026-09-11', 'en-US')).toBe(new Date(2026, 8, 11).toLocaleDateString('en-US'));
    expect(taskDueDate('2026-02-31', 'tr')).toBeUndefined();
    expect(taskDueDate(undefined, 'tr')).toBeUndefined();
    expect(taskDueDate('not-a-date', 'tr')).toBeUndefined();
  });
});
