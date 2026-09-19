import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import catalog from '@/i18n/kpi-content-tr.json';
import { kpiContent } from '../kpiContent';

const root = resolve(__dirname, '../../..');
const placeholders = (text: string) => [...text.matchAll(/\{\{(.*?)\}\}/g)].map((m) => m[1]).sort();
const value = (locale: unknown, key: string): string | undefined =>
  key.split('.').reduce<any>((node, part) => node?.[part], locale);

test.each(['advisor', 'advisorGroups', 'advisorMonitor', 'targetUi', 'taskFlow', 'closure'] as const)(
  '%s Turkish labels cover the English source, including plurals and placeholders', (namespace) => {
    for (const [key, source] of Object.entries(en[namespace])) {
      const translated = value(tr, namespace + '.' + key);
      expect({ key, translated }).toEqual({ key, translated: expect.any(String) });
      expect(translated?.trim()).not.toBe('');
      expect(placeholders(translated!)).toEqual(placeholders(source));
    }
  },
);

test('group screens and their shared cards have Turkish values for referenced interface labels', () => {
  const paths = ['groups', 'student-monitor', 'group-assignments', 'group-competencies'].map((name) => `app/(advisor)/${name}.tsx`);
  paths.push('src/components/cards/AssignmentCard.tsx',
    ...readdirSync(resolve(root, 'src/components/advisor')).filter((f) => f.endsWith('.tsx')).map((f) => 'src/components/advisor/' + f));
  for (const path of paths) {
    const source = readFileSync(resolve(root, path), 'utf8');
    for (const match of source.matchAll(/['"]([a-zA-Z]+\.[\w]+)['"]/g)) {
      const key = match[1];
      if (typeof value(en, key) !== 'string') continue;
      expect({ path, key, translated: value(tr, key) }).toEqual({ path, key, translated: expect.any(String) });
    }
  }
});

test('all 48 seeded KPI statements have nonempty Turkish translations', () => {
  const seed = readFileSync(resolve(root, 'docs/competency-framework-migration.sql'), 'utf8');
  const statements = [...seed.matchAll(/\('[a-z_]+', [1-4], [12], '((?:''|[^'])*)'\)/g)].map((m) => m[1].replace(/''/g, "'"));
  expect(statements).toHaveLength(48);
  expect(Object.keys(catalog).sort()).toEqual([...statements].sort());
  for (const statement of statements) {
    expect(kpiContent(statement, 'tr-TR').trim()).not.toBe('');
    expect(kpiContent(statement, 'tr')).not.toBe(statement);
    for (const language of ['en', 'de', 'it', 'ro', 'sr', 'el']) expect(kpiContent(statement, language)).toBe(statement);
  }
});

test('custom, revised and missing KPI statements are preserved safely', () => {
  expect(kpiContent('Custom learning target', 'tr')).toBe('Custom learning target');
  const revised = Object.keys(catalog)[0] + ' Revised';
  expect(kpiContent(revised, 'tr')).toBe(revised);
  expect(kpiContent(null, 'tr')).toBe('');
  expect(kpiContent(undefined, 'tr')).toBe('');
});

test('both group KPI views use display-only translation with the selected language', () => {
  const targets = readFileSync(resolve(root, 'app/(advisor)/group-competencies.tsx'), 'utf8');
  const tasks = readFileSync(resolve(root, 'app/(advisor)/group-assignments.tsx'), 'utf8');
  expect(targets).toContain('kpiContent(kpi.statement, i18n.language)');
  expect(tasks).toContain('kpiContent(group.statement, i18n.language)');
});
