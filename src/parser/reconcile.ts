// src/parser/reconcile.ts
// Per-folio post-processing (design §3.4 reconcile steps 1-5, data design §2 invariants V-1..V-6):
// classification of the drafted rows into Transactions with stable ids, reversal pairing, stamp-duty / STT
// attachment, running- and closing-balance checks at the printed precision (A2), the amount ≈ units x NAV
// arithmetic check (V-3, raises COLUMN_DRIFT per D9) and the per-row warnings.

import type { Folio, FolioReconciliation, ISODate, ParseWarning, ParseWarningCode, Rta, Transaction, TransactionKind } from './types';
import { classifyDescription, PURCHASE_LIKE, REDEMPTION_LIKE, NO_CASH_KINDS } from './classify';
import { maskDigits } from './textExtract';

/** A transaction row as the state machine drafted it, before classification. */
export interface DraftTx {
  date: ISODate;
  description: string;
  page: number;
  amount?: number;
  units?: number;
  unitsDecimals?: number;
  nav?: number;
  unitBalance?: number;
  /** True when a numeric cell could not be assigned to a calibrated column (COLUMN_DRIFT). */
  drift?: boolean;
}

export interface SectionDraft {
  folioNumber: string;
  pan?: string;
  rta: Rta;
  /** Cleaned printed name (P2). */
  schemeName: string;
  isin?: string;
  amfiCode?: string;
  amc?: string;
  openingUnits: number;
  openingDecimals?: number;
  closing?: {
    units?: number;
    unitsDecimals?: number;
    nav?: number;
    navDate?: ISODate;
    value?: number;
    valueDate?: ISODate;
    costValue?: number;
  };
  headerPage: number;
  /** Page of the last row consumed by the section (for NO_CLOSING_BALANCE). */
  lastPage: number;
  closingPage?: number;
  rows: DraftTx[];
}

export interface WarningSink {
  push(w: ParseWarning): void;
}

export const FLAG_CODES: ReadonlySet<ParseWarningCode> = new Set([
  'UNCLASSIFIED_ROW', 'UNIT_MISMATCH', 'NO_CLOSING_BALANCE', 'ORPHAN_REVERSAL', 'FUTURE_DATED_ROW', 'COLUMN_DRIFT', 'PAGE_EXTRACT_FAILED',
]);

export function warningId(code: ParseWarningCode, fundId?: string, page?: number, rowIndex?: number): string {
  return `${code}:${fundId ?? '-'}:${page ?? '-'}:${rowIndex ?? '-'}`;
}

export function makeWarning(
  code: ParseWarningCode,
  ctx: { fundId?: string; folioNumber?: string; schemeName?: string; page?: number; rowIndex?: number; maskedRowText?: string },
): ParseWarning {
  const w: ParseWarning = {
    id: warningId(code, ctx.fundId, ctx.page, ctx.rowIndex),
    code,
    severity: FLAG_CODES.has(code) ? 'flag' : 'info',
  };
  if (ctx.fundId !== undefined) w.fundId = ctx.fundId;
  if (ctx.folioNumber !== undefined) w.folioNumber = ctx.folioNumber;
  if (ctx.schemeName !== undefined) w.schemeName = ctx.schemeName;
  if (ctx.page !== undefined) w.page = ctx.page;
  if (ctx.rowIndex !== undefined) w.rowIndex = ctx.rowIndex;
  if (ctx.maskedRowText !== undefined) w.maskedRowText = ctx.maskedRowText;
  return w;
}

const toInt = (value: number, decimals: number): number => Math.round(value * 10 ** decimals);
const fromInt = (value: number, decimals: number): number => value / 10 ** decimals;

/**
 * Builds the Folio for one scheme section. `decimals` is the printed unit precision in force for the folio (P12).
 * Warnings are pushed to `sink` with the fund context so the banner and the report can attribute them.
 */
export function buildFolio(section: SectionDraft, fundId: string, decimals: 3 | 4, statementDate: ISODate, sink: WarningSink): Folio {
  const ctx = { fundId, folioNumber: section.folioNumber, schemeName: section.schemeName };
  const idOf = (i: number) => `${fundId}:${section.folioNumber}:${i}`;
  const txs: Transaction[] = section.rows.map((row, i) => {
    const kind = classifyDescription(row.description, { units: row.units, amount: row.amount, nav: row.nav });
    const tx: Transaction = {
      id: idOf(i),
      rta: section.rta,
      folioNumber: section.folioNumber,
      schemeName: section.schemeName,
      date: row.date,
      description: row.description,
      kind,
      page: row.page,
      excludedFromCashflows: NO_CASH_KINDS.has(kind),
    };
    if (section.isin !== undefined) tx.isin = section.isin;
    if (section.amfiCode !== undefined) tx.amfiCode = section.amfiCode;
    if (row.amount !== undefined) tx.amount = row.amount;
    if (row.units !== undefined) tx.units = row.units;
    if (row.nav !== undefined) tx.nav = row.nav;
    if (row.unitBalance !== undefined) tx.unitBalance = row.unitBalance;
    return tx;
  });

  // 1. Reversal pairing (E18, E19) and AD5: a negative stamp-duty row reversing an earlier levy.
  txs.forEach((tx, i) => {
    if (tx.kind === 'reversal') {
      const j = findReversalTarget(txs, i);
      tx.excludedFromCashflows = true;
      if (j === -1) {
        sink.push(makeWarning('ORPHAN_REVERSAL', { ...ctx, page: tx.page, rowIndex: i, maskedRowText: maskDigits(tx.description) }));
      } else {
        const orig = txs[j] as Transaction;
        tx.reverses = orig.id;
        orig.reversedBy = tx.id;
        orig.excludedFromCashflows = true;
      }
    } else if (tx.kind === 'stamp_duty' && tx.amount !== undefined && tx.amount < 0) {
      const j = findLevyReversalTarget(txs, i);
      tx.excludedFromCashflows = true;
      if (j === -1) {
        sink.push(makeWarning('ORPHAN_LEVY', { ...ctx, page: tx.page, rowIndex: i, maskedRowText: maskDigits(tx.description) }));
      } else {
        const orig = txs[j] as Transaction;
        tx.reverses = orig.id;
        orig.reversedBy = tx.id;
        orig.excludedFromCashflows = true;
      }
    }
  });

  // 2-3. Levy attachment to the nearest earlier same-day parent (E20-E22).
  txs.forEach((tx, i) => {
    if ((tx.kind !== 'stamp_duty' && tx.kind !== 'stt_tds') || tx.reverses !== undefined) return;
    const parentKinds = tx.kind === 'stamp_duty' ? PURCHASE_LIKE : REDEMPTION_LIKE;
    let parent: Transaction | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const cand = txs[j] as Transaction;
      if (cand.date !== tx.date) continue;
      if (parentKinds.has(cand.kind)) { parent = cand; break; }
    }
    if (!parent) {
      sink.push(makeWarning('ORPHAN_LEVY', { ...ctx, page: tx.page, rowIndex: i, maskedRowText: maskDigits(tx.description) }));
      return;
    }
    tx.attachedTo = parent.id;
    (parent.levies ??= []).push(tx.id);
  });

  // Row warnings: unknown kinds, future-dated rows (P13: levies attached to a future-dated purchase are flagged too).
  txs.forEach((tx, i) => {
    if (tx.kind === 'unknown') {
      sink.push(makeWarning('UNCLASSIFIED_ROW', { ...ctx, page: tx.page, rowIndex: i, maskedRowText: maskDigits(tx.description) }));
    }
    if (tx.date > statementDate) {
      sink.push(makeWarning('FUTURE_DATED_ROW', { ...ctx, page: tx.page, rowIndex: i, maskedRowText: maskDigits(tx.description) }));
    }
    const row = section.rows[i];
    if (row?.drift || !arithmeticHolds(tx, decimals)) {
      sink.push(makeWarning('COLUMN_DRIFT', { ...ctx, page: tx.page, rowIndex: i, maskedRowText: maskDigits(tx.description) }));
    }
  });

  // 4-5. Running-balance and closing-balance checks at the printed precision (V-1, V-2).
  const tol = 2;
  const openingInt = toInt(section.openingUnits, decimals);
  let prev = openingInt;
  let firstMismatchRow: number | undefined;
  let sum = openingInt;
  txs.forEach((tx, i) => {
    const unitsInt = tx.units === undefined ? 0 : toInt(tx.units, decimals);
    sum += unitsInt;
    if (tx.unitBalance === undefined) return;
    const bal = toInt(tx.unitBalance, decimals);
    if (firstMismatchRow === undefined && Math.abs(bal - (prev + unitsInt)) > tol) firstMismatchRow = i;
    prev = bal;
  });
  const reconciliation: FolioReconciliation = {
    status: 'ok',
    computedClosingUnits: fromInt(sum, decimals),
    toleranceUnits: fromInt(tol, decimals),
    decimals,
  };
  if (firstMismatchRow !== undefined) reconciliation.firstMismatchRow = firstMismatchRow;

  const closing = section.closing;
  if (!closing || closing.units === undefined) {
    reconciliation.status = 'no-closing-balance';
    sink.push(makeWarning('NO_CLOSING_BALANCE', { ...ctx, page: section.lastPage }));
  } else {
    const printedInt = toInt(closing.units, decimals);
    reconciliation.printedClosingUnits = closing.units;
    reconciliation.diff = fromInt(sum - printedInt, decimals);
    if (firstMismatchRow !== undefined || Math.abs(sum - printedInt) > tol) {
      reconciliation.status = 'mismatch';
      const page = firstMismatchRow !== undefined ? (txs[firstMismatchRow] as Transaction).page : section.closingPage ?? section.lastPage;
      sink.push(makeWarning('UNIT_MISMATCH', { ...ctx, page, rowIndex: firstMismatchRow }));
    }
  }

  const folio: Folio = {
    folioNumber: section.folioNumber,
    rta: section.rta,
    openingUnits: section.openingUnits,
    transactions: txs,
    reconciliation,
  };
  if (closing && closing.units !== undefined) {
    folio.closingUnits = closing.units;
    if (closing.nav !== undefined) folio.closingNav = closing.nav;
    if (closing.value !== undefined) folio.closingValue = closing.value;
    const printedDate = closing.valueDate ?? closing.navDate;
    if (printedDate !== undefined && printedDate !== statementDate) folio.valuationDate = printedDate;
  }
  return folio;
}

/** Nearest earlier non-reversal row with the same |amount| and |units| (0.005 / 0.0005) and the opposite sign. */
function findReversalTarget(txs: Transaction[], i: number): number {
  const rev = txs[i] as Transaction;
  for (let j = i - 1; j >= 0; j--) {
    const c = txs[j] as Transaction;
    if (c.kind === 'reversal' || c.reversedBy !== undefined) continue;
    if (rev.amount !== undefined && c.amount !== undefined) {
      if (Math.abs(Math.abs(c.amount) - Math.abs(rev.amount)) > 0.005) continue;
      if (Math.sign(c.amount) === Math.sign(rev.amount)) continue;
    } else if (rev.amount !== undefined || c.amount !== undefined) continue;
    if (rev.units !== undefined && c.units !== undefined) {
      if (Math.abs(Math.abs(c.units) - Math.abs(rev.units)) > 0.0005) continue;
      if (Math.sign(c.units) === Math.sign(rev.units)) continue;
    } else if (rev.units !== undefined || c.units !== undefined) continue;
    return j;
  }
  return -1;
}

function findLevyReversalTarget(txs: Transaction[], i: number): number {
  const rev = txs[i] as Transaction;
  for (let j = i - 1; j >= 0; j--) {
    const c = txs[j] as Transaction;
    if (c.kind !== 'stamp_duty' || c.reversedBy !== undefined || c.amount === undefined || rev.amount === undefined) continue;
    if (Math.abs(c.amount + rev.amount) <= 0.005 && c.amount > 0) return j;
  }
  return -1;
}

/**
 * V-3 and V-5: amount, units and NAV must agree within rounding for purchase-like rows, and a redemption-like
 * row's shortfall against units x NAV must be a plausible exit load (<= 3%). Sign conventions as printed.
 */
function arithmeticHolds(tx: Transaction, decimals: number): boolean {
  const { amount, units, nav, kind } = tx;
  if (kind === 'reversal' || amount === undefined || units === undefined || nav === undefined) return true;
  if (!PURCHASE_LIKE.has(kind) && !REDEMPTION_LIKE.has(kind)) return true;
  const expected = Math.abs(units) * nav;
  if (PURCHASE_LIKE.has(kind)) {
    if (amount < 0 || units < 0) return false;
    return Math.abs(amount - expected) <= nav * 0.5 * 10 ** -decimals + 0.011;
  }
  if (amount > 0 || units > 0) return false;
  const shortfall = expected - Math.abs(amount);
  return shortfall >= -0.011 && shortfall <= 0.03 * expected + 0.011;
}

export const isPurchaseLike = (k: TransactionKind): boolean => PURCHASE_LIKE.has(k);
export const isRedemptionLike = (k: TransactionKind): boolean => REDEMPTION_LIKE.has(k);
