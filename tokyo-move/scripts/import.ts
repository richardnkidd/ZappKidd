/**
 * npm run import -- --source <dir> [--db <path>] [--corrections <dir>] [--report <file.md>] [--force]
 *
 * Reads the source package (workbook + sidecars), applies generic and private reviewed-model corrections, upserts the
 * result into the database idempotently, and prints counts, status and receipts. Exits non-zero when the plan's IDs
 * fail validation (for example a missing W01–W71) or the import fails. Never prints record bodies.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { applyBundle } from '../src/import/apply';
import { applyCorrections, BUILTIN_CORRECTIONS, loadCorrectionFiles, mergeCorrections } from '../src/import/corrections';
import { parseSourcePackage } from '../src/import/normalize';
import { buildReconciliationReport } from '../src/import/report';
import { sha256Hex } from '../src/import/util';
import { defaultDbPath, openDb } from '../src/server/db/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const source = resolve(arg('source') ?? process.env.TOKYO_SOURCE_DIR ?? join(process.cwd(), 'private', 'source-package'));
const dbPath = arg('db') ?? defaultDbPath();
const correctionsDir = resolve(arg('corrections') ?? join(source, '..', 'corrections'));
const force = process.argv.includes('--force');
const reportPath = arg('report');

function main(): number {
  if (!existsSync(source)) {
    console.error(`Source directory not found: ${source}`);
    return 2;
  }
  const bundle = parseSourcePackage(source);
  const parsedForReport = structuredClone(bundle);
  const loaded = loadCorrectionFiles(correctionsDir);
  const corrections = mergeCorrections(BUILTIN_CORRECTIONS, loaded.corrections);
  for (const f of loaded.files) {
    bundle.files.push({ name: `corrections/${f.name}`, sha256: sha256Hex(f.text), bytes: Buffer.byteLength(f.text) });
  }

  console.log(`Source: ${source}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Corrections: ${corrections.map((c) => c.id).join(', ') || 'none'}${loaded.files.length ? ` (${loaded.files.length} private file(s))` : ''}`);
  console.log('');
  console.log('Counts (found / expected):');
  let failed = false;
  for (const [type, expected] of Object.entries(bundle.validation.expected)) {
    const found = bundle.validation.counts[type] ?? 0;
    const ok = found === expected;
    if (!ok) failed = true;
    console.log(`  ${type.padEnd(12)} ${String(found).padStart(3)} / ${String(expected).padEnd(3)} ${ok ? 'ok' : 'MISMATCH'}`);
  }
  const others = Object.entries(bundle.validation.counts).filter(([t]) => !(t in bundle.validation.expected));
  console.log(`  other records: ${others.map(([t, n]) => `${t} ${n}`).join(', ')}`);

  const missing: string[] = [];
  const have = new Set(bundle.records.filter((r) => r.type === 'milestone').map((r) => r.key));
  for (let i = 1; i <= 71; i++) {
    const id = `W${String(i).padStart(2, '0')}`;
    if (!have.has(id)) missing.push(id);
  }
  if (missing.length > 0) {
    console.error(`\nValidation FAILED: missing milestone IDs: ${missing.join(', ')}`);
    return 1;
  }
  if (failed) console.error('\nWarning: some declared counts do not match (see above).');
  if (bundle.validation.dangling_refs.length > 0) {
    console.error(`\nWarning: ${bundle.validation.dangling_refs.length} dangling reference(s):`);
    for (const d of bundle.validation.dangling_refs.slice(0, 20)) console.error(`  ${d.record} ${d.field} -> ${d.ref}`);
  }
  for (const n of bundle.validation.notes) console.log(`Note: ${n}`);

  const db = openDb(dbPath);
  try {
    const res = applyBundle(db, bundle, { actor: 'import', corrections, force });
    console.log('');
    console.log(`Import ${res.run.id}: ${res.status}`);
    console.log(`  created ${res.created}, updated ${res.updated}, kept local ${res.kept_local}, corrections ${res.corrections}, unchanged ${res.unchanged}`);
    const receipts = (db.prepare('SELECT COUNT(*) AS n FROM import_changes WHERE import_run_id = ?').get(res.run.id) as { n: number }).n;
    console.log(`  receipts written: ${receipts}`);
    if (res.status === 'failed') {
      console.error(`Import failed: ${res.error ?? res.run.summary}`);
      return 1;
    }
    if (reportPath) {
      const target = resolve(reportPath);
      if (!target.includes(`${join('private')}`)) {
        console.error('Refusing to write a report outside a private/ directory (it contains real household data).');
        return 1;
      }
      const verificationFile = join(source, 'verification.json');
      const { bundle: final, receipts: allReceipts } = applyCorrections(parsedForReport, corrections);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        buildReconciliationReport({
          sourceDir: source,
          parsed: bundle,
          final,
          receipts: allReceipts,
          corrections,
          verification: existsSync(verificationFile) ? JSON.parse(readFileSync(verificationFile, 'utf8')) : undefined,
          run: { id: res.run.id, status: res.status, summary: res.run.summary },
        }),
      );
      console.log(`  report written: ${target}`);
    }
    return 0;
  } finally {
    db.close();
  }
}

process.exitCode = main();
