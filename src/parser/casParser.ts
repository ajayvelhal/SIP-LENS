// src/parser/casParser.ts
// Line-structure CAS parser (design §3.4, corrected per spec C6): typed rows -> state machine over folio and
// scheme sections -> drafted transaction rows -> (reconcile.ts) Folios -> Funds -> Portfolio.
// Knows nothing about returns. No pdfjs import: it consumes the Row[] the extractor produced.

import type { Fund, Folio, ISODate, ParseResult, ParseWarning, Portfolio, Rta } from './types';
import type { Cell, Row } from './textExtract';
import { parseCasDate, parseNumber, maskDigits } from './textExtract';
import { isSchemeHeaderRow, parseSchemeHeader, cleanSchemeName, normaliseSchemeName } from './schemeName';
import { rtaFromRegistrar } from './detect';
import { buildFolio, makeWarning, type DraftTx, type SectionDraft, type WarningSink } from './reconcile';

export interface WalkContext {
  issuer: Rta;
  pageCount: number;
  /** Pages whose extraction threw (E13); funds whose sections touch them are flagged. */
  failedPages?: readonly number[];
  /** Called for each warning as soon as it is known (worker 'partial-warning' events). */
  onWarning?: (w: ParseWarning) => void;
}

export type WalkOutcome =
  | { kind: 'not-cas' }
  | { kind: 'summary'; schemeNames: string[]; statementDate?: ISODate }
  | { kind: 'detailed'; result: Omit<ParseResult, 'stats'> & { stats: Omit<ParseResult['stats'], 'extractMs' | 'parseMs'> } };

type RowType =
  | 'period' | 'folio' | 'scheme-cams' | 'scheme-meta' | 'isin-only' | 'scheme-name' | 'amc'
  | 'opening' | 'columns' | 'closing' | 'valuation' | 'dated' | 'text';

interface TypedRow {
  row: Row;
  type: RowType;
}

interface Anchors {
  amount?: number;
  units?: number;
  nav?: number;
  balance?: number;
}

const PERIOD_RE = /(\d{2}-[A-Za-z]{3}-\d{4}|\d{2}\/\d{2}\/\d{4})\s*(?:To|TO|to|-|–)\s*(\d{2}-[A-Za-z]{3}-\d{4}|\d{2}\/\d{2}\/\d{4})/;
const FOLIO_RE = /^Folio\s*No\.?\s*:\s*(.+?)(?:\s+PAN\b|\s+KYC\b|\s*$)/i;
const PAN_RE = /\bPAN\s*:\s*([A-Z0-9]{10})\b/i;
const OPENING_RE = /^Opening\s+Unit\s+Balance\s*:?\s*(\(?-?[\d,]+(?:\.\d+)?\)?)/i;
const CLOSING_RE = /Closing\s+Unit\s+Balance\s*:?\s*(\(?-?[\d,]+(?:\.\d+)?\)?)/i;
const NAV_ON_RE = /NAV\s+(?:as\s+)?on\s+(\d{2}-[A-Za-z]{3}-\d{4}|\d{2}\/\d{2}\/\d{4})\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)/i;
const MARKET_VALUE_RE = /(?:Market|Current)\s+Value(?:\s+(?:as\s+)?on\s+(\d{2}-[A-Za-z]{3}-\d{4}|\d{2}\/\d{2}\/\d{4}))?\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)/i;
const COST_VALUE_RE = /Cost\s+Value\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)/i;
const INVESTOR_NAME_RE = /^[A-Z][A-Z .'&-]{2,}$/;
const ANCHOR_DISTANCE = 30;

function typeRow(row: Row): RowType {
  const t = row.text;
  const first = row.cells[0] as Cell;
  if (row.cells.length > 0 && parseCasDate(first.text) !== null) return 'dated';
  if (FOLIO_RE.test(t)) return 'folio';
  if (OPENING_RE.test(t)) return 'opening';
  if (CLOSING_RE.test(t)) return 'closing';
  if (MARKET_VALUE_RE.test(t) || COST_VALUE_RE.test(t)) return 'valuation';
  if (isColumnsRow(row)) return 'columns';
  if (isSchemeHeaderRow(t)) {
    const parts = parseSchemeHeader(t);
    if (parts.name.length > 0) return 'scheme-cams';
    if (parts.advisor !== undefined || parts.registrar !== undefined) return 'scheme-meta';
    return 'isin-only';
  }
  if (PERIOD_RE.test(t)) return 'period';
  return 'text';
}

function isColumnsRow(row: Row): boolean {
  if (row.cells.length < 3 || row.cells.some((c) => c.numeric)) return false;
  if (!/^date\b/i.test((row.cells[0] as Cell).text)) return false;
  const hits = row.cells.filter((c) => /transaction|description|particular|amount|^units?\b|nav|balance/i.test(c.text)).length;
  return hits >= 3;
}

function anchorsFrom(row: Row): Anchors {
  const a: Anchors = {};
  for (const c of row.cells) {
    const t = c.text.toLowerCase();
    if (/balance/.test(t)) a.balance = c.x1;
    else if (/amount/.test(t)) a.amount = c.x1;
    else if (/^units?\b/.test(t)) a.units = c.x1;
    else if (/nav|price/.test(t)) a.nav = c.x1;
  }
  return a;
}

/** Pre-pass: type every row and mark the AMC / scheme-name text rows that precede a scheme header. */
function typeRows(pages: Row[][]): TypedRow[] {
  const typed: TypedRow[] = pages.flat().map((row) => ({ row, type: typeRow(row) }));
  for (let i = 0; i < typed.length; i++) {
    const cur = typed[i] as TypedRow;
    const prev = typed[i - 1];
    const prev2 = typed[i - 2];
    if (cur.type === 'scheme-cams') {
      if (prev && prev.type === 'text') prev.type = 'amc';
    } else if (cur.type === 'scheme-meta' || (cur.type === 'isin-only' && prev && prev.type === 'text')) {
      if (prev && prev.type === 'text') {
        prev.type = 'scheme-name';
        if (prev2 && prev2.type === 'text') prev2.type = 'amc';
        cur.type = 'scheme-meta';
      }
    }
  }
  return typed;
}

interface FolioHeader {
  folioNumber: string;
  pan?: string;
}

function parseFolioHeader(text: string): FolioHeader {
  const m = FOLIO_RE.exec(text);
  const folioNumber = (m?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const pan = PAN_RE.exec(text)?.[1]?.toUpperCase();
  const header: FolioHeader = { folioNumber };
  if (pan && pan !== 'OK') header.pan = pan;
  return header;
}

/** Assigns a row's numeric cells to the calibrated columns; returns undefined fields for absent cells. */
function assignNumbers(cells: Cell[], anchors: Anchors | undefined): Pick<DraftTx, 'amount' | 'units' | 'unitsDecimals' | 'nav' | 'unitBalance' | 'drift'> {
  const out: Pick<DraftTx, 'amount' | 'units' | 'unitsDecimals' | 'nav' | 'unitBalance' | 'drift'> = {};
  const numeric = cells.filter((c) => c.numeric);
  if (numeric.length === 0) return out;
  const named: Array<[keyof Anchors, number]> = anchors
    ? (Object.entries(anchors) as Array<[keyof Anchors, number]>).filter(([, x]) => x !== undefined)
    : [];
  if (named.length === 0) {
    // No column header seen: only the unambiguous 4-cell and 1-cell layouts are trusted (design §7.4).
    if (numeric.length === 4) {
      const [a, u, n, b] = numeric as [Cell, Cell, Cell, Cell];
      setAmount(out, a); setUnits(out, u); setNav(out, n); setBalance(out, b);
    } else if (numeric.length === 1) {
      setAmount(out, numeric[0] as Cell);
    } else out.drift = true;
    return out;
  }
  const used = new Set<keyof Anchors>();
  for (const cell of numeric) {
    let best: keyof Anchors | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const [name, x] of named) {
      const d = Math.abs(cell.x1 - x);
      if (d < bestD) { bestD = d; best = name; }
    }
    if (best === undefined || bestD > ANCHOR_DISTANCE || used.has(best)) { out.drift = true; continue; }
    used.add(best);
    if (best === 'amount') setAmount(out, cell);
    else if (best === 'units') setUnits(out, cell);
    else if (best === 'nav') setNav(out, cell);
    else setBalance(out, cell);
  }
  return out;
}

type NumOut = Pick<DraftTx, 'amount' | 'units' | 'unitsDecimals' | 'nav' | 'unitBalance' | 'drift'>;
function setAmount(o: NumOut, c: Cell) { const n = parseNumber(c.text); if (n) o.amount = n.value; }
function setUnits(o: NumOut, c: Cell) { const n = parseNumber(c.text); if (n) { o.units = n.value; o.unitsDecimals = n.decimals; } }
function setNav(o: NumOut, c: Cell) { const n = parseNumber(c.text); if (n) o.nav = n.value; }
function setBalance(o: NumOut, c: Cell) { const n = parseNumber(c.text); if (n) o.unitBalance = n.value; }

interface WalkState {
  period?: { from: ISODate; to: ISODate };
  investorName?: string;
  pans: Set<string>;
  sections: SectionDraft[];
  current?: SectionDraft;
  folio?: FolioHeader;
  anchors?: Anchors;
  state: 'doc' | 'folio' | 'scheme' | 'txn' | 'closed';
  datedRows: number;
  valuationRows: number;
  /** Two consecutive text rows kept so a scheme header can take its name / AMC from them. */
  pendingAmc?: string;
  pendingName?: string;
  firstUnitsDecimals?: number;
}

/** Walks the typed rows into section drafts (the state machine of design §3.4). */
function walk(pages: Row[][], ctx: WalkContext): WalkState {
  const typed = typeRows(pages);
  const st: WalkState = { pans: new Set(), sections: [], state: 'doc', datedRows: 0, valuationRows: 0 };

  const closeSection = () => {
    if (st.current) st.sections.push(st.current);
    st.current = undefined;
  };
  const startSection = (name: string, parts: ReturnType<typeof parseSchemeHeader>, amc: string | undefined, page: number) => {
    closeSection();
    const folio = st.folio ?? { folioNumber: '' };
    const rta = rtaFromRegistrar(parts.registrar) ?? ctx.issuer;
    const section: SectionDraft = {
      folioNumber: folio.folioNumber,
      rta,
      schemeName: cleanSchemeName(name),
      openingUnits: 0,
      headerPage: page,
      lastPage: page,
      rows: [],
    };
    if (folio.pan !== undefined) section.pan = folio.pan;
    if (parts.isin !== undefined) section.isin = parts.isin;
    if (parts.amfiCode !== undefined) section.amfiCode = parts.amfiCode;
    if (amc !== undefined) section.amc = amc;
    st.current = section;
    st.state = 'scheme';
  };

  for (let i = 0; i < typed.length; i++) {
    const { row, type } = typed[i] as TypedRow;
    switch (type) {
      case 'period': {
        if (st.state === 'doc' && !st.period) {
          const m = PERIOD_RE.exec(row.text);
          const from = m ? parseCasDate(m[1] as string) : null;
          const to = m ? parseCasDate(m[2] as string) : null;
          if (from && to && from <= to) st.period = { from, to };
        } else if (st.state === 'txn') appendContinuation(st, row);
        break;
      }
      case 'folio': {
        closeSection();
        st.folio = parseFolioHeader(row.text);
        if (st.folio.pan) st.pans.add(st.folio.pan);
        st.state = 'folio';
        st.pendingAmc = st.pendingName = undefined;
        break;
      }
      case 'amc': {
        st.pendingAmc = row.text;
        break;
      }
      case 'scheme-name': {
        st.pendingName = row.text;
        break;
      }
      case 'scheme-cams': {
        const parts = parseSchemeHeader(row.text);
        startSection(parts.name, parts, st.pendingAmc, row.page);
        st.pendingAmc = st.pendingName = undefined;
        break;
      }
      case 'scheme-meta': {
        const parts = parseSchemeHeader(row.text);
        startSection(st.pendingName ?? parts.name, parts, st.pendingAmc, row.page);
        st.pendingAmc = st.pendingName = undefined;
        break;
      }
      case 'isin-only': {
        const parts = parseSchemeHeader(row.text);
        if (st.current && st.state === 'scheme') {
          if (parts.isin !== undefined && st.current.isin === undefined) st.current.isin = parts.isin;
          if (parts.amfiCode !== undefined && st.current.amfiCode === undefined) st.current.amfiCode = parts.amfiCode;
        } else if (st.state === 'txn') appendContinuation(st, row);
        break;
      }
      case 'opening': {
        if (st.current) {
          const n = parseNumber((OPENING_RE.exec(row.text)?.[1] ?? '').trim());
          if (n) { st.current.openingUnits = n.value; st.current.openingDecimals = n.decimals; }
          st.state = 'txn';
          st.current.lastPage = row.page;
        }
        break;
      }
      case 'columns': {
        st.anchors = anchorsFrom(row);
        if (st.current && st.state === 'scheme') st.state = 'txn';
        break;
      }
      case 'closing': {
        if (st.current) {
          const closing = (st.current.closing ??= {});
          const units = parseNumber((CLOSING_RE.exec(row.text)?.[1] ?? '').trim());
          if (units) { closing.units = units.value; closing.unitsDecimals = units.decimals; }
          const nav = NAV_ON_RE.exec(row.text);
          if (nav) {
            const d = parseCasDate(nav[1] as string);
            const v = parseNumber(nav[2] as string);
            if (d) closing.navDate = d;
            if (v) closing.nav = v.value;
          }
          st.current.closingPage = row.page;
          st.current.lastPage = row.page;
          st.valuationRows++;
          st.state = 'closed';
        }
        break;
      }
      case 'valuation': {
        if (st.current) {
          const closing = (st.current.closing ??= {});
          const mv = MARKET_VALUE_RE.exec(row.text);
          if (mv) {
            const v = parseNumber(mv[2] as string);
            if (v) closing.value = v.value;
            const d = mv[1] ? parseCasDate(mv[1]) : null;
            if (d) closing.valueDate = d;
          }
          const cv = COST_VALUE_RE.exec(row.text);
          if (cv) { const v = parseNumber(cv[1] as string); if (v) closing.costValue = v.value; }
          st.valuationRows++;
          if (st.state !== 'txn') st.state = 'closed';
        }
        break;
      }
      case 'dated': {
        if (st.current && (st.state === 'txn' || st.state === 'scheme')) {
          const first = row.cells[0] as Cell;
          const date = parseCasDate(first.text) as ISODate;
          const rest = row.cells.slice(1);
          const nums = assignNumbers(rest, st.anchors);
          const description = rest.filter((c) => !c.numeric).map((c) => c.text).join(' ');
          const draft: DraftTx = { date, description, page: row.page, ...nums };
          if (nums.unitsDecimals !== undefined && st.firstUnitsDecimals === undefined) st.firstUnitsDecimals = nums.unitsDecimals;
          st.current.rows.push(draft);
          st.current.lastPage = row.page;
          st.datedRows++;
          st.state = 'txn';
        }
        break;
      }
      case 'text': {
        if (st.state === 'doc' && st.investorName === undefined && INVESTOR_NAME_RE.test(row.text) && !/STATEMENT/.test(row.text)) {
          st.investorName = row.text;
        }
        if (st.state === 'txn') appendContinuation(st, row);
        break;
      }
      default:
        break;
    }
  }
  closeSection();
  return st;
}

/** Undated row inside a table: continuation of the previous description, with its numbers if it has none yet (E51). */
function appendContinuation(st: WalkState, row: Row): void {
  const section = st.current;
  const last = section?.rows[section.rows.length - 1];
  if (!section || !last) return;
  const text = row.cells.filter((c) => !c.numeric).map((c) => c.text).join(' ');
  if (text) last.description = last.description ? `${last.description} ${text}` : text;
  const hasNumbers = last.amount !== undefined || last.units !== undefined || last.nav !== undefined || last.unitBalance !== undefined;
  if (!hasNumbers && row.cells.some((c) => c.numeric)) {
    const nums = assignNumbers(row.cells, st.anchors);
    Object.assign(last, nums);
    if (nums.unitsDecimals !== undefined && st.firstUnitsDecimals === undefined) st.firstUnitsDecimals = nums.unitsDecimals;
  }
  section.lastPage = row.page;
}

const WORST: Record<Folio['reconciliation']['status'], number> = { ok: 0, 'no-closing-balance': 1, mismatch: 2 };

/**
 * Walks every page's rows and either rejects (not a CAS / summary CAS) or assembles the Portfolio.
 * `parsedAt` is injected by the caller (the worker's only wall-clock read) and never read here.
 */
export function parseRows(pages: Row[][], ctx: WalkContext, parsedAt: string): WalkOutcome {
  const st = walk(pages, ctx);
  if (st.sections.length === 0) return { kind: 'not-cas' };
  if (st.datedRows === 0) {
    if (st.valuationRows > 0) {
      const summary: WalkOutcome = { kind: 'summary', schemeNames: st.sections.map((s) => s.schemeName) };
      if (st.period) summary.statementDate = st.period.to;
      return summary;
    }
    return { kind: 'not-cas' };
  }

  const warnings: ParseWarning[] = [];
  const sink: WarningSink = {
    push: (w) => { warnings.push(w); ctx.onWarning?.(w); },
  };

  // Statement date and period (A10, E54 / D7).
  let statementDate: ISODate;
  let statementPeriod: { from: ISODate; to: ISODate };
  if (st.period) {
    statementDate = st.period.to;
    statementPeriod = st.period;
  } else {
    let latest: ISODate | undefined;
    for (const s of st.sections) for (const r of s.rows) if (latest === undefined || r.date > latest) latest = r.date;
    statementDate = latest as ISODate;
    statementPeriod = { from: statementDate, to: statementDate };
    sink.push(makeWarning('MISSING_STATEMENT_DATE', { page: 1 }));
  }

  const unitDecimals: 3 | 4 = st.firstUnitsDecimals === 4 ? 4 : 3;

  // Sections -> funds. Identity: ISIN, else normalised name + folio (A22, P1). Duplicate sections (E53, P14) are skipped.
  const funds: Fund[] = [];
  const fundById = new Map<string, Fund>();
  const seenSections = new Set<string>();
  let folioCount = 0;
  let transactions = 0;
  let unclassified = 0;
  const failed = new Set(ctx.failedPages ?? []);

  for (const section of st.sections) {
    const fundId = section.isin ?? `name:${normaliseSchemeName(section.schemeName)}|${section.folioNumber}`;
    const sectionKey = `${section.folioNumber}|${section.isin ?? ''}|${normaliseSchemeName(section.schemeName)}`;
    let fund = fundById.get(fundId);
    if (!fund) {
      fund = { id: fundId, schemeName: section.schemeName, folios: [], closingUnits: 0, mayBeIncomplete: false };
      if (section.isin !== undefined) fund.isin = section.isin;
      if (section.amfiCode !== undefined) fund.amfiCode = section.amfiCode;
      if (section.amc !== undefined) fund.amc = section.amc;
      fundById.set(fundId, fund);
      funds.push(fund);
    } else if (fund.schemeName !== section.schemeName) {
      const also = new Set(fund.alsoPrintedAs ?? []);
      also.add(section.schemeName);
      fund.alsoPrintedAs = [...also];
    }
    const wctx = { fundId, folioNumber: section.folioNumber, schemeName: section.schemeName };
    if (seenSections.has(sectionKey)) {
      sink.push(makeWarning('DUPLICATE_SECTION', { ...wctx, page: section.headerPage }));
      continue;
    }
    seenSections.add(sectionKey);
    if (section.isin === undefined) sink.push(makeWarning('MISSING_ISIN', { ...wctx, page: section.headerPage }));

    const folioDecimals: 3 | 4 = firstUnitsDecimals(section) === 4 ? 4 : unitDecimals;
    const folio = buildFolio(section, fundId, folioDecimals, statementDate, sink);
    for (const p of failed) {
      if (p >= section.headerPage && p <= section.lastPage) sink.push(makeWarning('PAGE_EXTRACT_FAILED', { ...wctx, page: p }));
    }
    fund.folios.push(folio);
    folioCount++;
    transactions += folio.transactions.length;
    unclassified += folio.transactions.filter((t) => t.kind === 'unknown').length;
  }

  // Fund aggregates (V-11) and the mayBeIncomplete rule.
  for (const fund of funds) {
    let units = 0;
    let value: number | undefined;
    let nav: number | undefined;
    const dp = fund.folios[0]?.reconciliation.decimals ?? unitDecimals;
    for (const fo of fund.folios) {
      if (fo.closingUnits !== undefined) units += fo.closingUnits;
      if (fo.closingValue !== undefined) value = (value ?? 0) + fo.closingValue;
      if (fo.closingNav !== undefined) nav = fo.closingNav;
    }
    fund.closingUnits = roundTo(units, dp);
    if (nav !== undefined) fund.closingNav = nav;
    if (value !== undefined) fund.closingValue = roundTo(value, 2);
    const flagged = warnings.some((w) => w.fundId === fund.id && w.severity === 'flag');
    const recNotOk = fund.folios.some((fo) => fo.reconciliation.status !== 'ok');
    fund.mayBeIncomplete = flagged || recNotOk;
  }

  if (st.pans.size > 1) sink.push(makeWarning('MULTI_PAN', { page: 1 }));

  // P6 ordering: page, rowIndex, id (codepoint order so the result is locale-independent).
  warnings.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.rowIndex ?? -1) - (b.rowIndex ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const reconciliation: Record<string, Folio['reconciliation']['status']> = {};
  for (const fund of funds) {
    let worst: Folio['reconciliation']['status'] = 'ok';
    for (const fo of fund.folios) if (WORST[fo.reconciliation.status] > WORST[worst]) worst = fo.reconciliation.status;
    reconciliation[fund.id] = worst;
  }

  const portfolio: Portfolio = {
    schemaVersion: 1,
    issuer: ctx.issuer,
    statementDate,
    statementPeriod,
    parsedAt,
    investorCount: Math.max(1, st.pans.size),
    funds,
    pageCount: ctx.pageCount,
    unitDecimals,
  };
  if (st.investorName !== undefined) portfolio.investorName = st.investorName;

  const rows = pages.reduce((a, p) => a + p.length, 0);
  return {
    kind: 'detailed',
    result: {
      portfolio,
      warnings,
      reconciliation,
      stats: { pages: ctx.pageCount, rows, transactions, unclassified, folios: folioCount, funds: funds.length },
    },
  };
}

function firstUnitsDecimals(section: SectionDraft): number | undefined {
  for (const r of section.rows) if (r.unitsDecimals !== undefined) return r.unitsDecimals;
  return section.closing?.unitsDecimals ?? section.openingDecimals;
}

/**
 * Round half away from zero at `dp` decimals. Deliberately a copy of calculations/money.ts `roundTo`: design section 2
 * allows `parser/*` to import only `parser/*`, so the engine layers cannot share one module. tests/parser/roundTo.test.ts
 * pins the two to identical output; change them together.
 */
export function roundTo(n: number, dp: number): number {
  const f = 10 ** dp;
  const x = Math.abs(n) * f;
  const r = Math.floor(x + 0.5 + 1e-9);
  return (n < 0 ? -r : r) / f;
}

export { maskDigits };
