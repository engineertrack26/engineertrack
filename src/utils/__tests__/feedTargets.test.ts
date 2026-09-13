import { postableGroups, summarisePost, type TargetGroup } from '@/utils/feedTargets';

// Deliberately not alphabetical: the helper must keep input order, and a
// sort-by-id implementation would fail the expectations below.
const groups: TargetGroup[] = [
  { id: 'd', name: 'Delta' },
  { id: 'b', name: 'Beta', isArchived: true },
  { id: 'a', name: 'Alpha' },
  { id: 'c', name: 'Gamma' },
];

describe('postableGroups', () => {
  it('puts the current group first', () => {
    expect(postableGroups(groups, 'c').map((g) => g.id)).toEqual(['c', 'd', 'a']);
  });

  it('drops archived groups that are not the current one', () => {
    expect(postableGroups(groups, 'a').map((g) => g.id)).not.toContain('b');
  });

  it('keeps the current group even when it is archived', () => {
    expect(postableGroups(groups, 'b').map((g) => g.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('keeps the input order for the rest', () => {
    expect(postableGroups(groups, 'a').map((g) => g.id)).toEqual(['a', 'd', 'c']);
  });

  it('returns just the non-archived rest when the current id is unknown', () => {
    expect(postableGroups(groups, 'zzz').map((g) => g.id)).toEqual(['d', 'a', 'c']);
  });

  it('returns an empty list for no groups', () => {
    expect(postableGroups([], 'a')).toEqual([]);
  });
});

describe('summarisePost', () => {
  it('counts ok outcomes and lists failed names in order', () => {
    expect(summarisePost([
      { groupId: 'a', name: 'Alpha', ok: true },
      { groupId: 'b', name: 'Beta', ok: false },
      { groupId: 'c', name: 'Gamma', ok: true },
      { groupId: 'd', name: 'Delta', ok: false },
    ])).toEqual({ ok: 2, failed: ['Beta', 'Delta'] });
  });

  it('reports all ok with no failures', () => {
    expect(summarisePost([
      { groupId: 'a', name: 'Alpha', ok: true },
      { groupId: 'c', name: 'Gamma', ok: true },
    ])).toEqual({ ok: 2, failed: [] });
  });

  it('returns zero ok and no failures for an empty list', () => {
    expect(summarisePost([])).toEqual({ ok: 0, failed: [] });
  });
});
