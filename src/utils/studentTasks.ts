import type { MyAssignment } from '@/types/assignment';
import { taskContent } from './taskContent';
import { competencyContent } from './competencyContent';

export type TaskState = 'revise' | 'todo' | 'waiting' | 'done';
export const TASK_STATES: TaskState[] = ['revise', 'todo', 'waiting', 'done'];
export const taskState = (a: MyAssignment): TaskState =>
  a.submission?.status === 'needs_revision' ? 'revise' :
  a.submission?.status === 'submitted' ? 'waiting' :
  a.submission?.status === 'approved' ? 'done' : 'todo';
export const taskStateKey = (state: TaskState) => `student.state${state[0].toUpperCase()}${state.slice(1)}`;
export const isActionable = (a: MyAssignment) => ['revise', 'todo'].includes(taskState(a));

export function sortTasks(items: MyAssignment[]): MyAssignment[] {
  return [...items].sort((a, b) =>
    TASK_STATES.indexOf(taskState(a)) - TASK_STATES.indexOf(taskState(b)) ||
    (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.id.localeCompare(b.id));
}

export function filterTasks(items: MyAssignment[], state: TaskState | 'all', query: string, locale: string) {
  const needle = query.trim().toLocaleLowerCase(locale);
  return sortTasks(items).filter(a => (state === 'all' || taskState(a) === state) &&
    `${taskContent(a.title, locale)} ${a.title} ${competencyContent(a.competencyName, locale)} ${a.competencyName || ''}`.toLocaleLowerCase(locale).includes(needle));
}

/** DATE values are calendar dates, not UTC instants. */
export function taskDueDate(value: string | undefined, locale: string): string | undefined {
  const match = value && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date.toLocaleDateString(locale);
}
