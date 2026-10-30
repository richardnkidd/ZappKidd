/**
 * Sheet-level readers for the household workbook: turns coordinates into rows with preserved raw values.
 * No interpretation happens here (that is normalize.ts); this module only knows where the tables are.
 */
import { numberToCol, colToNumber, rawValue, text, numberAt, type Sheet } from './xlsx';

export type Raw = Record<string, string | number | boolean | null>;

export interface TableRow {
  sheet: string;
  row: number;
  /** e.g. 'A7:Q7' */
  range: string;
  /** Trimmed text of a column (null when blank). Date cells are civil dates. */
  t(col: string): string | null;
  n(col: string): number | null;
  /** Original column-name → original value for every column in the table, exactly as read. */
  raw: Raw;
}

export interface TableSpec {
  headerRow: number;
  firstCol: string;
  lastCol: string;
  /** First data row (default headerRow + 1). */
  startRow?: number;
  /** Table ends at the first row whose first column is blank, or at endRow. */
  endRow?: number;
  /** Optional ID shape: rows whose first cell does not match end the table. */
  idPattern?: RegExp;
}

export function readTable(sheet: Sheet, spec: TableSpec): TableRow[] {
  const first = colToNumber(spec.firstCol);
  const last = colToNumber(spec.lastCol);
  const headers: Record<string, string> = {};
  for (let c = first; c <= last; c++) {
    const col = numberToCol(c);
    headers[col] = text(sheet, `${col}${spec.headerRow}`) ?? col;
  }
  const out: TableRow[] = [];
  const start = spec.startRow ?? spec.headerRow + 1;
  const end = spec.endRow ?? sheet.max_row;
  for (let r = start; r <= end; r++) {
    const id = text(sheet, `${spec.firstCol}${r}`);
    if (id === null) break;
    if (spec.idPattern && !spec.idPattern.test(id)) break;
    const raw: Raw = {};
    for (let c = first; c <= last; c++) {
      const col = numberToCol(c);
      let key = headers[col] as string;
      if (key in raw) key = `${key} (${col})`;
      raw[key] = rawValue(sheet, `${col}${r}`);
    }
    out.push({
      sheet: sheet.name,
      row: r,
      range: `${spec.firstCol}${r}:${spec.lastCol}${r}`,
      t: (col: string) => text(sheet, `${col}${r}`),
      n: (col: string) => numberAt(sheet, `${col}${r}`),
      raw,
    });
  }
  return out;
}

/** The workbook's tables, located by coordinates (see the sheet dumps for the layout). */
export const TABLES = {
  dates_anchors: { sheet: 'Dates', headerRow: 6, firstCol: 'A', lastCol: 'E', endRow: 20 },
  dates_commitments: { sheet: 'Dates', headerRow: 6, firstCol: 'G', lastCol: 'I', endRow: 15 },
  dates_rules: { sheet: 'Dates', headerRow: 36, firstCol: 'G', lastCol: 'K', endRow: 54 },
  milestones: { sheet: 'Milestones', headerRow: 6, firstCol: 'A', lastCol: 'Q', idPattern: /^W\d{2}$/ },
  workstreams: { sheet: 'Workstreams', headerRow: 6, firstCol: 'A', lastCol: 'G', idPattern: /^S\d{2}$/ },
  questionnaire: { sheet: 'Questionnaire', headerRow: 6, firstCol: 'A', lastCol: 'J', idPattern: /^Q\d{3}$/ },
  decisions: { sheet: 'Decisions', headerRow: 6, firstCol: 'A', lastCol: 'H', idPattern: /^D\d{2}$/ },
  risks: { sheet: 'Risks', headerRow: 6, firstCol: 'A', lastCol: 'H', idPattern: /^R\d{2}$/ },
  documents: { sheet: 'Documents', headerRow: 6, firstCol: 'A', lastCol: 'I', idPattern: /^DOC\d{2}$/ },
  costs: { sheet: 'Cost Inputs', headerRow: 6, firstCol: 'A', lastCol: 'X', idPattern: /^B\d{2}$/ },
  arrival: { sheet: 'Arrival', headerRow: 6, firstCol: 'A', lastCol: 'H', idPattern: /^A\d{2}$/ },
  horizon: { sheet: 'Three-Year Horizon', headerRow: 6, firstCol: 'A', lastCol: 'G', idPattern: /^Y\d{2}$/ },
  horizon_expiries: { sheet: 'Three-Year Horizon', headerRow: 20, firstCol: 'A', lastCol: 'G', idPattern: /^EX\d{2}$/ },
  future_options: { sheet: 'Future Work', headerRow: 6, firstCol: 'A', lastCol: 'J', idPattern: /^[A-Z]$/ },
  future_phases: { sheet: 'Future Work', headerRow: 13, firstCol: 'A', lastCol: 'J', idPattern: /^FW\d{2}$/ },
  future_notes: { sheet: 'Future Work', headerRow: 23, firstCol: 'A', lastCol: 'D', idPattern: /^FN\d{2}$/ },
  evidence: { sheet: 'Evidence', headerRow: 6, firstCol: 'A', lastCol: 'G', idPattern: /^[A-Za-z]+\d*$/ },
  contacts: { sheet: 'Evidence', headerRow: 6, firstCol: 'I', lastCol: 'M' },
  inventory: { sheet: 'Property Shipping', headerRow: 6, firstCol: 'A', lastCol: 'L', idPattern: /^INV\d{2}$/ },
  property: { sheet: 'Property Shipping', headerRow: 6, firstCol: 'N', lastCol: 'T', idPattern: /^PROP\d{2}$/ },
} as const satisfies Record<string, TableSpec & { sheet: string }>;

export type TableName = keyof typeof TABLES;

export function table(wb: { sheet(name: string): Sheet }, name: TableName): TableRow[] {
  const spec = TABLES[name] as TableSpec & { sheet: string };
  return readTable(wb.sheet(spec.sheet), spec);
}
