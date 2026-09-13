import { postableGroups, summarisePost, type TargetGroup } from '@/utils/feedTargets';

const groups: TargetGroup[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta', isArchived: true },
  { id: 'c', name: 'Gamma' },
  { id: 'd', name: 'Delta' },
];

describe('postableGroups', () => {
  it('puts the current group first', () => {
    expect(postableGroups(groups, 'c').map((g) => g.id)).toEqual(['c', 'a', 'd']);
  });

  it('drops archived groups that are not the current one', () => {
    expect(postableGroups(groups, 'a').map((g) => g.id)).not.toContain('b');
  });

  it('keeps the current group even when it is archived', () => {
    expect(postableGroups(groups, 'b').map((g) => g.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('keeps the input order for the rest', () => {
    expect(postableGroups(groups, 'd').map((g) => g.id)).toEqual(['d', 'a', 'c']);
  });

  it('returns just the non-archived rest when the current id is unknown', () => {
    expect(postableGroups(groups, 'zzz').map((g) => g.id)).toEqual(['a', 'c', 'd']);
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
