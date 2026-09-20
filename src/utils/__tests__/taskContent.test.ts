import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import english from '@/i18n/task-content/en.json';
import turkish from '@/i18n/task-content/tr.json';
import { createTaskContentTranslator, taskContent, taskContentEdit } from '../taskContent';
import { filterTasks } from '../studentTasks';
import { filterReviews } from '../mentorReviews';
import type { MyAssignment } from '@/types/assignment';

const fields = ['objective', 'task', 'criterion'] as const;
const entries = Object.entries(english);
const example = entries[0][1];
const translated = turkish as Record<string, Partial<typeof example>>;

describe('complete Turkish task catalogue', () => {
  test('all 480 triplets and 1,440 fields have separate Turkish translations', () => {
    expect(entries).toHaveLength(480);
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
    for (const [id, row] of entries) for (const field of fields) {
      expect(typeof translated[id]?.[field]).toBe('string');
      expect(translated[id]?.[field]?.trim().length).toBeGreaterThan(0);
      expect(translated[id]?.[field]).not.toBe(row[field]);
    }
  });
  test('English remains an exact copy of the canonical SQL source', () => {
    const sql = readFileSync(resolve(__dirname, '../../../docs/task-triplets-migration.sql'), 'utf8');
    const parsed = {} as Record<string, typeof example>;
    const pattern = /^\s*\('((?:[^']|'')*)', (\d+), (\d+), (\d+), '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)'\)[,]?\r?$/gm;
    for (const match of sql.matchAll(pattern)) {
      parsed[match.slice(1, 5).join('.')] = {
        objective: match[5].replace(/''/g, "'"), task: match[6].replace(/''/g, "'"), criterion: match[7].replace(/''/g, "'"),
      };
    }
    expect(english).toEqual(parsed);
  });
  test.each(['tr', 'tr-TR', 'TR', 'tr_TR'])('%s displays Turkish', language => {
    for (const field of fields) expect(taskContent(example[field], language, field)).toBe(translated[entries[0][0]][field]);
  });
  test.each(['en', 'en-GB', 'de', 'it', 'ro', 'sr', 'el', 'fr', ''])('%s keeps English', language => {
    for (const field of fields) expect(taskContent(example[field], language, field)).toBe(example[field]);
  });
  test('changing languages repeatedly does not mutate the source', () => {
    const before = JSON.stringify(english);
    expect(taskContent(example.task, 'tr')).not.toBe(example.task);
    expect(taskContent(example.task, 'en')).toBe(example.task);
    expect(JSON.stringify(english)).toBe(before);
  });
  test('updated, custom, empty and partially matching texts remain untouched', () => {
    for (const text of ['', 'Advisor tarafından yazılmış özel görev.', example.task + ' Extra instruction.', example.task.slice(0, 40)]) {
      expect(taskContent(text, 'tr')).toBe(text);
    }
    expect(taskContent(example.criterion, 'tr', 'task')).toBe(example.criterion);
  });
  test('a trailing parenthesised tag keeps the translation and the tag', () => {
    expect(taskContent(example.task + ' (revize)', 'tr')).toBe(translated[entries[0][0]].task + ' (revize)');
    expect(taskContent(example.task + '(v2)', 'tr')).toBe(translated[entries[0][0]].task + ' (v2)');
    expect(taskContent(example.task + ' (revize)', 'en')).toBe(example.task + ' (revize)');
    expect(taskContent('Custom (revize)', 'tr')).toBe('Custom (revize)');
  });
  test('missing translations fall back field by field to English', () => {
    const translate = createTaskContentTranslator({ one: example }, { one: { task: 'Görev' } });
    expect(translate(example.task, 'tr')).toBe('Görev');
    expect(translate(example.criterion, 'tr', 'criterion')).toBe(example.criterion);
    expect(translate('Unknown source', 'tr')).toBe('Unknown source');
    expect(createTaskContentTranslator({ one: example }, { one: { task: '  ' } })(example.task, 'tr')).toBe(example.task);
  });
  test('no ambiguous duplicate source text has inconsistent Turkish translations', () => {
    for (const field of fields) {
      const seen = new Map<string, string>();
      for (const [id, row] of entries) {
        const tr = translated[id]?.[field];
        if (!tr) continue;
        if (seen.has(row[field].trim())) expect(tr.trim()).toBe(seen.get(row[field].trim()));
        seen.set(row[field].trim(), tr.trim());
      }
    }
  });
  test('privacy masking instructions are not mistranslated as ordinary editing', () => {
    for (const [id, row] of entries) for (const field of fields) {
      if (/redacted/i.test(row[field])) expect(translated[id][field]).toContain('hassas bilgileri gizlenmiş');
    }
  });
  test('numeric thresholds, durations and reference numbering are preserved', () => {
    // These two reviewed phrases spell out numeric idioms in natural Turkish.
    const spelledOut = new Set(['teamwork.2.1.9.criterion', 'teamwork.3.1.1.task']);
    for (const [id, row] of entries) for (const field of fields) {
      if (spelledOut.has(`${id}.${field}`)) continue;
      const numbers = (text: string) => (text.match(/\d+/g) || []).sort();
      expect(numbers(translated[id][field] || '')).toEqual(numbers(row[field]));
    }
  });
});

describe('display/write separation', () => {
  test.each(fields)('unchanged/restored %s form value keeps its English source', field => {
    expect(taskContentEdit(example[field], taskContent(example[field], 'tr', field), 'tr', field)).toBe(example[field]);
    expect(taskContentEdit(example[field], 'Özel düzenleme', 'tr', field)).toBe('Özel düzenleme');
    expect(taskContentEdit(example[field], '', 'tr', field)).toBe('');
  });
  const assignment: MyAssignment = { id: 'a', groupId: 'g', tripletId: 't', title: example.task,
    objective: example.objective, criterion: example.criterion, createdAt: '2026-09-18' };
  test('student search finds both Turkish display and English source without mutating records', () => {
    expect(filterTasks([assignment], 'all', taskContent(example.task, 'tr'), 'tr')).toEqual([assignment]);
    expect(filterTasks([assignment], 'all', example.task, 'tr')).toEqual([assignment]);
    expect(assignment.title).toBe(example.task);
  });
  test('mentor search finds the translated task while keeping assignment identity', () => {
    const item = { id: 's', assignmentId: 'a', studentId: 'u', status: 'submitted' as const, submittedAt: '2026-09-18', assignment };
    expect(filterReviews([item], { u: 'Student' }, taskContent(example.task, 'tr'), 'oldest', 'tr')).toEqual([item]);
  });
});
