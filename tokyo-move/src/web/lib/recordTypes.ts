import type { RecordType } from '@shared/types';

/** Plain names for record types (used by export and the Data screen). */
export const RECORD_TYPES: { type: RecordType; label: string }[] = [
  { type: 'milestone', label: 'Plan items' },
  { type: 'workstream', label: 'Workstreams' },
  { type: 'decision', label: 'Decisions' },
  { type: 'question', label: 'Questions' },
  { type: 'risk', label: 'Risks and issues' },
  { type: 'document', label: 'Documents' },
  { type: 'cost', label: 'Cost lines' },
  { type: 'funding', label: 'Cash, income and rates' },
  { type: 'arrival', label: 'Arrival checks' },
  { type: 'horizon', label: 'Longer-term items' },
  { type: 'future_option', label: 'Future work' },
  { type: 'evidence', label: 'Evidence' },
  { type: 'contact', label: 'Contacts' },
  { type: 'inventory', label: 'Belongings' },
  { type: 'property', label: 'Property' },
  { type: 'anchor', label: 'Travel dates' },
  { type: 'deadline_rule', label: 'Date rules' },
  { type: 'existing_commitment', label: 'Existing commitments' },
  { type: 'finding', label: 'Plan review findings' },
  { type: 'note', label: 'Notes' },
  { type: 'review_session', label: 'Couple reviews' },
];

export const RECORD_TYPE_LABEL: Record<string, string> = Object.fromEntries(RECORD_TYPES.map((t) => [t.type, t.label]));
