import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { competencyContent, TURKISH_COMPETENCY_NAMES } from '../competencyContent';
import { filterTasks } from '../studentTasks';

test('covers all six canonical competency names', () => {
  const seed = readFileSync(resolve(__dirname, '../../../docs/competency-framework-migration.sql'), 'utf8');
  const names = [...seed.matchAll(/\('[a-z_]+', '([^']+)', [1-6]\)/g)].map(match => match[1]);
  expect(names).toHaveLength(6);
  expect(names.sort()).toEqual(Object.keys(TURKISH_COMPETENCY_NAMES).sort());
});

test.each(['tr', 'tr-TR', 'TR', 'tr_TR'])('shows Turkish names for %s', language => {
  for (const [english, turkish] of Object.entries(TURKISH_COMPETENCY_NAMES)) {
    expect(competencyContent(english, language)).toBe(turkish);
  }
});

test.each(['en', 'de', 'it', 'ro', 'sr', 'el'])('keeps English names for %s', language => {
  for (const english of Object.keys(TURKISH_COMPETENCY_NAMES)) expect(competencyContent(english, language)).toBe(english);
});

test('unknown/custom names are not guessed and empty names are safe', () => {
  expect(competencyContent('Custom competency', 'tr')).toBe('Custom competency');
  expect(competencyContent('toString', 'tr')).toBe('toString');
  expect(competencyContent(undefined, 'tr')).toBe('');
  expect(competencyContent(null, 'tr')).toBe('');
});

test('Turkish search finds the competency without changing stored names', () => {
  const task = { id: 'a', groupId: 'g', tripletId: 't', title: 'Task', objective: '', criterion: '', createdAt: '',
    competencyName: 'Professional Communication' };
  expect(filterTasks([task], 'all', 'mesleki iletişim', 'tr')).toEqual([task]);
  expect(filterTasks([task], 'all', 'Professional Communication', 'tr')).toEqual([task]);
  expect(task.competencyName).toBe('Professional Communication');
});
