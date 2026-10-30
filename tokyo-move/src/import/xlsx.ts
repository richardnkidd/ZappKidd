/**
 * Minimal XLSX reader (fflate + fast-xml-parser). The household workbook uses namespace-prefixed XML (`x:`), which
 * common spreadsheet libraries misread, so this reads the parts it needs directly with `removeNSPrefix: true`.
 *
 * Supported: shared strings (including rich-text runs), inline strings, numbers, booleans, errors, formulas with
 * cached values, sheet names resolved through workbook.xml + relationships, and date detection from cell styles.
 * Not supported (not needed): merged-cell semantics, comments, drawings, external links.
 */
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { fromDayNumber } from '../shared/dates';

export type CellValue = string | number | boolean | null;

export interface Cell {
  ref: string; // 'A7'
  row: number; // 1-based
  col: number; // 1-based
  /** Cached/typed value: text, number, boolean, or null for blank. Errors are returned as their '#…' text. */
  value: CellValue;
  type: 'string' | 'number' | 'boolean' | 'error' | 'blank';
  /** Formula text (without '='), when the cell holds one; `value` is then the cached result. */
  formula: string | null;
  /** True when the cell's number format is a date/time format. */
  is_date: boolean;
}

export interface Sheet {
  name: string;
  /** Highest used row / column (1-based). */
  max_row: number;
  max_col: number;
  cells: Map<string, Cell>;
}

export interface Workbook {
  sheets: Sheet[];
  sheet(name: string): Sheet;
}

const MAX_PART_BYTES = 64 * 1024 * 1024;

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  isArray: (name) => ['si', 'r', 'row', 'c', 'sheet', 'Relationship', 'xf', 'numFmt', 'rPh'].includes(name),
});

const decoder = new TextDecoder('utf-8');

/* ---------------------------- helpers ---------------------------- */

export function colToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numberToCol(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function parseRef(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Bad cell reference: ${ref}`);
  return { col: colToNumber(m[1] as string), row: Number(m[2]) };
}

/** Excel serial date → civil 'YYYY-MM-DD' (serial 25569 = 1970-01-01). Time-of-day is dropped. */
export function serialToCivil(serial: number): string {
  return fromDayNumber(Math.floor(serial) - 25569);
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Text of an element that may be a string, or an object with '#text' (when it carries attributes). */
function textOf(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    return t === undefined ? '' : String(t);
  }
  return '';
}

/** Shared/inline string item: plain <t> or concatenated rich-text runs <r><t>; phonetic runs are ignored. */
function stringItemText(si: unknown): string {
  if (si === undefined || si === null) return '';
  if (typeof si === 'string') return si;
  const o = si as Record<string, unknown>;
  const parts: string[] = [];
  if ('t' in o) parts.push(textOf(o.t));
  for (const run of asArray(o.r as unknown)) {
    if (run && typeof run === 'object') parts.push(textOf((run as Record<string, unknown>).t));
    else parts.push(textOf(run));
  }
  return parts.join('');
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function looksLikeDateFormat(code: string): boolean {
  // Strip quoted literals and bracketed sections, then look for date/time tokens.
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[ymdhs]/i.test(stripped) && !/^[#0?.,%\s$€¥£E+\-_()/*]*$/i.test(stripped);
}

function dateStyleIndexes(stylesXml: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const doc = parser.parse(stylesXml) as Record<string, any>;
  const styleSheet = doc.styleSheet ?? {};
  const custom = new Map<number, string>();
  for (const nf of asArray<Record<string, string>>(styleSheet.numFmts?.numFmt)) {
    custom.set(Number(nf['@_numFmtId']), nf['@_formatCode'] ?? '');
  }
  const xfs = asArray<Record<string, string>>(styleSheet.cellXfs?.xf);
  xfs.forEach((xf, i) => {
    const id = Number(xf['@_numFmtId'] ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && looksLikeDateFormat(custom.get(id) ?? ''))) out.add(i);
  });
  return out;
}

/* ---------------------------- reader ----------------------------- */

export function readWorkbook(bytes: Uint8Array): Workbook {
  const files = unzipSync(bytes, {
    filter: (file) => file.originalSize <= MAX_PART_BYTES && /^(xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)|\[Content_Types\]\.xml)$/.test(file.name),
  });
  const text = (name: string): string | undefined => {
    const part = files[name];
    return part ? decoder.decode(part) : undefined;
  };

  const workbookXml = text('xl/workbook.xml');
  const relsXml = text('xl/_rels/workbook.xml.rels');
  if (!workbookXml || !relsXml) throw new Error('Not a readable XLSX workbook (missing workbook.xml or its relationships).');

  const rels = new Map<string, string>();
  const relDoc = parser.parse(relsXml) as Record<string, any>;
  for (const r of asArray<Record<string, string>>(relDoc.Relationships?.Relationship)) {
    rels.set(r['@_Id'] as string, r['@_Target'] as string);
  }

  const sharedXml = text('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sharedXml) {
    const sd = parser.parse(sharedXml) as Record<string, any>;
    for (const si of asArray(sd.sst?.si)) shared.push(stringItemText(si));
  }
  const dateStyles = dateStyleIndexes(text('xl/styles.xml'));

  const wbDoc = parser.parse(workbookXml) as Record<string, any>;
  const sheetDefs = asArray<Record<string, string>>(wbDoc.workbook?.sheets?.sheet);
  const sheets: Sheet[] = [];

  for (const def of sheetDefs) {
    const name = def['@_name'] as string;
    const relId = def['@_id'] as string; // r:id with the namespace prefix removed
    const target = rels.get(relId);
    if (!target) throw new Error(`Sheet "${name}" has no relationship target.`);
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = text(path);
    if (!xml) throw new Error(`Sheet "${name}" part is missing: ${path}`);
    sheets.push(parseSheet(name, xml, shared, dateStyles));
  }

  return {
    sheets,
    sheet(name: string): Sheet {
      const found = sheets.find((s) => s.name === name);
      if (!found) throw new Error(`Workbook has no sheet named "${name}". Found: ${sheets.map((s) => s.name).join(', ')}`);
      return found;
    },
  };
}

function parseSheet(name: string, xml: string, shared: string[], dateStyles: Set<number>): Sheet {
  const doc = parser.parse(xml) as Record<string, any>;
  const cells = new Map<string, Cell>();
  let maxRow = 0;
  let maxCol = 0;
  for (const row of asArray<Record<string, any>>(doc.worksheet?.sheetData?.row)) {
    for (const c of asArray<Record<string, any>>(row.c)) {
      const ref = c['@_r'] as string | undefined;
      if (!ref) continue;
      const { row: r, col } = parseRef(ref);
      const t = c['@_t'] as string | undefined;
      const style = c['@_s'] !== undefined ? Number(c['@_s']) : -1;
      const f = c.f === undefined ? null : textOf(c.f) || null;
      const vRaw = c.v === undefined ? undefined : textOf(c.v);
      let value: CellValue = null;
      let type: Cell['type'] = 'blank';

      if (t === 's' && vRaw !== undefined) {
        value = shared[Number(vRaw)] ?? '';
        type = 'string';
      } else if (t === 'inlineStr') {
        value = stringItemText(c.is);
        type = 'string';
      } else if (t === 'str' && vRaw !== undefined) {
        value = vRaw;
        type = 'string';
      } else if (t === 'b' && vRaw !== undefined) {
        value = vRaw === '1';
        type = 'boolean';
      } else if (t === 'd' && vRaw !== undefined) {
        // ISO-8601 date cell: keep the civil date only (never an instant)
        value = /^\d{4}-\d{2}-\d{2}/.test(vRaw) ? vRaw.slice(0, 10) : vRaw;
        type = 'string';
      } else if (t === 'e' && vRaw !== undefined) {
        value = vRaw;
        type = 'error';
      } else if (vRaw !== undefined && vRaw !== '') {
        const n = Number(vRaw);
        if (Number.isFinite(n)) {
          value = n;
          type = 'number';
        } else {
          value = vRaw;
          type = 'string';
        }
      }
      if (type === 'string' && value === '') {
        // an empty string result is a blank for our purposes
        value = null;
        type = 'blank';
      }
      cells.set(ref, { ref, row: r, col, value, type, formula: f, is_date: t === 'd' || (style >= 0 && dateStyles.has(style)) });
      if (type !== 'blank' || f) {
        if (r > maxRow) maxRow = r;
        if (col > maxCol) maxCol = col;
      }
    }
  }
  return { name, max_row: maxRow, max_col: maxCol, cells };
}

/* ------------------------- cell accessors ------------------------ */

export function cell(sheet: Sheet, ref: string): Cell | undefined {
  return sheet.cells.get(ref);
}

/** Trimmed text of a cell (numbers rendered plainly); null when blank. Date cells render as civil dates. */
export function text(sheet: Sheet, ref: string): string | null {
  const c = sheet.cells.get(ref);
  if (!c || c.value === null) return null;
  if (typeof c.value === 'number') {
    if (c.is_date) return serialToCivil(c.value);
    return Number.isInteger(c.value) ? String(c.value) : String(c.value);
  }
  const t = String(c.value).trim();
  return t === '' ? null : t;
}

export function numberAt(sheet: Sheet, ref: string): number | null {
  const c = sheet.cells.get(ref);
  return c && typeof c.value === 'number' ? c.value : null;
}

/** Civil date from a date-formatted or numeric-serial cell; also accepts 'YYYY-MM-DD' text. */
export function civilAt(sheet: Sheet, ref: string): string | null {
  const c = sheet.cells.get(ref);
  if (!c || c.value === null) return null;
  if (typeof c.value === 'number') return serialToCivil(c.value);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(c.value).trim());
  return m ? (m[1] as string) : null;
}

/** All cells in a row as { A: cell, B: cell … } keyed by column letters. */
export function rowCells(sheet: Sheet, row: number): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (let col = 1; col <= sheet.max_col; col++) {
    const c = sheet.cells.get(`${numberToCol(col)}${row}`);
    if (c && c.value !== null) out[numberToCol(col)] = c;
  }
  return out;
}

/** The original value of a cell as it should be preserved in `source.raw`: dates as civil strings, blanks as null. */
export function rawValue(sheet: Sheet, ref: string): string | number | boolean | null {
  const c = sheet.cells.get(ref);
  if (!c || c.value === null) return null;
  if (typeof c.value === 'number' && c.is_date) return serialToCivil(c.value);
  if (typeof c.value === 'string') return c.value;
  return c.value;
}
