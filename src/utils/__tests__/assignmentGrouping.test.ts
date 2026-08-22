import { groupAssignmentsByState } from '@/utils/assignmentGrouping';
import type { MyAssignment } from '@/types/assignment';

const base = {
  groupId: 'g', tripletId: 't', title: 'T', objective: 'O',
  criterion: 'C', createdAt: '2026-01-01',
};

function make(id: string, status?: 'submitted' | 'approved' | 'needs_revision'): MyAssignment {
  return {
    ...base,
    id,
    submission: status
      ? { id: `s-${id}`, assignmentId: id, studentId: 'me', status, submittedAt: '2026-01-02' }
      : undefined,
  };
}

describe('groupAssignmentsByState', () => {
  it('treats a missing submission as not started', () => {
    const out = groupAssignmentsByState([make('a')]);
    expect(out.todo.map((x) => x.id)).toEqual(['a']);
    expect(out.waiting).toHaveLength(0);
  });

  it('separates the three submission states', () => {
    const out = groupAssignmentsByState([
      make('a'), make('b', 'submitted'), make('c', 'approved'), make('d', 'needs_revision'),
    ]);
    expect(out.todo.map((x) => x.id)).toEqual(['a']);
    expect(out.waiting.map((x) => x.id)).toEqual(['b']);
    expect(out.done.map((x) => x.id)).toEqual(['c']);
    expect(out.revise.map((x) => x.id)).toEqual(['d']);
  });
});
