// src/calculations/cashflows.ts
// Shared builder: Transaction[] -> investor-perspective Cashflow[] (design §4.3, mapping table; data design D5).
// Pure and deterministic. Does not round inputs; rounds each emitted amount to 2 dp (round-half-away-from-zero).

import type { Fund, ISODate, Transaction } from '../parser/types';
import type { Cashflow, CashflowSeries, IgnoredRow } from './types';
import { round2, sumExact } from './money';

export interface BuildCashflowsOptions {
  /** default false: funds with mayBeIncomplete are skipped and listed in `skippedFundIds` (A23). */
  includeIncomplete?: boolean;
  /** default false: funds holding units with no history (any folio openingUnits > 0, E43 / D5) are skipped too. */
  includeOpeningBalance?: boolean;
}

/**
 * Rows that move units without moving cash (bonus, merger, transfer): the parser marks every `unit_adjustment`
 * `excludedFromCashflows`, yet they still add or remove units. A reversed or reversing row is genuinely void.
 */
export const movesUnitsWithoutCash = (tx: Transaction): boolean =>
  tx.kind === 'unit_adjustment' && tx.reversedBy === undefined && tx.reverses === undefined;

/**
 * Value of the units a fund still holds on the statement date (design 4.3 terminal row): the printed units x printed NAV,
 * else the printed valuation (`closingValue`). `undefined` means units are held but nothing prices them;
 * 0 means nothing is held (fully redeemed), which needs no terminal flow.
 */
export function terminalValueOf(fund: Fund): number | undefined {
  if (fund.closingUnits <= 0) return 0;
  if (fund.closingNav !== undefined) return round2(fund.closingUnits * fund.closingNav);
  return fund.closingValue;
}

/** Units are held but neither a closing NAV nor a printed value prices them: no honest terminal flow exists. */
export const isUnvaluable = (fund: Fund): boolean => terminalValueOf(fund) === undefined;

export const hasOpeningBalance = (fund: Fund): boolean => fund.folios.some((fo) => fo.openingUnits > 0);

/**
 * Builds the investor-perspective cashflow series for one fund or a pooled portfolio.
 *
 * @param funds   one Fund for a fund series, all non-incomplete Funds for the portfolio series
 * @param asOf    statement date; the terminal cashflow is dated here
 * @param opts.includeIncomplete  default false: funds with mayBeIncomplete are skipped and listed in `skipped`
 */
export function buildCashflows(
  funds: Fund[],
  asOf: ISODate,
  opts: BuildCashflowsOptions = {},
): CashflowSeries & { skippedFundIds: string[] } {
  const cashflows: Cashflow[] = [];
  const ignored: IgnoredRow[] = [];
  const skippedFundIds: string[] = [];
  const terminalParts: number[] = [];
  const terminalIds: string[] = [];

  for (const fund of funds) {
    if (!opts.includeIncomplete && fund.mayBeIncomplete) { skippedFundIds.push(fund.id); continue; }
    if (!opts.includeOpeningBalance && hasOpeningBalance(fund)) { skippedFundIds.push(fund.id); continue; }
    // Held units with no price: outflows without a terminal flow would read as ~-100%. Skipped and listed, like the
    // other unusable funds (design 4.3 terminal row: the fund's XIRR is `insufficient`). fundSeries() still shows its flows.
    if (!opts.includeIncomplete && isUnvaluable(fund)) { skippedFundIds.push(fund.id); continue; }
    const byId = new Map<string, Transaction>();
    for (const fo of fund.folios) for (const tx of fo.transactions) byId.set(tx.id, tx);

    for (const fo of fund.folios) {
      let running = fo.openingUnits;
      for (const tx of fo.transactions) {
        const unitsBefore = running;
        if (tx.units !== undefined && (!tx.excludedFromCashflows || movesUnitsWithoutCash(tx))) running = tx.unitBalance ?? running + tx.units;
        else if (tx.unitBalance !== undefined) running = tx.unitBalance;

        if (tx.date > asOf) { ignored.push({ transactionId: tx.id, reason: 'future_dated' }); continue; }
        if (tx.excludedFromCashflows) {
          ignored.push({ transactionId: tx.id, reason: tx.reverses !== undefined ? 'reversal' : tx.reversedBy !== undefined ? 'reversed' : excludedReason(tx) });
          continue;
        }
        const levies = (tx.levies ?? []).map((id) => byId.get(id)).filter((l): l is Transaction => !!l && !l.excludedFromCashflows);
        const stamp = sumExact(levies.filter((l) => l.kind === 'stamp_duty').map((l) => Math.abs(l.amount ?? 0)));
        const stt = sumExact(levies.filter((l) => l.kind === 'stt_tds').map((l) => Math.abs(l.amount ?? 0)));
        const levyIds = levies.map((l) => l.id);
        switch (tx.kind) {
          case 'purchase':
          case 'sip':
          case 'switch_in': {
            if (tx.amount === undefined) { ignored.push({ transactionId: tx.id, reason: 'no_amount' }); break; }
            const base = tx.kind === 'switch_in' ? 'Switch in' : tx.kind === 'sip' ? 'SIP' : 'Purchase';
            cashflows.push({
              date: tx.date, amount: -round2(Math.abs(tx.amount) + stamp), fundId: fund.id,
              transactionIds: [tx.id, ...levyIds], kind: 'outflow', label: stamp > 0 ? `${base} + stamp duty` : base,
            });
            break;
          }
          case 'redemption':
          case 'switch_out': {
            if (tx.amount === undefined) { ignored.push({ transactionId: tx.id, reason: 'no_amount' }); break; }
            const base = tx.kind === 'switch_out' ? 'Switch out' : 'Redemption';
            const cf: Cashflow = {
              date: tx.date, amount: round2(Math.abs(tx.amount) - stt), fundId: fund.id,
              transactionIds: [tx.id, ...levyIds], kind: 'inflow', label: stt > 0 ? `${base} − STT` : base,
            };
            if (tx.units !== undefined && unitsBefore > 0) cf.fractionOfHolding = Math.min(1, Math.abs(tx.units) / unitsBefore);
            cashflows.push(cf);
            break;
          }
          case 'dividend_payout':
            if (tx.amount === undefined) { ignored.push({ transactionId: tx.id, reason: 'no_amount' }); break; }
            cashflows.push({ date: tx.date, amount: round2(Math.abs(tx.amount)), fundId: fund.id, transactionIds: [tx.id], kind: 'inflow', label: 'IDCW payout' });
            break;
          case 'dividend_reinvest':
            ignored.push({ transactionId: tx.id, reason: 'dividend_reinvest' });
            break;
          case 'stamp_duty':
          case 'stt_tds':
            if (tx.attachedTo === undefined && tx.amount !== undefined) {
              cashflows.push({
                date: tx.date, amount: -round2(Math.abs(tx.amount)), fundId: fund.id, transactionIds: [tx.id], kind: 'outflow',
                label: tx.kind === 'stamp_duty' ? 'Stamp duty (no parent row)' : 'STT (no parent row)',
              });
            }
            break;
          default:
            ignored.push({ transactionId: tx.id, reason: excludedReason(tx) });
        }
      }
    }
    const terminal = terminalValueOf(fund);
    if (terminal !== undefined && terminal > 0) {
      terminalParts.push(terminal);
      terminalIds.push(fund.id);
    }
  }

  // Same-day ordering: outflows before inflows, then by transaction order (stable sort).
  const indexed = cashflows.map((cf, i) => ({ cf, i }));
  indexed.sort((a, b) => (a.cf.date < b.cf.date ? -1 : a.cf.date > b.cf.date ? 1 : 0) || rank(a.cf) - rank(b.cf) || a.i - b.i);
  const sorted = indexed.map((x) => x.cf);

  const invested = round2(sumExact(sorted.filter((c) => c.amount < 0).map((c) => -c.amount)));
  const redeemed = round2(sumExact(sorted.filter((c) => c.amount > 0).map((c) => c.amount)));
  const series: CashflowSeries & { skippedFundIds: string[] } = {
    cashflows: sorted,
    ignored,
    asOf,
    totals: { invested, redeemed, terminalValue: 0 },
    skippedFundIds,
  };
  if (terminalParts.length > 0) {
    const terminalValue = round2(sumExact(terminalParts));
    series.terminal = {
      date: asOf, amount: terminalValue, fundId: terminalIds.length === 1 ? (terminalIds[0] as string) : 'portfolio',
      transactionIds: [], kind: 'terminal', label: 'Value as of statement date',
    };
    series.totals.terminalValue = terminalValue;
  }
  return series;
}

function rank(cf: Cashflow): number {
  return cf.kind === 'outflow' ? 0 : 1;
}

function excludedReason(tx: Transaction): IgnoredRow['reason'] {
  switch (tx.kind) {
    case 'segregated': return 'segregated';
    case 'unit_adjustment': return 'unit_adjustment';
    case 'reversal': return 'reversal';
    default: return 'unknown';
  }
}

/** The series plus its terminal flow, as `xirr()` expects it. */
export function seriesWithTerminal(series: CashflowSeries): Array<Pick<Cashflow, 'date' | 'amount'>> {
  const flows: Array<Pick<Cashflow, 'date' | 'amount'>> = series.cashflows.map((c) => ({ date: c.date, amount: c.amount }));
  if (series.terminal) flows.push({ date: series.terminal.date, amount: series.terminal.amount });
  return flows;
}
