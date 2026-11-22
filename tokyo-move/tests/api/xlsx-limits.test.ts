/**
 * SEC-013: the XLSX reader has a size budget. Zips are built in memory with fflate; the limits are passed in small so the
 * tests stay fast and light.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { DEFAULT_WORKBOOK_LIMITS, WorkbookLimitError, readWorkbook } from '../../src/import/xlsx';
import { parseSourcePackage } from '../../src/import/normalize';
import { sidecarPaths } from '../../src/import/sidecars';

const WB = '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>';
const RELS = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';

function sheetXml(cells: number): string {
  let rows = '';
  for (let i = 1; i <= cells; i += 1) rows += `<row r="${i}"><c r="A${i}" t="inlineStr"><is><t>v${i}</t></is></c></row>`;
  return `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;
}

function workbook(opts: { cells?: number; sharedXml?: string; extra?: Record<string, Uint8Array>; sheet?: string } = {}): Uint8Array {
  const parts: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(WB),
    'xl/_rels/workbook.xml.rels': strToU8(RELS),
    'xl/worksheets/sheet1.xml': strToU8(opts.sheet ?? sheetXml(opts.cells ?? 3)),
    ...(opts.sharedXml ? { 'xl/sharedStrings.xml': strToU8(opts.sharedXml) } : {}),
    ...opts.extra,
  };
  return zipSync(parts, { level: 9 });
}

/** Overwrite the uncompressed size recorded in the central directory entry for `name` (makes the zip "lie"). */
function lieAboutSize(zip: Uint8Array, name: string, claimed: number): void {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const text = new TextDecoder();
  for (let i = 0; i < zip.length - 46; i += 1) {
    if (view.getUint32(i, true) === 0x02014b50) {
      const nameLen = view.getUint16(i + 28, true);
      if (text.decode(zip.subarray(i + 46, i + 46 + nameLen)) === name) {
        view.setUint32(i + 24, claimed, true);
        return;
      }
    }
  }
  throw new Error('entry not found');
}

describe('SEC-013 workbook size budget', () => {
  it('SEC-013 still reads an ordinary workbook with the default limits', () => {
    const wb = readWorkbook(workbook({ cells: 50, sharedXml: '<sst><si><t>hello</t></si></sst>' }));
    expect(wb.sheet('S').cells.get('A7')?.value).toBe('v7');
  });

  it('SEC-013 rejects a file over the size cap with a clear message', () => {
    const bytes = workbook({ cells: 200 });
    expect(() => readWorkbook(bytes, { maxFileBytes: 500 })).toThrow(WorkbookLimitError);
    expect(() => readWorkbook(bytes, { maxFileBytes: 500 })).toThrow(/too large or unusual to import safely: the file is .*MB, over the .*MB limit/);
  });

  it('SEC-013 rejects a sheet with more cells than allowed', () => {
    const bytes = workbook({ cells: 600 });
    expect(() => readWorkbook(bytes, { maxCellsPerSheet: 500 })).toThrow(/sheet "S" has more than 500 cells/);
    expect(readWorkbook(bytes, { maxCellsPerSheet: 600 }).sheet('S').cells.size).toBe(600);
  });

  it('SEC-013 rejects one enormous shared string or inline string', () => {
    const shared = workbook({ sharedXml: `<sst><si><t>${'B'.repeat(2000)}</t></si></sst>` });
    expect(() => readWorkbook(shared, { maxStringChars: 1000 })).toThrow(/shared string has 2000 characters/);
    const inline = workbook({ sheet: `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${'C'.repeat(2000)}</t></is></c></row></sheetData></worksheet>` });
    expect(() => readWorkbook(inline, { maxStringChars: 1000 })).toThrow(/characters \(limit 1000\)/);
  });

  it('SEC-013 counts the bytes actually produced by inflating, across all parts that are read', () => {
    const shared = workbook({ sharedXml: `<sst><si><t>${'A'.repeat(3 * 1024 * 1024)}</t></si></sst>` }); // ~3 MB of text, a few KB zipped
    expect(shared.length).toBeLessThan(50_000);
    expect(() => readWorkbook(shared, { maxTotalBytes: 1024 * 1024 })).toThrow(/expands to more than|together expand/);
    expect(() => readWorkbook(shared, { maxPartBytes: 1024 * 1024 })).toThrow(/expands to more than/);
    expect(readWorkbook(shared, { maxStringChars: 10_000_000 }).sheets).toHaveLength(1);
  });

  it('SEC-013 does not trust the sizes the zip claims: a part that lies about its size is still stopped', () => {
    const bytes = workbook({ sharedXml: `<sst><si><t>${'Z'.repeat(5 * 1024 * 1024)}</t></si></sst>` });
    lieAboutSize(bytes, 'xl/sharedStrings.xml', 100); // claims 100 bytes, really inflates to ~5 MB
    expect(() => readWorkbook(bytes, { maxPartBytes: 1024 * 1024 })).toThrow(WorkbookLimitError);
  });

  it('SEC-013 stops a deflate bomb at the part cap instead of exhausting memory', () => {
    const bomb = workbook({ sharedXml: `<sst><si><t>${'B'.repeat(80 * 1024 * 1024)}</t></si></sst>` });
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(() => readWorkbook(bomb)).toThrow(/expands to more than the 32 MB allowed/);
  });

  it('SEC-013 never inflates parts the workbook does not reference', () => {
    const junk = new Uint8Array(40 * 1024 * 1024).fill(32);
    const bytes = workbook({ extra: { 'xl/worksheets/junk.xml': junk, 'xl/media/image1.bin': junk, 'docProps/big.xml': junk } });
    // A tiny total budget would be blown by the junk if it were inflated.
    expect(readWorkbook(bytes, { maxTotalBytes: 100_000 }).sheet('S').cells.size).toBe(3);
  });

  it('SEC-013 a workbook file over the cap is refused before it is read into memory by the importer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kadode-xlsx-'));
    try {
      const paths = sidecarPaths(dir);
      mkdirSync(join(paths.workbook, '..'), { recursive: true });
      writeFileSync(paths.workbook, '');
      truncateSync(paths.workbook, DEFAULT_WORKBOOK_LIMITS.maxFileBytes + 1024); // sparse file, no real disk use
      expect(() => parseSourcePackage(dir)).toThrow(/too large or unusual to import safely/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
