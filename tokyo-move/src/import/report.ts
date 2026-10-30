/**
 * Import reconciliation report (markdown). Generated from a parsed bundle and the corrections receipts; the output
 * contains real household data when the source is real, so it must only ever be written under the gitignored private/
 * directory (scripts/import.ts --report). This module itself contains no household data.
 */
import type { ImportBundle, MilestoneData, QuestionData, DeadlineRuleData, ContactData, ExistingCommitmentData, ArrivalData, CostData } from '../shared/types';
import type { Correction, CorrectionReceipt } from './corrections';
import { mapDisposition } from './sidecars';

type Rec = ImportBundle['records'][number];

function esc(text: unknown): string {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function table(headers: string[], rows: unknown[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  return [head, sep, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}

function group<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k) ?? [];
    list.push(it);
    m.set(k, list);
  }
  return [...m].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
}

function keys(list: Rec[], max = 12): string {
  const k = list.map((r) => r.key);
  return k.length > max ? `${k.slice(0, max).join(', ')}, … (${k.length})` : k.join(', ');
}

export interface ReportInput {
  sourceDir: string;
  /** Bundle as parsed from the source files (before corrections). */
  parsed: ImportBundle;
  /** Bundle after corrections (what is stored). */
  final: ImportBundle;
  receipts: CorrectionReceipt[];
  corrections: readonly Correction[];
  /** Parsed verification.json, if present. */
  verification?: unknown;
  /** Result of the import into the database, if one was run. */
  run?: { id: string; status: string; summary: string };
}

export function buildReconciliationReport(input: ReportInput): string {
  const { parsed, final, receipts, corrections } = input;
  const of = (b: ImportBundle, t: string) => b.records.filter((r) => r.type === t);
  const raw = (r: Rec, key: string) => (r.source?.raw ?? {})[key];
  const out: string[] = [];
  const h = (level: number, title: string) => out.push(`\n${'#'.repeat(level)} ${title}\n`);

  out.push('# Import reconciliation (PRIVATE — real household data; never commit)');
  out.push('');
  out.push(`Source package: \`${input.sourceDir}\``);
  out.push(`Source label: ${parsed.source_label}. Plan baseline: ${parsed.settings.plan_baseline?.baseline_on ?? 'unknown'}; local review: ${parsed.settings.plan_baseline?.reviewed_on ?? 'unknown'}.`);
  if (input.run) out.push(`Latest import run: \`${input.run.id}\` — ${input.run.status}. ${input.run.summary}`);

  /* ---- files ---- */
  h(2, '1. Source files and hashes');
  out.push(table(['File', 'sha256', 'Bytes', 'Used for'], parsed.files.map((f) => [f.name, f.sha256, f.bytes, usedFor(f.name)])));
  const ver = input.verification as { source_hashes?: Record<string, { original?: string; snapshot?: string; identical?: boolean }> } | undefined;
  if (ver?.source_hashes) {
    out.push('');
    out.push('Hashes recorded in verification.json compared with the files read:');
    out.push('');
    out.push(
      table(
        ['File', 'verification.json original', 'matches file read'],
        Object.entries(ver.source_hashes).map(([name, v]) => {
          const actual = parsed.files.find((f) => f.name === name)?.sha256;
          return [name, v.original ?? '', actual ? (actual === v.original ? 'yes' : 'NO') : 'file not read'];
        }),
      ),
    );
  }

  /* ---- counts ---- */
  h(2, '2. Counts vs declared');
  const types = [...new Set([...Object.keys(parsed.validation.expected), ...Object.keys(final.validation.counts), ...Object.keys(parsed.validation.counts)])];
  const finalCount = (t: string) => of(final, t).length;
  out.push(table(['Record type', 'Declared', 'Parsed from source', 'Stored (after corrections)'], types.map((t) => [t, parsed.validation.expected[t] ?? '', parsed.validation.counts[t] ?? 0, finalCount(t)])));
  const w = of(parsed, 'milestone').map((r) => r.key);
  const missing = Array.from({ length: 71 }, (_, i) => `W${String(i + 1).padStart(2, '0')}`).filter((k) => !w.includes(k));
  out.push('');
  out.push(`Milestone IDs W01–W71 present: ${missing.length === 0 ? 'all 71' : `MISSING ${missing.join(', ')}`}.`);
  out.push('');
  out.push('Notes from the parser:');
  for (const n of parsed.validation.notes) out.push(`- ${n}`);

  /* ---- milestone mappings ---- */
  const ms = of(parsed, 'milestone');
  h(2, '3. Mapping tables');
  h(3, '3.1 Milestone status (source text → normalized status)');
  out.push(table(['Source status', 'Normalized', 'Count', 'Milestones'], group(ms, (r) => `${(r.data as unknown as MilestoneData).source_status}\u0000${r.status}`).map(([k, list]) => { const [s, n] = k.split('\u0000'); return [s, n, list.length, keys(list)]; })));
  out.push('');
  out.push('Rules: "Waiting" means waiting on upstream facts, so it becomes `blocked` with a plain-language reason naming the unmet dependency titles. "Existing; verify" is `in_progress`. "Answered" is `completed` with completion evidence citing the source row. "Deferred — conditional" is `planned` and flagged optional future work. Unrecognized text defaults to `planned` and is listed in the parser notes.');

  h(3, '3.2 Owner (source text → one accountable owner)');
  out.push(table(['Resolved owner', 'Proposed in source', 'Count'], group(ms, (r) => `${r.owner}\u0000${r.owner_proposed}`).map(([k, list]) => { const [o, p] = k.split('\u0000'); return [o, p, list.length]; })));
  out.push('');
  out.push('Distinct source owner text → result (milestones):');
  out.push('');
  out.push(
    table(
      ['Source text', 'Owner', 'Collaborators', 'Count'],
      group(ms, (r) => String(raw(r, 'Proposed owner'))).map(([text, list]) => [text, (list[0] as Rec).owner, ((list[0] as Rec).data as unknown as MilestoneData).collaborators.join('; '), list.length]),
    ),
  );

  h(3, '3.3 Question disposition');
  const qs = of(parsed, 'question');
  out.push(table(['Workbook coverage status', 'Local review disposition (JSON)', 'Mapped disposition', 'Count', 'Questions'], group(qs, (r) => { const d = r.data as unknown as QuestionData; return `${d.source_disposition}\u0000${d.local_disposition}\u0000${d.disposition}`; }).map(([k, list]) => { const [a, b, c] = k.split('\u0000'); return [a, b, c, list.length, keys(list, 8)]; })));
  const changed = qs.filter((r) => {
    const d = r.data as unknown as QuestionData;
    const fromWorkbook = mapDisposition(d.source_disposition === 'Answered' ? 'already answered' : d.source_disposition);
    return !!d.local_disposition && fromWorkbook !== d.disposition;
  });
  out.push('');
  out.push(`The newer local review disposition wins. Items where it changes the meaning of the workbook status: ${keys(changed, 40) || 'none'}.`);

  h(3, '3.4 Other types');
  out.push(table(['Type', 'Source value → stored status', 'Count'], [
    ...group(of(parsed, 'decision'), (r) => `${(r.data as { source_status: string }).source_status} → ${r.status}`).map(([k, l]) => ['decision', k, l.length]),
    ...group(of(parsed, 'workstream'), (r) => `${(r.data as { source_status: string }).source_status} → ${r.status}`).map(([k, l]) => ['workstream', k, l.length]),
    ...group(of(parsed, 'risk'), (r) => `${raw(r, 'Severity')} → ${(r.data as { severity: string }).severity}`).map(([k, l]) => ['risk severity', k, l.length]),
    ...group(of(parsed, 'cost'), (r) => `${(r.data as unknown as CostData).source_section} → ${(r.data as unknown as CostData).section}`).map(([k, l]) => ['cost section', k, l.length]),
    ...group(of(parsed, 'arrival'), (r) => (r.data as unknown as ArrivalData).window_key).map(([k, l]) => ['arrival window', k, l.length]),
    ...group(of(parsed, 'document'), (r) => `${(r.data as { source_status: string }).source_status} → ${r.status}`).map(([k, l]) => ['document', k, l.length]),
    ...group(of(parsed, 'evidence'), (r) => r.status).map(([k, l]) => ['evidence', k, l.length]),
  ]));
  const b49 = of(parsed, 'cost').filter((r) => (r.data as unknown as CostData).section === 'staged_overlap');
  if (b49.length > 0) out.push(`\nCost lines re-sectioned as staged overlap (their description is about staged or overlapping living): ${keys(b49)}. Their source section text is preserved in \`source_section\`. The phase is left empty (unknown), so they stay unknown in totals.`);

  h(3, '3.5 Contacts (relationship is never inferred from a saved name)');
  out.push(table(['Contact', 'Relationship', 'Basis'], of(parsed, 'contact').map((r) => [r.title, (r.data as unknown as ContactData).relationship, (r.data as unknown as ContactData).relationship_basis])));

  h(3, '3.6 Existing commitments (Dates sheet)');
  out.push(table(['Commitment', 'Date', 'Kind', 'Source meaning', 'Linked'], of(parsed, 'existing_commitment').map((r) => { const d = r.data as unknown as ExistingCommitmentData; return [r.title, d.recorded_date, d.deadline_kind, d.meaning, d.linked_records.join(', ')]; })));

  h(3, '3.7 Deadline rules generated from the Dates sheet');
  out.push(table(['Rule key', 'Label', 'Scope', 'Anchor', 'Offset', 'Unit', 'Kind', 'Linked records', 'Status after corrections'], of(parsed, 'deadline_rule').map((r) => {
    const d = r.data as unknown as DeadlineRuleData;
    const after = final.records.find((x) => x.id === r.id);
    return [r.key, d.label, d.traveler_scope, d.anchor, `${d.direction} ${d.offset}`, d.unit, d.kind, d.linked_records.join(', '), after?.status ?? 'removed'];
  })));
  out.push('');
  out.push('Kind rules: a basis that starts with "Official" or "Within" is `legal` (verification stays `not_verified` until a reviewer verifies it); "Internal…" and everything else is `internal_target`. A rule dated from household T or D is always `internal_target` and household-scoped.');
  const dated = group(ms.filter((r) => (r.data as unknown as MilestoneData).deadline), (r) => { const d = (r.data as unknown as MilestoneData).deadline!; return `${d.kind} / ${d.traveler} / ${d.anchor}`; });
  out.push('');
  out.push('Milestone deadlines from the date-anchor columns:');
  out.push('');
  out.push(table(['Kind / traveler / anchor', 'Count', 'Milestones'], dated.map(([k, l]) => [k, l.length, keys(l)])));

  /* ---- corrections ---- */
  h(2, '4. Reviewed-model corrections and receipts');
  out.push(`Corrections applied (in order): ${corrections.map((c) => c.id).join(', ')}.`);
  out.push('');
  out.push(table(['Correction', 'Title', 'Applied', 'Not applicable'], corrections.map((c) => [c.id, c.title, receipts.filter((r) => r.correction_id === c.id && r.outcome === 'applied').length, receipts.filter((r) => r.correction_id === c.id && r.outcome === 'not_applicable').length])));
  for (const c of corrections.filter((x) => /^C-00\d$/.test(x.id))) {
    out.push('');
    out.push(`#### ${c.id} — ${c.title}`);
    out.push('');
    out.push(`Rationale: ${c.rationale}`);
    const rs = receipts.filter((r) => r.correction_id === c.id);
    if (rs.length === 0) out.push('\nNo operation was needed (targets absent or already correct).');
    else out.push('\n' + table(['Record', 'Field', 'Outcome', 'Before', 'After'], rs.slice(0, 60).map((r) => [r.record_id, r.field ?? '(record)', r.outcome, brief(r.before), brief(r.after)])));
    if (rs.length > 60) out.push(`\n… ${rs.length - 60} more receipts (see import_changes in the database).`);
  }

  /* ---- dangling ---- */
  h(2, '5. Dangling references');
  const d = parsed.validation.dangling_refs;
  out.push(d.length === 0 ? 'None. Every dependency, workstream, evidence, milestone-link and linked-record reference resolves.' : table(['Record', 'Field', 'Unresolved reference'], d.map((x) => [x.record, x.field, x.ref])));

  /* ---- provisional ---- */
  h(2, '6. Provisional heuristics (to be replaced by reviewed values)');
  const fm = of(final, 'milestone');
  const dist = (key: (r: Rec) => string): [string, number, number][] => {
    const before = new Map(group(ms, key).map(([k, l]) => [k, l.length]));
    const after = new Map(group(fm, key).map(([k, l]) => [k, l.length]));
    return [...new Set([...before.keys(), ...after.keys()])].map((k) => [k, before.get(k) ?? 0, after.get(k) ?? 0] as [string, number, number]).sort((a, b) => b[1] + b[2] - (a[1] + a[2]));
  };
  const head = ['Value', 'Parsed from source', 'After corrections'];
  out.push('- `traveler_scope` (milestones): people whose name or alias appears in the title or work area, plus "both/each adult" titles, plus the owner of a person-anchored deadline. Everything else is household coordination (`[]`).');
  out.push('');
  out.push(table(head, dist((r) => JSON.stringify((r.data as unknown as MilestoneData).traveler_scope))));
  out.push('');
  out.push('- `phase`: from the date-anchor offset when present (≤ −75 days: p4; ≤ 0: p5; > 0: p6), otherwise keywords in the target window / due-date basis; null when nothing matches.');
  out.push('');
  out.push(table(head, dist((r) => String((r.data as unknown as MilestoneData).phase))));
  out.push('');
  out.push('- `workstream_key`: explicit when the Workstreams "Dependencies" cell names the milestone; otherwise the workstream that most questionnaire rows mentioning the milestone belong to (only when that is unambiguous); otherwise null.');
  out.push('');
  out.push(table(head, dist((r) => String((r.data as unknown as MilestoneData).workstream_key)).slice(0, 40)));
  out.push('');
  out.push('- Per-traveler gate lists in `traveler_gates` are derived from `traveler_scope` and are a placeholder. Reviewed gates arrive through `private/corrections/*.json` (setting `traveler_gates`).');
  out.push('- `Evidence.stale` is computed only from age (checked more than 90 days before the plan review date). A refresh trigger such as "recheck before filing" is displayed, not scored.');
  out.push('- Dependency cells: plain IDs block; "W02 for <person>" style text becomes a scoped dependency (`dependency_scope`); conditions and free text are kept in `dependency_note` and never block.');
  out.push('- Workstream and decision "Dependencies" cells are imported as non-blocking `related` links (the workstream graph is cyclic).');

  /* ---- not imported ---- */
  h(2, '7. Not imported (and why)');
  out.push('- **Overview sheet**: a derived summary of other sheets; nothing in it is a record. It stays in the preserved workbook.');
  out.push('- **Formula logic and scenario controls** (Budget case selector, calculated columns): the engines recompute amounts from inputs; only inputs and cached values were read. No full workbook recalculation is claimed.');
  out.push('- **Cell colors / amber input styling**: presentation only.');
  out.push('- **PDF and the handoff text**: hashed and listed as evidence; not parsed (they restate the workbook and instructions are never executed).');
  out.push('- **workbook-readback.json, Questionnaire-Coverage.md, Roadmap-Queue-Reconciliation.md, Prepared-Question-Packets.md, Personal-Project-Evidence-Matrix.md, Revision-2-Local-Review.md, proposed-final.txt, local-delivery-manifest.json, pdf-page10.png**: review narratives and duplicates of data already imported from structured files; read by people, not parsed.');
  out.push('- **Scenario settings** (planning / condo delay / combined stress): the engine defaults match the workbook cases, so they are not stored per household.');
  out.push('- **Document lifecycle facts** (requested / received / reviewed / accepted / expiry): the workbook records only a status phrase, so these start empty rather than being inferred.');
  out.push('- **Cost amounts**: every source cost line is "Review" with no amount; all stay unknown (null), never zero.');
  out.push('- **Task store**: only the read-only dated snapshot from the crosswalk. Nothing is written to any task file.');
  out.push('');
  return out.join('\n') + '\n';
}

function usedFor(name: string): string {
  if (/\.xlsx$/i.test(name)) return 'parsed (all records)';
  if (/crosswalk/i.test(name)) return 'parsed (task links, queue disposition)';
  if (/coverage/i.test(name)) return 'parsed (question dispositions, local notes)';
  if (/overrides/i.test(name)) return 'parsed (display names, aliases, timezone, baseline dates)';
  if (/^corrections\//.test(name)) return 'applied (reviewed-model corrections)';
  if (/verification/i.test(name)) return 'read for the hash cross-check';
  return 'hashed as evidence only';
}

function brief(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}
