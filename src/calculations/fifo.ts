// src/calculations/fifo.ts
// Lot builder shared by tax.ts and the cashflow drawer (design §4.8). Units matched FIFO in date order;
// same-day by transaction order. Reversal pairs excluded. Pure.

import type { Fund, ISODate, Transaction } from '../parser/types';
import { movesUnitsWithoutCash } from './cashflows';
import { round4, roundTo } from './money';

export interface Lot {
  fundId: string;
  folioNumber: string;
  acquiredOn: ISODate;
  units: number;                    // remaining units, printed precision
  nav: number;                      // acquisition NAV per unit (incl. stamp duty? NO: cost basis excludes levies, see below)
  costPerUnit: number;              // nav + attached stamp duty / units (cost basis for gain)
  source: 'purchase' | 'sip' | 'switch_in' | 'dividend_reinvest' | 'opening_balance' | 'unit_adjustment';
  sourceTransactionId?: string;
}

export interface FifoResult {
  openLots: Lot[];
  /** Units consumed by redemptions/switch-outs, with the lots they came from (for "realised: not included in v1"). */
  realisedEvents: { transactionId: string; date: ISODate; units: number; fromLots: { acquiredOn: ISODate; units: number }[] }[];
  /** Opening balance with no history: a synthetic lot dated statementPeriod.from with nav = first transaction NAV,
   *  flagged so tax can mark it "holding period unknown". */
  syntheticOpeningLot?: Lot;
}

const ACQUIRING = new Set<Transaction['kind']>(['purchase', 'sip', 'switch_in', 'dividend_reinvest']);
const CONSUMING = new Set<Transaction['kind']>(['redemption', 'switch_out']);

/**
 * Pure. Reversal pairs excluded. Units matched FIFO in date order; same-day: by transaction order.
 * @param periodFrom statement period start, used to date the synthetic opening lot (defaults to the earliest row).
 */
export function buildFifoLots(fund: Fund, asOf: ISODate, periodFrom?: ISODate): FifoResult {
  const byId = new Map<string, Transaction>();
  for (const fo of fund.folios) for (const tx of fo.transactions) byId.set(tx.id, tx);

  const ordered: Array<{ tx: Transaction; folioNumber: string; order: number }> = [];
  let order = 0;
  for (const fo of fund.folios) for (const tx of fo.transactions) ordered.push({ tx, folioNumber: fo.folioNumber, order: order++ });
  ordered.sort((a, b) => (a.tx.date < b.tx.date ? -1 : a.tx.date > b.tx.date ? 1 : 0) || a.order - b.order);

  const lots: Lot[] = [];
  const realisedEvents: FifoResult['realisedEvents'] = [];
  let syntheticOpeningLot: Lot | undefined;

  // Opening balances (E43): one synthetic lot per folio with units but no history, oldest of all.
  for (const fo of fund.folios) {
    if (fo.openingUnits <= 0) continue;
    const firstNav = fo.transactions.find((t) => t.nav !== undefined && t.nav > 0)?.nav ?? fund.closingNav ?? 0;
    const acquiredOn = periodFrom ?? fo.transactions[0]?.date ?? asOf;
    const lot: Lot = { fundId: fund.id, folioNumber: fo.folioNumber, acquiredOn, units: fo.openingUnits, nav: firstNav, costPerUnit: firstNav, source: 'opening_balance' };
    lots.push(lot);
    syntheticOpeningLot ??= lot;
  }

  for (const { tx, folioNumber } of ordered) {
    // unit_adjustment rows are excluded from cashflows by the parser but still change the lots (bonus, merger, transfer).
    if ((tx.excludedFromCashflows && !movesUnitsWithoutCash(tx)) || tx.date > asOf || tx.units === undefined) continue;
    if (ACQUIRING.has(tx.kind) && tx.units > 0) {
      const stamp = (tx.levies ?? [])
        .map((id) => byId.get(id))
        .filter((l): l is Transaction => !!l && l.kind === 'stamp_duty' && !l.excludedFromCashflows)
        .reduce((a, l) => a + Math.abs(l.amount ?? 0), 0);
      const nav = tx.nav ?? (tx.amount !== undefined ? Math.abs(tx.amount) / tx.units : 0);
      const cost = tx.amount !== undefined ? roundTo((Math.abs(tx.amount) + stamp) / tx.units, 6) : nav;
      lots.push({ fundId: fund.id, folioNumber, acquiredOn: tx.date, units: tx.units, nav, costPerUnit: cost, source: tx.kind as Lot['source'], sourceTransactionId: tx.id });
    } else if (tx.kind === 'unit_adjustment' && tx.units > 0) {
      // E24: bonus / merger units at the printed NAV, else a zero-cost lot (tax marks it unknown-holding).
      const nav = tx.nav ?? 0;
      lots.push({ fundId: fund.id, folioNumber, acquiredOn: tx.date, units: tx.units, nav, costPerUnit: tx.amount !== undefined ? roundTo(Math.abs(tx.amount) / tx.units, 6) : nav, source: 'unit_adjustment', sourceTransactionId: tx.id });
    } else if ((CONSUMING.has(tx.kind) || (tx.kind === 'unit_adjustment' && tx.units < 0)) && tx.units < 0) {
      let left = -tx.units;
      const fromLots: { acquiredOn: ISODate; units: number }[] = [];
      // Units are held per folio, so a row consumes the oldest lots of its own folio (the design only says "FIFO").
      while (left > 1e-9) {
        const idx = lots.findIndex((l) => l.folioNumber === folioNumber);
        if (idx === -1) break;
        const lot = lots[idx] as Lot;
        const take = Math.min(lot.units, left);
        fromLots.push({ acquiredOn: lot.acquiredOn, units: take });
        lot.units = round4(lot.units - take);
        left = round4(left - take);
        if (lot.units <= 0) lots.splice(idx, 1);
      }
      if (CONSUMING.has(tx.kind)) realisedEvents.push({ transactionId: tx.id, date: tx.date, units: -tx.units, fromLots });
    }
  }
  const result: FifoResult = { openLots: lots, realisedEvents };
  if (syntheticOpeningLot && lots.includes(syntheticOpeningLot)) result.syntheticOpeningLot = syntheticOpeningLot;
  return result;
}
