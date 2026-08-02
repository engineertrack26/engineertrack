/**
 * Normalises the admin's free-text domain field into the array stored in
 * institutions.allowed_email_domains. The authoritative match happens in
 * join_department_by_code; this only cleans up what the admin typed.
 */
export function normalizeDomainList(input: string): string[] {
  const parts = input.split(/[,;\n]/);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const domain = part.trim().toLowerCase().replace(/^@+/, '');
    if (!domain) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    result.push(domain);
  }

  return result;
}
