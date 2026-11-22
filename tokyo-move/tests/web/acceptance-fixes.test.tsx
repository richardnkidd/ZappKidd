import { describe, expect, it } from 'vitest';
import { realHolderOf } from '../../src/web/screens/documents/Documents';
import { zonePhrase } from '../../src/web/screens/settings/Settings';
import { RECORD_TYPE_LABEL } from '../../src/web/lib/recordTypes';

describe('acceptance fixes: plain wording', () => {
  it('treats a role such as "Each document holder" as no holder', () => {
    expect(realHolderOf({ custodian: 'Each document holder (proposed)' })).toBe('');
    expect(realHolderOf({ custodian: '' })).toBe('');
    expect(realHolderOf({ custodian: 'Avery' })).toBe('Avery');
    expect(realHolderOf({ custodian: 'Jun (proposed)' })).toBe('Jun');
  });
  it('names the zone dates are shown in as a place', () => {
    expect(zonePhrase('Pacific/Honolulu')).toBe('Hawaii time');
    expect(zonePhrase('Asia/Tokyo')).toBe('Japan time');
  });
  it('calls agreed dates by their plain name on the Data screen', () => {
    expect(RECORD_TYPE_LABEL.existing_commitment).toBe('Dates we already agreed');
  });
});
