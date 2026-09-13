// A warm-start URL can arrive before Expo Router mounts the recovery screen.
// Keep it in memory only; never log or persist credentials from a deep link.
let pending: string | null = null;
export function captureRecoveryLink(url: string) {
  try {
    const parsed = new URL(url);
    if (/(^|\/)reset-password\/?$/.test(`${parsed.hostname}${parsed.pathname}`)) pending = url;
  } catch { /* malformed links are handled by the recovery screen */ }
}
export function takeRecoveryLink() {
  const url = pending;
  pending = null;
  return url;
}
