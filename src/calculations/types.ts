// src/calculations/types.ts
// Calculation result types (design §4.2). Investor perspective throughout: negative = money left the investor.
import type { ISODate } from '../parser/types';

/** Investor-perspective cashflow: negative = money left the investor, positive = money came back. */
export interface Cashflow {
  date: ISODate;
  amount: number;                 // rupees, 2 dp, investor sign
  fundId: string;
  /** Which transactions produced it (parent + attached levies). */
  transactionIds: string[];
  kind: 'outflow' | 'inflow' | 'terminal';
  /** Human label for the drawer: 'SIP', 'Purchase + stamp duty', 'Redemption − STT', 'Switch out',
   *  'IDCW payout', 'Value as of statement date'. */
  label: string;
  /** For inflows that reduce units (redemption / switch_out): units sold / units held just before. 0..1.
   *  Used by indexComparison (A6). */
  fractionOfHolding?: number;
}

export interface IgnoredRow {
  transactionId: string;
  reason: 'reversed' | 'reversal' | 'dividend_reinvest' | 'segregated' | 'unit_adjustment' | 'unknown'
        | 'future_dated' | 'no_amount';
}

export interface CashflowSeries {
  cashflows: Cashflow[];          // sorted by date asc, then outflows before inflows on the same day
  ignored: IgnoredRow[];
  terminal?: Cashflow;            // present unless units are 0 or closing NAV unknown
  asOf: ISODate;
  /** Sum of outflows (positive number) and inflows, for the tiles. */
  totals: { invested: number; redeemed: number; terminalValue: number };
}

export type XirrResult =
  | { status: 'ok'; rate: number; iterations: number; method: 'newton' | 'bisection';
      warning?: 'multiple-roots' }
  | { status: 'insufficient'; reason: 'fewer-than-two' | 'same-day' | 'same-sign' }
  | { status: 'no-convergence'; reason: 'no-bracket' | 'iterations' };
