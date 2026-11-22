import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { civilAt, numberToCol, parseRef, rawValue, readWorkbook, serialToCivil, text } from '../../src/import/xlsx';
import { readTable } from '../../src/import/workbook';

/** A tiny synthetic workbook using the same `x:`-prefixed XML dialect as the real one (all content is invented). */
function buildSyntheticXlsx(): Uint8Array {
  const ns = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8(
      `<x:workbook ${ns}><x:sheets><x:sheet name="Second" sheetId="2" r:id="rId2"/><x:sheet name="First" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(
      `<x:sst ${ns}>` +
        '<x:si><x:t>Plain text</x:t></x:si>' +
        '<x:si><x:r><x:t xml:space="preserve">Rich </x:t></x:r><x:r><x:rPr><x:b/></x:rPr><x:t>text runs</x:t></x:r><x:rPh sb="0" eb="1"><x:t>ignored</x:t></x:rPh></x:si>' +
        '<x:si><x:t>Header A</x:t></x:si><x:si><x:t>Header B</x:t></x:si><x:si><x:t>ID-1</x:t></x:si><x:si><x:t>ID-2</x:t></x:si>' +
        '</x:sst>',
    ),
    'xl/styles.xml': strToU8(
      `<x:styleSheet ${ns}><x:numFmts count="1"><x:numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></x:numFmts>` +
        '<x:cellXfs count="3"><x:xf numFmtId="0"/><x:xf numFmtId="14"/><x:xf numFmtId="164"/></x:cellXfs></x:styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<x:worksheet ${ns}><x:sheetData>` +
        '<x:row r="1">' +
        '<x:c r="A1" t="s"><x:v>0</x:v></x:c>' +
        '<x:c r="B1" t="s"><x:v>1</x:v></x:c>' +
        '<x:c r="C1"><x:v>42.5</x:v></x:c>' +
        '<x:c r="D1" t="b"><x:v>1</x:v></x:c>' +
        '<x:c r="E1" t="inlineStr"><x:is><x:r><x:t>Inline </x:t></x:r><x:r><x:t>string</x:t></x:r></x:is></x:c>' +
        '<x:c r="F1"><x:f>SUM(1,2)</x:f><x:v>3</x:v></x:c>' +
        '<x:c r="G1" s="1"><x:v>25569</x:v></x:c>' +
        '<x:c r="H1" s="2"><x:v>46327</x:v></x:c>' +
        '<x:c r="I1" t="d"><x:v>2026-10-31T00:00:00.000Z</x:v></x:c>' +
        '<x:c r="J1" t="str"><x:f>"a"&amp;"b"</x:f><x:v>ab</x:v></x:c>' +
        '<x:c r="K1" t="e"><x:v>#DIV/0!</x:v></x:c>' +
        '<x:c r="L1"/>' +
        '</x:row>' +
        '</x:sheetData></x:worksheet>',
    ),
    'xl/worksheets/sheet2.xml': strToU8(
      `<x:worksheet ${ns}><x:sheetData>` +
        '<x:row r="2"><x:c r="A2" t="s"><x:v>2</x:v></x:c><x:c r="B2" t="s"><x:v>3</x:v></x:c></x:row>' +
        '<x:row r="3"><x:c r="A3" t="s"><x:v>4</x:v></x:c><x:c r="B3"><x:v>7</x:v></x:c></x:row>' +
        '<x:row r="4"><x:c r="A4" t="s"><x:v>5</x:v></x:c><x:c r="B4"><x:v>8</x:v></x:c></x:row>' +
        '<x:row r="5"><x:c r="B5"><x:v>9</x:v></x:c></x:row>' +
        '</x:sheetData></x:worksheet>',
    ),
  };
  return zipSync(files);
}

describe('readWorkbook', () => {
  const wb = readWorkbook(buildSyntheticXlsx());

  it('resolves sheet names through workbook.xml and its relationships (relative and absolute targets)', () => {
    expect(wb.sheets.map((s) => s.name)).toEqual(['Second', 'First']);
    expect(text(wb.sheet('First'), 'A1')).toBe('Plain text');
    expect(text(wb.sheet('Second'), 'A3')).toBe('ID-1');
    expect(() => wb.sheet('Missing')).toThrow(/no sheet named/);
  });

  it('reads shared strings including rich-text runs (phonetic runs ignored), inline strings and cached formula values', () => {
    const s = wb.sheet('First');
    expect(text(s, 'B1')).toBe('Rich text runs');
    expect(text(s, 'E1')).toBe('Inline string');
    expect(s.cells.get('F1')).toMatchObject({ value: 3, formula: 'SUM(1,2)', type: 'number' });
    expect(text(s, 'J1')).toBe('ab');
    expect(s.cells.get('J1')?.formula).toBe('"a"&"b"');
  });

  it('reads numbers, booleans, errors and blanks', () => {
    const s = wb.sheet('First');
    expect(s.cells.get('C1')?.value).toBe(42.5);
    expect(s.cells.get('D1')).toMatchObject({ value: true, type: 'boolean' });
    expect(s.cells.get('K1')).toMatchObject({ value: '#DIV/0!', type: 'error' });
    expect(s.cells.get('L1')?.type).toBe('blank');
    expect(text(s, 'L1')).toBeNull();
    expect(text(s, 'Z9')).toBeNull();
  });

  it('turns Excel serial dates into civil dates for date-typed cells (serial 25569 = 1970-01-01)', () => {
    expect(serialToCivil(25569)).toBe('1970-01-01');
    expect(serialToCivil(46327.75)).toBe('2026-11-01');
    const s = wb.sheet('First');
    expect(s.cells.get('G1')?.is_date).toBe(true);
    expect(text(s, 'G1')).toBe('1970-01-01');
    expect(civilAt(s, 'H1')).toBe('2026-11-01'); // custom yyyy-mm-dd format is detected as a date
    expect(rawValue(s, 'H1')).toBe('2026-11-01');
    // ISO date cells (t="d") are kept as a civil date, never an instant that could shift with the timezone
    expect(civilAt(s, 'I1')).toBe('2026-10-31');
    expect(rawValue(s, 'C1')).toBe(42.5); // not a date column
  });

  it('reads tables by coordinates with header names preserved in raw', () => {
    const rows = readTable(wb.sheet('Second'), { headerRow: 2, firstCol: 'A', lastCol: 'B', idPattern: /^ID-\d$/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.raw).toEqual({ 'Header A': 'ID-1', 'Header B': 7 });
    expect(rows[1]?.t('A')).toBe('ID-2');
    expect(rows[1]?.n('B')).toBe(8);
    expect(rows[0]?.range).toBe('A3:B3');
  });
});

describe('references', () => {
  it('converts between column letters and numbers', () => {
    expect(numberToCol(1)).toBe('A');
    expect(numberToCol(26)).toBe('Z');
    expect(numberToCol(27)).toBe('AA');
    expect(parseRef('AB12')).toEqual({ col: 28, row: 12 });
    expect(() => parseRef('12')).toThrow();
  });
});

describe('robustness', () => {
  it('rejects a file that is not a workbook', () => {
    expect(() => readWorkbook(zipSync({ 'readme.txt': strToU8('hello') }))).toThrow(/workbook/i);
  });
});
