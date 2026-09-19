import turkish from '@/i18n/kpi-content-tr.json';

/** Display-only catalog translation. Custom/changed statements retain their source text. */
export function kpiContent(statement: string | null | undefined, language: string): string {
  if (!statement) return '';
  if (language.toLowerCase().split(/[-_]/)[0] !== 'tr') return statement;
  const key = statement.trim();
  return Object.hasOwn(turkish, key) ? turkish[key as keyof typeof turkish] : statement;
}
