/** Wrap a computation (usually a shared engine call) so a thrown error becomes a value the UI can render. */
export type Attempt<T> = { ok: true; value: T } | { ok: false; error: Error };

export function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export function valueOr<T>(a: Attempt<T> | undefined, fallback: T): T {
  return a && a.ok ? a.value : fallback;
}
