// src/engine.ts
// Public surface of the engine for the main thread (hooks and pages import from here). Nothing in this file
// runs at import time; pdfjs and the datasets load lazily behind createClient(), loadBenchmark() and loadCategories().

export type { WorkerEvent, WorkerRequest } from './parser/protocol';
export { PROTOCOL_VERSION } from './parser/protocol';
export type * from './parser/types';
export { LIMITS, uiErrorKey } from './parser/types';
export { createClient, newRequestId } from './workers/client';
export type { CasParserClient, OpenOptions, ClientListener } from './workers/client';
export { preflight, looksLikePdf } from './workers/preflight';

export type * from './calculations/types';
export { buildCashflows, seriesWithTerminal, hasOpeningBalance } from './calculations/cashflows';
export { xirr, npv, BRACKET_GRID } from './calculations/xirr';
export type { XirrOptions } from './calculations/xirr';
export { fundSeries, fundXirr, fundTotals, portfolioSummary } from './calculations/portfolio';
export type { FundXirrResult, PortfolioSummary } from './calculations/portfolio';
export { disciplineScore, missedSipCost, missedCostBySip, sipKey } from './calculations/discipline';
export type { DetectedSip, DisciplineResult, DisciplineOptions, MissedCostResult, SipFrequency } from './calculations/discipline';
export { indexComparison } from './calculations/indexCompare';
export type { BenchmarkSeries, IndexComparisonOptions, IndexComparisonResult, ShadowLeg } from './calculations/indexCompare';
export { buildFifoLots } from './calculations/fifo';
export type { Lot, FifoResult } from './calculations/fifo';
export { taxEstimate, fundLotTaxes } from './calculations/tax';
export type { TaxClass, CategoryInfo, LotTax, FundTax, TaxEstimateResult } from './calculations/tax';
export { TAX_RULES, rulesForDate, TAX_DISCLAIMER_LONG, TAX_DISCLAIMER_SHORT } from './calculations/taxRules';
export type { TaxRuleSet } from './calculations/taxRules';
export { allocation } from './calculations/allocation';
export type { AllocationResult } from './calculations/allocation';
export * from './calculations/dates';
export * from './calculations/money';

export { loadBenchmark, makeBenchmarkSeries } from './data/benchmark';
export { loadCategories, makeCategoryLookup } from './data/categories';
export type { CategoryLookup } from './data/categories';
export type { BenchmarkNavFile, IsinCategoryFile } from './data/types';
