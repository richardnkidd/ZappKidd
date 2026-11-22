/**
 * Minimal XLSX reader (fflate + fast-xml-parser). The household workbook uses namespace-prefixed XML (`x:`), which
 * common spreadsheet libraries misread, so this reads the parts it needs directly with `removeNSPrefix: true`.
 *
 * Supported: shared strings (including rich-text runs), inline strings, numbers, booleans, errors, formulas with
 * cached values, sheet names resolved through workbook.xml + relationships, and date detection from cell styles.
 * Not supported (not needed): merged-cell semantics, comments, drawings, external links.
 */
import { inflateRawSync } from 'node:zlib';
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

/**
 * Size budget for reading a workbook. A hostile or corrupted .xlsx (zip amplification, one enormous shared string,
 * millions of cells) must fail with a clear message instead of exhausting memory. The household workbook is a few
 * hundred KB, so these are generous.
 */
export interface WorkbookLimits {
  /** Largest .xlsx file accepted. */
  maxFileBytes: number;
  /** Total bytes ACTUALLY inflated across all parts that are read (declared sizes are not trusted). */
  maxTotalBytes: number;
  /** Largest single part once inflated. */
  maxPartBytes: number;
  /** Cells per worksheet. */
  maxCellsPerSheet: number;
  /** Characters in one shared or inline string (Excel itself caps a cell at 32,767). */
  maxStringChars: number;
}

export const DEFAULT_WORKBOOK_LIMITS: WorkbookLimits = {
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxPartBytes: 32 * 1024 * 1024,
  maxCellsPerSheet: 250_000,
  maxStringChars: 65_536,
};

export class WorkbookLimitError extends Error {
  constructor(message: string) {
    super(`The workbook is too large or unusual to import safely: ${message}`);
    this.name = 'WorkbookLimitError';
  }
}

const mb = (n: number): string => `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  localOffset: number;
}

const u16 = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, o: number): number => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

/** Read the zip central directory (sizes there are only used to locate data, never trusted as output sizes). */
function readZipDirectory(buf: Uint8Array): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a readable XLSX workbook (no zip directory).');
  const count = u16(buf, eocd + 10);
  const cdOffset = u32(buf, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new WorkbookLimitError('zip64 archives are not supported');
  const entries = new Map<string, ZipEntry>();
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || u32(buf, p) !== 0x02014b50) throw new Error('Not a readable XLSX workbook (damaged zip directory).');
    const method = u16(buf, p + 10);
    const compSize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOffset = u32(buf, p + 42);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate ONE part, never producing more than `budget` bytes (zlib stops and throws instead of allocating more). */
function extractPart(buf: Uint8Array, entry: ZipEntry, budget: number, label: string): Uint8Array {
  const o = entry.localOffset;
  if (o + 30 > buf.length || u32(buf, o) !== 0x04034b50) throw new Error('Not a readable XLSX workbook (damaged zip entry).');
  const start = o + 30 + u16(buf, o + 26) + u16(buf, o + 28);
  const data = buf.subarray(start, start + entry.compSize);
  if (start + entry.compSize > buf.length) throw new Error('Not a readable XLSX workbook (truncated zip entry).');
  if (entry.method === 0) {
    if (data.length > budget) throw new WorkbookLimitError(`${label} is larger than the ${mb(budget)} allowed`);
    return data;
  }
  if (entry.method !== 8) throw new Error(`Not a readable XLSX workbook (unsupported compression ${entry.method}).`);
  try {
    return inflateRawSync(data, { maxOutputLength: Math.max(1, budget) });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError) {
      throw new WorkbookLimitError(`${label} expands to more than the ${mb(budget)} allowed`);
    }
    throw new Error('Not a readable XLSX workbook (damaged compressed data).');
  }
}

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

export function readWorkbook(bytes: Uint8Array, limitOverrides: Partial<WorkbookLimits> = {}): Workbook {
  const limits: WorkbookLimits = { ...DEFAULT_WORKBOOK_LIMITS, ...limitOverrides };
  if (bytes.length > limits.maxFileBytes) {
    throw new WorkbookLimitError(`the file is ${mb(bytes.length)}, over the ${mb(limits.maxFileBytes)} limit`);
  }
  const directory = readZipDirectory(bytes);
  let used = 0;
  const read = (name: string): string | undefined => {
    const entry = directory.get(name);
    if (!entry) return undefined;
    const budget = Math.min(limits.maxPartBytes, limits.maxTotalBytes - used);
    if (budget <= 0) throw new WorkbookLimitError(`the parts together expand to more than ${mb(limits.maxTotalBytes)}`);
    const out = extractPart(bytes, entry, budget, `"${name}"`);
    used += out.length;
    return decoder.decode(out);
  };

  // Only the parts the workbook actually references are inflated: unreferenced junk in the zip is never touched.
  const workbookXml = read('xl/workbook.xml');
  const relsXml = read('xl/_rels/workbook.xml.rels');
  if (!workbookXml || !relsXml) throw new Error('Not a readable XLSX workbook (missing workbook.xml or its relationships).');

  const rels = new Map<string, string>();
  const relDoc = parser.parse(relsXml) as Record<string, any>;
  for (const r of asArray<Record<string, string>>(relDoc.Relationships?.Relationship)) {
    rels.set(r['@_Id'] as string, r['@_Target'] as string);
  }

  const sharedXml = read('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sharedXml) {
    const sd = parser.parse(sharedXml) as Record<string, any>;
    for (const si of asArray(sd.sst?.si)) {
      const t = stringItemText(si);
      if (t.length > limits.maxStringChars) throw new WorkbookLimitError(`a shared string has ${t.length} characters (limit ${limits.maxStringChars})`);
      shared.push(t);
    }
  }
  const dateStyles = dateStyleIndexes(read('xl/styles.xml'));

  const wbDoc = parser.parse(workbookXml) as Record<string, any>;
  const sheetDefs = asArray<Record<string, string>>(wbDoc.workbook?.sheets?.sheet);
  const sheets: Sheet[] = [];

  for (const def of sheetDefs) {
    const name = def['@_name'] as string;
    const relId = def['@_id'] as string; // r:id with the namespace prefix removed
    const target = rels.get(relId);
    if (!target) throw new Error(`Sheet "${name}" has no relationship target.`);
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = read(path);
    if (!xml) throw new Error(`Sheet "${name}" part is missing: ${path}`);
    sheets.push(parseSheet(name, xml, shared, dateStyles, limits));
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

function parseSheet(name: string, xml: string, shared: string[], dateStyles: Set<number>, limits: WorkbookLimits): Sheet {
  const doc = parser.parse(xml) as Record<string, any>;
  const cells = new Map<string, Cell>();
  let maxRow = 0;
  let maxCol = 0;
  for (const row of asArray<Record<string, any>>(doc.worksheet?.sheetData?.row)) {
    for (const c of asArray<Record<string, any>>(row.c)) {
      const ref = c['@_r'] as string | undefined;
      if (!ref) continue;
      if (cells.size >= limits.maxCellsPerSheet) {
        throw new WorkbookLimitError(`sheet "${name}" has more than ${limits.maxCellsPerSheet} cells`);
      }
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
        if (value.length > limits.maxStringChars) throw new WorkbookLimitError(`a string in sheet "${name}" has ${value.length} characters (limit ${limits.maxStringChars})`);
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
