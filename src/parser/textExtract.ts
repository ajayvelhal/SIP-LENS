// src/parser/textExtract.ts
// pdfjs TextContent -> PositionedItem[] -> Row[] (design §3.4): y-grouping into rows, cell merging,
// page-furniture removal and the lexers for the numbers and dates a CAS prints. Pure functions; no pdfjs import,
// so the same code runs under the browser worker and under the Node test harness.

import type { ISODate } from './types';

export interface PositionedItem {
  str: string;
  /** Left edge, PDF points. */
  x: number;
  /** Top-down y in PDF points (page height minus baseline), rounded to 0.5 pt. */
  y: number;
  w: number;
  h: number;
  page: number;
  fontName?: string;
}

export interface Cell {
  text: string;
  x0: number;
  x1: number;
  /** True when the whole cell is one printed number (Indian grouping, optional parentheses or minus). */
  numeric: boolean;
}

export interface Row {
  page: number;
  y: number;
  cells: Cell[];
  /** Cells joined with a single space, whitespace collapsed. */
  text: string;
}

/** The subset of pdfjs's TextContent the extractor reads. Kept structural so no pdfjs type is imported here. */
export interface TextContentLike {
  items: ReadonlyArray<{ str?: string; transform?: ArrayLike<number>; width?: number; height?: number; fontName?: string }>;
}

const NUMBER_RE = /^\(?-?\d[\d,]*(?:\.\d+)?\)?$/;
const DATE_RE = /^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})$|^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function isNumericText(s: string): boolean {
  return NUMBER_RE.test(s.trim());
}

/** "2,31,291.09" -> 231291.09; "(1,234.50)" or "-1,234.50" -> -1234.5 (E50). Returns null for non-numbers. */
export function parseNumber(text: string): { value: number; decimals: number } | null {
  const t = text.trim();
  if (!NUMBER_RE.test(t)) return null;
  const negative = t.startsWith('(') || t.startsWith('-');
  const digits = t.replace(/[(),-]/g, '');
  const dot = digits.indexOf('.');
  const decimals = dot === -1 ? 0 : digits.length - dot - 1;
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, decimals };
}

/** "10-Feb-2016", "10/02/2016" -> '2016-02-10'. Validates the calendar (V-8). Returns null otherwise. */
export function parseCasDate(text: string): ISODate | null {
  const m = DATE_RE.exec(text.trim());
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (m[1] !== undefined) {
    d = Number(m[1]);
    const mon = MONTHS[(m[2] ?? '').toLowerCase()];
    if (mon === undefined) return null;
    mo = mon;
    y = Number(m[3]);
  } else {
    d = Number(m[4]);
    mo = Number(m[5]);
    y = Number(m[6]);
  }
  if (y < 1990 || y > 2199 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` as ISODate;
}

/** pdfjs items -> positioned items. Drops the empty EOL markers and the zero-height spacer items pdfjs emits. */
export function itemsFromTextContent(content: TextContentLike, page: number, pageHeight: number): PositionedItem[] {
  const out: PositionedItem[] = [];
  for (const it of content.items) {
    const str = it.str;
    if (!str || !str.trim() || !it.transform) continue;
    const x = Number(it.transform[4]);
    const baseline = Number(it.transform[5]);
    const h = Number(it.height ?? 0) || Math.abs(Number(it.transform[3])) || 0;
    const w = Number(it.width ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(baseline)) continue;
    out.push({ str, x, y: Math.round((pageHeight - baseline) * 2) / 2, w, h, page, fontName: it.fontName });
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * Groups one page's items into rows (design §3.4): sort by y, cluster items whose y differ by at most
 * 0.45 x the median item height, sort each row by x and merge items whose gap is below 0.6 x the row's
 * average character width (kerned or space-split descriptions become one cell).
 */
export function groupRows(items: PositionedItem[], page: number): Row[] {
  if (items.length === 0) return [];
  const heights = items.map((i) => i.h).filter((h) => h > 0);
  const tol = Math.max(1, 0.45 * (median(heights) || 7.5));
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const clusters: PositionedItem[][] = [];
  let current: PositionedItem[] = [];
  let currentY = Number.NaN;
  for (const it of sorted) {
    if (current.length === 0 || Math.abs(it.y - currentY) <= tol) {
      current.push(it);
      if (current.length === 1) currentY = it.y;
    } else {
      clusters.push(current);
      current = [it];
      currentY = it.y;
    }
  }
  if (current.length) clusters.push(current);

  const rows: Row[] = [];
  for (const cluster of clusters) {
    cluster.sort((a, b) => a.x - b.x);
    const totalW = cluster.reduce((a, i) => a + i.w, 0);
    const totalLen = cluster.reduce((a, i) => a + i.str.length, 0);
    const charW = totalLen > 0 && totalW > 0 ? totalW / totalLen : 3.5;
    const mergeGap = 0.6 * charW;
    const cells: Cell[] = [];
    for (const it of cluster) {
      const last = cells[cells.length - 1];
      if (last && it.x - last.x1 < mergeGap) {
        const gap = it.x - last.x1;
        last.text = last.text + (gap > 0.25 * charW && !last.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
        last.x1 = Math.max(last.x1, it.x + it.w);
      } else {
        cells.push({ text: it.str, x0: it.x, x1: it.x + it.w, numeric: false });
      }
    }
    for (const c of cells) {
      c.text = collapseWhitespace(c.text);
      c.numeric = isNumericText(c.text);
    }
    const nonEmpty = cells.filter((c) => c.text.length > 0);
    if (nonEmpty.length === 0) continue;
    const y = cluster[0]?.y ?? 0;
    rows.push({ page, y, cells: nonEmpty, text: nonEmpty.map((c) => c.text).join(' ') });
  }
  return rows;
}

export function maskDigits(s: string): string {
  return s.replace(/\d/g, '#');
}

const PAGE_X_OF_Y = /^Page\s+\d+\s+of\s+\d+$/i;

/**
 * Removes repeated page headers and footers (E52): rows whose digit-masked text sits at the same y on every
 * page, plus any row carrying a "Page N of M" cell. Single-page documents only lose the "Page 1 of 1" row;
 * their remaining furniture is prose outside any scheme section and is ignored by the state machine.
 */
export function dropPageFurniture(pages: Row[][]): Row[][] {
  const pageCount = pages.length;
  const keyOf = (r: Row) => `${r.y}|${maskDigits(r.text)}`;
  const seenOn = new Map<string, Set<number>>();
  pages.forEach((rows, idx) => {
    for (const r of rows) {
      let s = seenOn.get(keyOf(r));
      if (!s) { s = new Set(); seenOn.set(keyOf(r), s); }
      s.add(idx);
    }
  });
  return pages.map((rows) =>
    rows.filter((r) => {
      if (r.cells.some((c) => PAGE_X_OF_Y.test(c.text))) return false;
      if (pageCount >= 2 && (seenOn.get(keyOf(r))?.size ?? 0) === pageCount) return false;
      return true;
    }),
  );
}
