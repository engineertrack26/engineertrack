import type { MyAssignment } from '@/types/assignment';
import { taskState } from './studentTasks';

export interface AssignmentGroups {
  revise: MyAssignment[];
  todo: MyAssignment[];
  waiting: MyAssignment[];
  done: MyAssignment[];
}

/** A task the student has not acted on has NO submission row at all — the
 *  absence is the state, which is why there is no 'assigned' status in the
 *  database. Anything that reads a status field to decide "not started" is
 *  reading a value that never exists. */
export function groupAssignmentsByState(items: MyAssignment[]): AssignmentGroups {
  const out: AssignmentGroups = { revise: [], todo: [], waiting: [], done: [] };
  for (const item of items) {
    out[taskState(item)].push(item);
  }
  return out;
}
