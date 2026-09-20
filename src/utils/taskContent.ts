import english from '@/i18n/task-content/en.json';
import turkish from '@/i18n/task-content/tr.json';

export type TaskContentField = 'task' | 'objective' | 'criterion';
type Catalog = Record<string, Partial<Record<TaskContentField, string>>>;

/** Text identity is intentional: UUIDs differ between installations and assigned
 * tasks are editable snapshots. Never translate a changed snapshot by triplet ID.
 * Only whole-field matches with the canonical English source are eligible.
 */
export function createTaskContentTranslator(source: Catalog, translated: Catalog) {
  const lookup = { task: new Map<string, string>(), objective: new Map<string, string>(), criterion: new Map<string, string>() };
  for (const [id, row] of Object.entries(source)) {
    for (const field of ['task', 'objective', 'criterion'] as const) {
      const en = row[field]?.trim();
      const tr = translated[id]?.[field]?.trim();
      if (en && tr) lookup[field].set(en, tr);
    }
  }
  return (text: string, language: string, field: TaskContentField = 'task'): string => {
    if (language.toLowerCase().split(/[-_]/)[0] !== 'tr') return text;
    const trimmed = text.trim();
    const whole = lookup[field].get(trimmed);
    if (whole) return whole;
    // Simulation finding #15: an advisor marking a catalogue task with a
    // parenthesised tag ("… (revize)") should not lose the whole translation.
    // Only a trailing "(…)" qualifies; any other edit is a changed snapshot
    // and stays verbatim, as the header comment says.
    const tag = /^(.*?)\s*(\([^()]*\))$/.exec(trimmed);
    if (tag) {
      const base = lookup[field].get(tag[1].trim());
      if (base) return `${base} ${tag[2]}`;
    }
    return text;
  };
}

/** Display only. Never replace the raw fields in service/store/write payloads. */
export const taskContent = createTaskContentTranslator(english, turkish);

/** An untouched (or restored) translated form value must still save English.
 * Actual edits remain verbatim user content, in whichever language was entered.
 */
export function taskContentEdit(source: string, input: string, language: string, field: TaskContentField = 'task'): string {
  return input.trim() === taskContent(source, language, field).trim() ? source : input;
}
