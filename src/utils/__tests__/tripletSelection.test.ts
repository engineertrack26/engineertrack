import { assignedTripletIds, selectableTriplets } from '@/utils/tripletSelection';
import type { GroupAssignment, KpiTriplet } from '@/types/assignment';

function triplet(id: string, kpiId = 'k1', index = 0): KpiTriplet {
  return {
    id,
    kpiId,
    tripletIndex: index,
    objective: `objective ${id}`,
    task: `task ${id}`,
    criterion: `criterion ${id}`,
  };
}

function assignment(id: string, tripletId: string): GroupAssignment {
  return {
    id,
    groupId: 'g1',
    tripletId,
    title: `title ${id}`,
    objective: 'o',
    criterion: 'c',
    createdAt: '2026-09-08T00:00:00Z',
  };
}

describe('assignedTripletIds', () => {
  it('collects the triplet ids the group already carries', () => {
    const set = assignedTripletIds([assignment('a1', 't1'), assignment('a2', 't3')]);
    expect(set.has('t1')).toBe(true);
    expect(set.has('t3')).toBe(true);
    expect(set.has('t2')).toBe(false);
  });

  it('is empty for a group with no assignments', () => {
    expect(assignedTripletIds([]).size).toBe(0);
  });

  // Two assignments can point at the same triplet: there is no
  // UNIQUE (group_id, triplet_id) in the schema, so the duplicate this
  // function exists to prevent is already reachable in existing data.
  it('does not double-count a triplet assigned twice', () => {
    const set = assignedTripletIds([assignment('a1', 't1'), assignment('a2', 't1')]);
    expect(set.size).toBe(1);
  });
});

describe('selectableTriplets', () => {
  it('marks a triplet the group already has as not selectable', () => {
    const rows = selectableTriplets(
      [triplet('t1'), triplet('t2')],
      [assignment('a1', 't1')],
    );
    expect(rows).toEqual([
      { triplet: triplet('t1'), alreadyAssigned: true },
      { triplet: triplet('t2'), alreadyAssigned: false },
    ]);
  });

  it('keeps every triplet in the list rather than filtering the assigned ones out', () => {
    // The advisor needs to SEE that a task is already assigned. Dropping the
    // row would make the catalogue silently shorter than the ten the document
    // promises per KPI, and reads as missing content rather than as done work.
    const rows = selectableTriplets([triplet('t1')], [assignment('a1', 't1')]);
    expect(rows).toHaveLength(1);
  });

  it('preserves the order it was given', () => {
    const rows = selectableTriplets(
      [triplet('t3', 'k1', 2), triplet('t1', 'k1', 0), triplet('t2', 'k1', 1)],
      [],
    );
    expect(rows.map((r) => r.triplet.id)).toEqual(['t3', 't1', 't2']);
  });

  it('marks nothing when the group has no assignments', () => {
    const rows = selectableTriplets([triplet('t1'), triplet('t2')], []);
    expect(rows.every((r) => r.alreadyAssigned === false)).toBe(true);
  });
});
