/**
 * Unsaved text kept for the tab only (sessionStorage), so a reload or a crash does not lose what someone was typing.
 * Nothing leaves the browser, nothing outlives the tab, and a blocked or full store is simply ignored.
 */
const PREFIX = 'kadode.draft.';

export function loadDraft(key: string): string | null {
  try {
    return window.sessionStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function saveDraft(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(PREFIX + key, value);
  } catch {
    /* ignore */
  }
}

export function clearDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** "Discard and leave": every draft in this tab goes at once, before the page changes (not later, when it unmounts). */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) window.sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
