import * as Crypto from 'expo-crypto';
import { pwnedCount, splitSha1 } from '@/utils/pwnedPasswords';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 4000;

/**
 * Leaked-password check, the same one Supabase's "leaked password
 * protection" runs server-side (a paid-plan toggle) — done on the phone
 * against Have I Been Pwned's free, key-less range API. Only 5 hex characters
 * of the SHA-1 leave the device. Fails OPEN: when the service is unreachable
 * the answer is `false`, because a breach lookup must never block sign-up.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, password);
    const { prefix } = splitSha1(hash);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(RANGE_URL + prefix, { headers: { 'Add-Padding': 'true' }, signal: controller.signal });
      if (!response.ok) return false;
      return pwnedCount(hash, await response.text()) > 0;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn('Leaked-password check skipped:', err instanceof Error ? err.message : err);
    return false;
  }
}
