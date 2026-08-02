/**
 * Consent is current only when the stored version matches the version the app
 * is shipping. Bumping PRIVACY_POLICY_VERSION invalidates every prior consent,
 * which is exactly how a policy update is rolled out.
 */
export function isConsentCurrent(
  stored: string | null | undefined,
  current: string,
): boolean {
  if (!stored) return false;
  return stored.trim() === current.trim();
}
