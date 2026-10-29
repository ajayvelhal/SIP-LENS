// tests/parser/goldenTypes.ts
// Golden and fixture metadata types (02-database-design.md §7.3).
import type { ISODate, ParseError, ParseResult, Portfolio } from '../../src/parser/types';
import type { XirrResult } from '../../src/calculations/types';

export type GoldenResult = Omit<ParseResult, 'portfolio'> & { portfolio: Omit<Portfolio, 'parsedAt'> };

/** Digest form used by the two large fixtures: folio.transactions replaced by count + sha256 (02-database-design.md §4.6). */
export type DigestedResult = Omit<GoldenResult, 'portfolio'> & {
  portfolio: Omit<GoldenResult['portfolio'], 'funds'> & {
    funds: (Omit<GoldenResult['portfolio']['funds'][number], 'folios'> & {
      folios: (Omit<GoldenResult['portfolio']['funds'][number]['folios'][number], 'transactions'> & { transactions: { count: number; sha256: string } })[];
    })[];
  };
  digest: { algorithm: 'sha256'; canonical: string };
};

export type PinnedXirr =
  | { status: 'ok'; ratePct4dp: number; method?: 'newton' | 'bisection'; warning?: 'multiple-roots' }
  | Exclude<XirrResult, { status: 'ok' }>
  | { status: 'insufficient'; reason: 'opening-balance-without-history' };

export interface FixtureInvariants {
  portfolio: {
    asOf: ISODate;
    totalInvested: number; totalRedeemed: number; valueAsOfStatementDate: number; fundsWithoutPrintedValue: number; terminalValue: number;
    skippedFunds: { fundId: string; reason: 'may-be-incomplete' | 'opening-balance-without-history' }[];
    xirr: PinnedXirr;
  };
  funds: Record<string, {
    schemeName: string; closingUnits: number; closingNav?: number; closingValue?: number; mayBeIncomplete: boolean; openingWithoutHistory: boolean;
    invested: number; redeemed: number; netInvested: number; terminalValue: number; cashflowCount: number; ignoredCount: number;
    cashflows?: { date: ISODate; amount: number; label: string }[];
    ignored?: { transactionId: string; reason: string }[];
    xirr: PinnedXirr;
  }>;
  discipline: {
    score: number | null;
    sips: { fundId: string; folioNumber: string; frequency: 'weekly' | 'monthly' | 'quarterly'; amounts: { from: ISODate; amount: number }[];
            firstDate: ISODate; lastObserved?: ISODate; counts: { expected: number; made: number; missed: number; stopped: number };
            percent: number; stoppedSince?: ISODate }[];
  };
  taxLots?: Record<string, { taxClass: 'equity' | 'debt' | 'hybrid-other' | 'unknown'; isElss: boolean;
    lots: { acquiredOn: ISODate; units: number; costPerUnit: number; source: string; term: 'long' | 'short' | 'locked'; unlockOn?: ISODate; gain: number }[] }>;
}

export type GoldenFile = {
  goldenVersion: 1;
  fixture: string;
  generator: { script: 'scripts/gen-fixtures.mjs'; version: string };
  stories: string[]; edges: string[]; notes: string;
} & (
  | { expect: 'result'; digest?: false; result: GoldenResult; invariants: FixtureInvariants }
  | { expect: 'result'; digest: true; result: DigestedResult; invariants: FixtureInvariants }
  | { expect: 'error'; error: ParseError }
);

export interface FixtureManifest {
  generator: { script: 'scripts/gen-fixtures.mjs'; version: string };
  files: Record<string, { bytes: number; sha256: string }>;
}
