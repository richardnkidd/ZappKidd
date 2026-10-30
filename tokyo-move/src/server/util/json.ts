/** Small JSON helpers: stable serialization for state comparison, plain-object checks, safe merging. */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Deterministic JSON (sorted object keys) so two structurally equal values serialize identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * "Merge one level": for each incoming key, if both the old and new values are plain objects the result is
 * `{...old, ...new}`; otherwise the new value replaces the old one. Prototype-polluting keys are rejected upstream
 * and skipped here defensively.
 */
export function mergeOneLevel(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const old = out[key];
    out[key] = isPlainObject(old) && isPlainObject(value) ? { ...old, ...value } : value;
  }
  return out;
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
