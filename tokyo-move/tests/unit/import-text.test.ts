import { describe, expect, it } from 'vitest';
import { mapDisposition } from '../../src/import/sidecars';
import { PeopleIndex, parseDependencies, parseOwner, splitList, findIds, type ParsedPerson } from '../../src/import/text';
import { slugify } from '../../src/import/util';

const people: ParsedPerson[] = [
  { id: 'avery', display_name: 'Avery', kind: 'adult', aliases: ['Averie'], descriptor: null, anchors: { arrival: 'TN', departure: 'DN' } },
  { id: 'jun', display_name: 'Jun', kind: 'adult', aliases: [], descriptor: null, anchors: { arrival: 'TR', departure: 'DR' } },
  { id: 'mochi', display_name: 'Mochi', kind: 'pet', aliases: [], descriptor: 'Dog', anchors: { arrival: 'TP', departure: 'DP' } },
];
const idx = new PeopleIndex(people);

describe('parseOwner', () => {
  it('a single named adult owns the item; advisers and the assistant become collaborators', () => {
    expect(parseOwner('Avery + immigration adviser (proposed)', idx)).toMatchObject({ owner: 'avery', owner_proposed: true, collaborators: ['Immigration adviser'] });
    expect(parseOwner('Jun', idx)).toMatchObject({ owner: 'jun', owner_proposed: false, collaborators: [] });
    expect(parseOwner('Codex prepares; Jun chooses (proposed)', idx)).toMatchObject({ owner: 'jun', collaborators: ['Assistant'] });
    expect(parseOwner('Avery or authorized preparer', idx)).toMatchObject({ owner: 'avery', collaborators: ['Authorized preparer'] });
  });

  it('both adults, or "each adult", means together', () => {
    expect(parseOwner('Avery + Jun (proposed)', idx).owner).toBe('together');
    expect(parseOwner('Avery and Jun individually; adviser for ambiguities', idx)).toMatchObject({ owner: 'together', collaborators: ['Adviser for ambiguities'] });
    expect(parseOwner('Each adult + clinicians (proposed)', idx)).toMatchObject({ owner: 'together', collaborators: ['Clinicians'] });
    expect(parseOwner('Codex prepares; couple approves', idx)).toMatchObject({ owner: 'together', collaborators: ['Assistant'] });
    expect(parseOwner('Codex drafts; Avery + Jun decide (proposed)', idx)).toMatchObject({ owner: 'together', collaborators: ['Assistant'] });
    expect(parseOwner('Codex researches; Jun + carrier verify', idx)).toMatchObject({ owner: 'jun', collaborators: ['Assistant', 'Carrier'] });
  });

  it('aliases resolve to the same person, and a possessive role ("Avery employer") is not the person', () => {
    expect(parseOwner('Averie (proposed)', idx).owner).toBe('avery');
    const r = parseOwner('Each adult; Avery employer where responsible; municipality', idx);
    expect(r.owner).toBe('together');
    expect(r.collaborators).toEqual(['Avery employer where responsible', 'Municipality']);
  });

  it('nobody named means unassigned, and a pet is never an owner', () => {
    expect(parseOwner('Local Codex (proposed)', idx)).toMatchObject({ owner: 'unassigned', collaborators: ['Assistant'] });
    expect(parseOwner('Mochi', idx).owner).toBe('unassigned');
    expect(parseOwner(null, idx)).toMatchObject({ owner: 'unassigned', owner_proposed: false });
    expect(parseOwner('Relevant Avery/Jun shipment owner', idx).owner).toBe('together');
  });
});

describe('parseDependencies', () => {
  const known = new Set(['W01', 'W02', 'W03', 'W04', 'W13', 'W14', 'W19']);

  it('plain IDs that resolve block; "None" is empty; dangling IDs are reported', () => {
    expect(parseDependencies('W01; W04; W02', 'W05', known, idx)).toMatchObject({ dependencies: ['W01', 'W02', 'W04'], scope: {}, note: null, dangling: [] });
    expect(parseDependencies('None', 'W05', known, idx)).toMatchObject({ dependencies: [], note: null });
    expect(parseDependencies('W01; W99', 'W05', known, idx)).toMatchObject({ dependencies: ['W01'], dangling: ['W99'] });
    expect(parseDependencies('W05; W01', 'W05', known, idx).dependencies).toEqual(['W01']); // never depends on itself
  });

  it('"W02 for Avery stage" scopes the dependency to that traveler only', () => {
    const r = parseDependencies('W01; W02 for Avery stage; W03 for Jun date; W13 and W14 for Mochi', 'W71', known, idx);
    expect(r.dependencies).toEqual(['W01', 'W02', 'W03', 'W13', 'W14']);
    expect(r.scope).toEqual({ W02: ['avery'], W03: ['jun'], W13: ['mochi'], W14: ['mochi'] });
    expect(r.note).toBeNull();
    const only = parseDependencies('W13 only when Mochi travels', 'W64', known, idx);
    expect(only.scope).toEqual({ W13: ['mochi'] });
    // a plain mention wins over a scoped one
    expect(parseDependencies('W02; W02 for Avery', 'W09', known, idx).scope).toEqual({});
  });

  it('conditions and free text never block; they are kept as a note', () => {
    const r = parseDependencies('W01; W19 if medicines require it; W02 or W03 for the relevant adult; Existing claim records', 'W60', known, idx);
    expect(r.dependencies).toEqual(['W01']);
    expect(r.note).toBe('W19 if medicines require it; W02 or W03 for the relevant adult; Existing claim records');
  });
});

describe('small helpers', () => {
  it('splits lists and finds IDs', () => {
    expect(splitList(' a ; b;;c ')).toEqual(['a', 'b', 'c']);
    expect(findIds('See W01, W15 and W15; also S03', 'W', 2)).toEqual(['W01', 'W15']);
    expect(slugify('Dr. Aloha & Sons / Café')).toBe('dr-aloha-and-sons-cafe');
  });
  it('maps coverage dispositions to the app vocabulary', () => {
    expect(mapDisposition('already answered')).toBe('already_answered');
    expect(mapDisposition('waiting/blocked')).toBe('waiting_blocked');
    expect(mapDisposition('carry-forward/no-change')).toBe('carry_forward');
    expect(mapDisposition('explicitly excluded')).toBe('explicitly_excluded');
    expect(mapDisposition('question')).toBe('question');
    expect(mapDisposition('not applicable')).toBe('not_applicable');
    expect(mapDisposition('something new')).toBeNull();
    expect(mapDisposition(null)).toBeNull();
  });
  it('matches whole words, including aliases, when finding people in text', () => {
    expect(idx.mentioned('Ask Avery about Jun and Mochi').map((p) => p.id)).toEqual(['avery', 'jun', 'mochi']);
    expect(idx.mentioned('Averie arrives').map((p) => p.id)).toEqual(['avery']);
    expect(idx.mentioned('Junction and Juniper')).toEqual([]);
  });
});
