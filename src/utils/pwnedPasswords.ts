/**
 * Pure half of the leaked-password check (the network half is
 * `src/services/pwnedPasswords.ts`). Have I Been Pwned's range API takes the
 * first 5 hex characters of the password's SHA-1 and answers with every known
 * suffix under that prefix as `SUFFIX:COUNT` lines — the password itself never
 * leaves the phone (k-anonymity). With `Add-Padding` the response also carries
 * fake suffixes with a count of 0, which are not breaches.
 */
export function splitSha1(hashHex: string): { prefix: string; suffix: string } {
  const hex = hashHex.toUpperCase();
  return { prefix: hex.slice(0, 5), suffix: hex.slice(5) };
}

/** How many times the password appeared in breaches; 0 when it is not listed. */
export function pwnedCount(hashHex: string, rangeBody: string): number {
  const { suffix } = splitSha1(hashHex);
  for (const line of rangeBody.split(/\r?\n/)) {
    const [candidate, count] = line.trim().split(':');
    if (candidate === suffix) return Number(count) || 0;
  }
  return 0;
}
