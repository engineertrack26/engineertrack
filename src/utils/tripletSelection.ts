import type { GroupAssignment, KpiTriplet } from '@/types/assignment';

/** One row of the advisor's triplet picker: the task itself, plus whether the
 *  group already carries an assignment for it. */
export interface SelectableTriplet {
  triplet: KpiTriplet;
  alreadyAssigned: boolean;
}

/** The triplets a group has already been assigned.
 *
 *  There is no UNIQUE (group_id, triplet_id) on group_assignments, so nothing
 *  in the database stops the same task being assigned to the same group twice.
 *  With the old one-at-a-time picker that took deliberate effort; with
 *  multi-select it is one stray tap, so the guard lives here and the picker
 *  reads it. */
export function assignedTripletIds(assignments: GroupAssignment[]): Set<string> {
  return new Set(assignments.map((a) => a.tripletId));
}

/** Annotate the picker's rows without reordering or removing any.
 *
 *  Assigned triplets stay in the list, greyed rather than dropped: the advisor
 *  needs to see that a task is already out there. Filtering them away would
 *  make each KPI's catalogue silently shorter than the ten the framework
 *  promises, which reads as missing content rather than as work already done. */
export function selectableTriplets(
  triplets: KpiTriplet[],
  assignments: GroupAssignment[],
): SelectableTriplet[] {
  const taken = assignedTripletIds(assignments);
  return triplets.map((triplet) => ({
    triplet,
    alreadyAssigned: taken.has(triplet.id),
  }));
}
