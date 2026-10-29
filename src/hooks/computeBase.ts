// The synchronous, dataset-free part of the Analysis (design §3.5), kept free of React so it is testable and so that
// every calculation runs inside a boundary (§7.4): a throw degrades that figure instead of crashing the dashboard.
// A degraded figure is never a plausible-looking number: XIRR becomes 'no-convergence' ("Couldn't compute; see cash flows"),
// totals become empty and `computeFailed` is set so the UI can say so.

import type { DetectedSip, Fund, FundXirrResult, ISODate, ParseResult, PortfolioSummary, Transaction } from '../engine';
import { disciplineScore, fundSeries, fundTotals, fundXirr, missedCostBySip, portfolioSummary } from '../engine';
import type { Boundary, DisciplineView, FundView } from './usePortfolio';

export interface AnalysisBase {
  asOf: ISODate;
  summary: PortfolioSummary;
  discipline: Boundary<DisciplineView>;
  funds: FundView[];
  fundById: Map<string, Fund>;
  txById: Map<string, Transaction>;
  isEmpty: boolean;
  /** True when the portfolio summary or any fund's figures threw and were replaced by the empty fallback. */
  computeFailed: boolean;
}

function guard<T>(fn: () => T): Boundary<T> {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

const FAILED_XIRR: FundXirrResult = { status: 'no-convergence', reason: 'iterations' };

function emptySummary(asOf: ISODate): PortfolioSummary {
  return {
    series: { cashflows: [], ignored: [], asOf, totals: { invested: 0, redeemed: 0, terminalValue: 0 }, skippedFundIds: [] },
    xirr: FAILED_XIRR as PortfolioSummary['xirr'],
    totalInvested: 0, totalRedeemed: 0, valueAsOfStatementDate: 0, fundsWithoutPrintedValue: 0, skippedFunds: [],
  };
}

export function computeBase(result: ParseResult): AnalysisBase {
  const portfolio = result.portfolio;
  const asOf = portfolio.statementDate;
  let computeFailed = false;

  const summaryB = guard(() => portfolioSummary(portfolio, asOf));
  if (!summaryB.ok) computeFailed = true;
  const summary = summaryB.ok ? summaryB.value : emptySummary(asOf);

  const discipline = guard<DisciplineView>(() => {
    const d = disciplineScore(portfolio, asOf);
    return { ...d, missedCost: missedCostBySip(portfolio, d.sips, asOf) };
  });
  const sipsByFund = new Map<string, DetectedSip[]>();
  if (discipline.ok) for (const sip of discipline.value.sips) sipsByFund.set(sip.fundId, [...(sipsByFund.get(sip.fundId) ?? []), sip]);

  const fundById = new Map<string, Fund>();
  const txById = new Map<string, Transaction>();
  for (const f of portfolio.funds) {
    fundById.set(f.id, f);
    for (const fo of f.folios ?? []) for (const t of fo.transactions) txById.set(t.id, t);
  }

  const funds: FundView[] = portfolio.funds.map((fund) => {
    const x = guard(() => fundXirr(fund, asOf));
    const t = guard(() => fundTotals(fund, asOf));
    if (!x.ok || !t.ok) computeFailed = true;
    return {
      fund,
      xirr: x.ok ? x.value : FAILED_XIRR,
      totals: t.ok ? t.value : { invested: 0, redeemed: 0, netInvested: 0, terminalValue: 0 },
      sips: sipsByFund.get(fund.id) ?? [],
    };
  });

  const empty = guard(() => portfolio.funds.every((f) => fundSeries(f, asOf).cashflows.length === 0));
  if (!empty.ok) computeFailed = true;
  // When the numbers could not be computed the tiles show their "no transactions to compute from" dashes rather than zeros.
  const isEmpty = empty.ok ? empty.value : true;

  return { asOf, summary, discipline, funds, fundById, txById, isEmpty: isEmpty || !summaryB.ok, computeFailed };
}
