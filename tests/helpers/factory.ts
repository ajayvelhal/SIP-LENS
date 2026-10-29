// tests/helpers/factory.ts
// Builders for small synthetic portfolios used by the calculation edge-case tests. Nothing here is real data.
import type { Folio, Fund, ISODate, Portfolio, Transaction, TransactionKind } from '../../src/parser/types';
import { isoDate } from '../../src/calculations/dates';

export const d = (s: string): ISODate => isoDate(s);

export interface TxSpec {
  date: string;
  kind: TransactionKind;
  amount?: number;
  units?: number;
  nav?: number;
  description?: string;
  excluded?: boolean;
  stampDuty?: number;
  stt?: number;
}

export function makeFolio(folioNumber: string, specs: TxSpec[], opts: { fundId?: string; openingUnits?: number; closingUnits?: number; closingNav?: number; schemeName?: string } = {}): Folio {
  const fundId = opts.fundId ?? 'FUND';
  const txs: Transaction[] = [];
  let balance = opts.openingUnits ?? 0;
  for (const s of specs) {
    const i = txs.length;
    const id = `${fundId}:${folioNumber}:${i}`;
    if (s.units !== undefined && !s.excluded) balance += s.units;
    const tx: Transaction = {
      id, rta: 'CAMS', folioNumber, schemeName: opts.schemeName ?? 'Test Fund - Direct Plan - Growth', isin: fundId.startsWith('INF') ? fundId : undefined,
      date: d(s.date), description: s.description ?? s.kind, kind: s.kind, page: 1,
      excludedFromCashflows: s.excluded ?? ['segregated', 'unit_adjustment', 'unknown'].includes(s.kind),
    };
    if (s.amount !== undefined) tx.amount = s.amount;
    if (s.units !== undefined) tx.units = s.units;
    if (s.nav !== undefined) tx.nav = s.nav;
    if (s.units !== undefined) tx.unitBalance = Math.round(balance * 1000) / 1000;
    txs.push(tx);
    if (s.stampDuty) {
      const lid = `${fundId}:${folioNumber}:${txs.length}`;
      txs.push({ id: lid, rta: 'CAMS', folioNumber, schemeName: tx.schemeName, isin: tx.isin, date: tx.date, description: '*** Stamp Duty ***', kind: 'stamp_duty', amount: s.stampDuty, page: 1, attachedTo: id, excludedFromCashflows: false });
      (tx.levies ??= []).push(lid);
    }
    if (s.stt) {
      const lid = `${fundId}:${folioNumber}:${txs.length}`;
      txs.push({ id: lid, rta: 'CAMS', folioNumber, schemeName: tx.schemeName, isin: tx.isin, date: tx.date, description: '*** STT Paid ***', kind: 'stt_tds', amount: s.stt, page: 1, attachedTo: id, excludedFromCashflows: false });
      (tx.levies ??= []).push(lid);
    }
  }
  const closingUnits = opts.closingUnits ?? Math.round(balance * 1000) / 1000;
  return {
    folioNumber, rta: 'CAMS', openingUnits: opts.openingUnits ?? 0, closingUnits, closingNav: opts.closingNav,
    closingValue: opts.closingNav !== undefined ? Math.round(closingUnits * opts.closingNav * 100) / 100 : undefined,
    transactions: txs,
    reconciliation: { status: 'ok', computedClosingUnits: closingUnits, printedClosingUnits: closingUnits, diff: 0, toleranceUnits: 0.002, decimals: 3 },
  };
}

export function makeFund(id: string, folios: Folio[], opts: { mayBeIncomplete?: boolean; schemeName?: string } = {}): Fund {
  const closingUnits = Math.round(folios.reduce((a, f) => a + (f.closingUnits ?? 0), 0) * 1000) / 1000;
  const values = folios.filter((f) => f.closingValue !== undefined).map((f) => f.closingValue as number);
  const nav = folios.map((f) => f.closingNav).filter((n): n is number => n !== undefined).pop();
  const fund: Fund = { id, schemeName: opts.schemeName ?? 'Test Fund - Direct Plan - Growth', folios, closingUnits, mayBeIncomplete: opts.mayBeIncomplete ?? false };
  if (id.startsWith('INF')) fund.isin = id;
  if (nav !== undefined) fund.closingNav = nav;
  if (values.length) fund.closingValue = Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
  return fund;
}

export function makePortfolio(funds: Fund[], statementDate: string, from = '2015-01-01'): Portfolio {
  return {
    schemaVersion: 1, issuer: 'CAMS', statementDate: d(statementDate), statementPeriod: { from: d(from), to: d(statementDate) },
    parsedAt: '2026-01-01T00:00:00.000Z', investorCount: 1, funds, pageCount: 1, unitDecimals: 3,
  };
}

/** Monthly instalments on a fixed day (no business-day rolling), amounts optionally stepping up. */
export function monthlySips(from: string, count: number, amount: number, nav = 100, opts: { skip?: string[]; day?: number; step?: number; stepFrom?: string; stepAmount?: number } = {}): TxSpec[] {
  const out: TxSpec[] = [];
  const [y0, m0] = from.split('-').map(Number) as [number, number];
  for (let i = 0; i < count; i++) {
    const total = y0 * 12 + (m0 - 1) + i * (opts.step ?? 1);
    const y = Math.floor(total / 12), m = total - y * 12 + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const date = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(opts.day ?? 10, last)).padStart(2, '0')}`;
    if (opts.skip?.some((s) => date.startsWith(s))) continue;
    const amt = opts.stepFrom && date >= opts.stepFrom ? (opts.stepAmount as number) : amount;
    out.push({ date, kind: 'sip', amount: amt, units: Math.round((amt / nav) * 1000) / 1000, nav, description: `Systematic Investment (${i + 1})` });
  }
  return out;
}
