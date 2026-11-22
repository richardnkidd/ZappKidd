/** Every screen in the app, for specs that visit them all. Add new routes here as screens land. */
import type { Api } from './fixtures';

export interface RouteEntry {
  label: string;
  path: string;
}

/** A representative record of every type, so each record screen is covered. */
export async function recordRoutes(avery: Api): Promise<RouteEntry[]> {
  const snap = await avery.snapshot();
  const firstOfType = new Map<string, string>();
  for (const r of snap.records as { id: string; type: string; visibility: string }[]) {
    if (r.visibility === 'private') continue;
    if (!firstOfType.has(r.type)) firstOfType.set(r.type, r.id);
  }
  return [...firstOfType.entries()].map(([type, id]) => ({ label: `record (${type})`, path: `/r/${encodeURIComponent(id)}` }));
}

export const FIXED_ROUTES: RouteEntry[] = [
  { label: 'Home', path: '/' },
  { label: 'Plan: by workstream', path: '/plan?view=workstream' },
  { label: 'Plan: list', path: '/plan?view=list' },
  { label: 'Plan: board', path: '/plan?view=board' },
  { label: 'Plan: timeline', path: '/plan?view=timeline' },
  { label: 'Decide: decisions', path: '/decide' },
  { label: 'Decide: questions', path: '/decide/questions' },
  { label: 'Decide: risks', path: '/decide/risks' },
  { label: 'Money', path: '/money' },
  { label: 'More', path: '/more' },
  { label: 'Documents', path: '/documents' },
  { label: 'Contacts', path: '/contacts' },
  { label: 'Arrival', path: '/arrival' },
  { label: 'Future work', path: '/future' },
  { label: 'Data', path: '/data' },
  { label: 'Settings', path: '/settings' },
  { label: 'Ready: Avery', path: '/ready/avery' },
  { label: 'Ready: Mochi', path: '/ready/mochi' },
  { label: 'Contacts: evidence', path: '/contacts/evidence' },
  { label: 'Contacts: findings', path: '/contacts/findings' },
  { label: 'Couple review', path: '/review' },
  { label: 'What if', path: '/what-if' },
  { label: 'Arrival pack', path: '/arrival-pack' },
  { label: 'Not found', path: '/no-such-page' },
];

