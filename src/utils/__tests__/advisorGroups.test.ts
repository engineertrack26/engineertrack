import { filterAdvisorGroups, groupCenterRoute, groupWorkspaceRoute, selectAdvisorGroup } from '../advisorGroups';
import type { InternshipGroup } from '@/types/group';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const group = (id: string, name = id, isArchived = false, term?: string): InternshipGroup =>
  ({ id, name, isArchived, term, advisorId: 'advisor', joinCode: 'ABCDEF', createdAt: '', updatedAt: '' });
const groups = [group('archived', 'Old', true), group('active', 'İleri Staj', false, '2026 Yaz'), group('second', 'New')];

describe('advisor group navigation and search', () => {
  it('defaults to an active group rather than the first archived group', () => {
    expect(selectAdvisorGroup(groups, null)).toBe('active');
  });
  it('opens the explicitly requested group, including an archive', () => {
    expect(selectAdvisorGroup(groups, null, 'second')).toBe('second');
    expect(selectAdvisorGroup(groups, null, 'archived')).toBe('archived');
  });
  it('never silently substitutes another group for an inaccessible request', () => {
    expect(selectAdvisorGroup(groups, null, 'someone-elses-group')).toBeNull();
  });
  it('retains a subsequent manual selection instead of reverting to the entry group', () => {
    expect(selectAdvisorGroup(groups, 'second', 'active')).toBe('second');
  });
  it('handles removed groups and an empty group list', () => {
    expect(selectAdvisorGroup(groups, 'removed')).toBe('active');
    expect(selectAdvisorGroup([], null)).toBeNull();
  });
  it('separates active and archived groups without reordering the service result', () => {
    expect(filterAdvisorGroups(groups, false, '', 'tr').map((g) => g.id)).toEqual(['active', 'second']);
    expect(filterAdvisorGroups(groups, true, '', 'tr').map((g) => g.id)).toEqual(['archived']);
    expect(groups[0].id).toBe('archived');
  });
  it('searches Turkish names and terms, ignoring surrounding spaces', () => {
    expect(filterAdvisorGroups(groups, false, ' ileri ', 'tr').map((g) => g.id)).toEqual(['active']);
    expect(filterAdvisorGroups(groups, false, '2026', 'tr').map((g) => g.id)).toEqual(['active']);
    expect(filterAdvisorGroups(groups, false, 'missing', 'tr')).toEqual([]);
  });
  it.each(['student-monitor', 'group-assignments', 'group-competencies', 'reports', 'feed'] as const)(
    'preserves the group and logical parent for %s', (screen) => {
      expect(groupWorkspaceRoute(screen, 'g')).toEqual({ pathname: '/(advisor)/' + screen, params: { groupId: 'g', fromGroup: '1' } });
      expect(groupCenterRoute('g')).toEqual({ pathname: '/(advisor)/groups', params: { groupId: 'g' } });
    },
  );
});

const languages = ['en', 'tr', 'de', 'it', 'ro', 'sr', 'el'];
const resource = (lang: string) => JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/locales', lang + '.json'), 'utf8'));
const sources = ['GroupUI', 'GroupList', 'GroupCenter'].map((name) =>
  readFileSync(join(process.cwd(), 'src/components/advisor', name + '.tsx'), 'utf8')).join('\n');
const usedKeys = [...new Set([...sources.matchAll(/['"]((?:advisorGroups|common|notificationUi)\.[a-zA-Z]+)['"]/g)].map((m) => m[1]))];

it.each(languages)('has complete group UI translations and placeholders in %s', (lang) => {
  const data = resource(lang);
  const en = resource('en');
  expect(Object.keys(data.advisorGroups).sort()).toEqual(Object.keys(en.advisorGroups).sort());
  for (const key of usedKeys) {
    const [section, name] = key.split('.');
    expect(typeof data[section]?.[name]).toBe('string');
    expect(data[section][name].trim()).not.toBe('');
  }
  for (const key of Object.keys(en.advisorGroups)) {
    expect(data.advisorGroups[key].match(/\{\{\w+\}\}/g) ?? []).toEqual(en.advisorGroups[key].match(/\{\{\w+\}\}/g) ?? []);
  }
});
