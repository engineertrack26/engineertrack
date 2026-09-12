/** Bound the UI wait; callers must discard late results after timeout/unmount. */
export async function withAuthTimeout<T>(work: Promise<T>, milliseconds = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AUTH_STARTUP_TIMEOUT')), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Supabase awaits auth callbacks while holding its lock. A new macrotask
 * lets that callback return before a profile query requests the same lock. */
export function deferAuthWork(work: () => void): () => void {
  const timer = setTimeout(work, 0);
  return () => clearTimeout(timer);
}
