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
