// Runtime stub gate (design §8.3 item 2): with every network and storage API replaced by a throwing stub, parse every
// fixture through the real pipeline and run every calculation. Any call fails the suite.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureNames, parseFixture } from '../helpers/pdfjsNode';
import { loadGolden } from '../helpers/golden';
import { portfolioSummary, fundXirr } from '../../src/calculations/portfolio';
import { disciplineScore } from '../../src/calculations/discipline';
import { taxEstimate } from '../../src/calculations/tax';
import { allocation } from '../../src/calculations/allocation';
import { indexComparison } from '../../src/calculations/indexCompare';
import { loadBenchmark } from '../../src/data/benchmark';
import { loadCategories } from '../../src/data/categories';
import type { Portfolio } from '../../src/parser/types';

const calls: string[] = [];
const g = globalThis as Record<string, unknown>;
const saved: Record<string, PropertyDescriptor | undefined> = {};
let savedBeacon: PropertyDescriptor | undefined;
const STUBS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'indexedDB'];

function throwing(name: string) {
  return function stub() { calls.push(name); throw new Error(`forbidden API called: ${name}`); };
}

beforeAll(() => {
  for (const name of STUBS) {
    saved[name] = Object.getOwnPropertyDescriptor(g, name);
    Object.defineProperty(g, name, { configurable: true, writable: true, value: throwing(name) });
  }
  // Node 22 exposes a getter-only `navigator`; stub sendBeacon on the existing object instead of replacing it.
  const nav = (g.navigator ?? {}) as Record<string, unknown>;
  savedBeacon = Object.getOwnPropertyDescriptor(nav, 'sendBeacon');
  Object.defineProperty(nav, 'sendBeacon', { configurable: true, writable: true, value: throwing('navigator.sendBeacon') });
  if (!g.navigator) Object.defineProperty(g, 'navigator', { configurable: true, value: nav });
  saved.document = Object.getOwnPropertyDescriptor(g, 'document');
  Object.defineProperty(g, 'document', { configurable: true, get() { return { get cookie() { calls.push('document.cookie'); throw new Error('forbidden: document.cookie'); }, set cookie(_v: string) { calls.push('document.cookie'); throw new Error('forbidden: document.cookie'); } }; } });
});
afterAll(() => {
  for (const [name, desc] of Object.entries(saved)) {
    if (desc) Object.defineProperty(g, name, desc); else delete g[name];
  }
  const nav = g.navigator as Record<string, unknown> | undefined;
  if (nav) { if (savedBeacon) Object.defineProperty(nav, 'sendBeacon', savedBeacon); else delete nav.sendBeacon; }
});

describe('runtime stub gate', () => {
  it('parses every fixture and runs every calculation without touching a forbidden API', async () => {
    const { series: benchmark } = (await loadBenchmark())!;
    const { categoryOf } = await loadCategories();
    let parsed = 0;
    for (const name of fixtureNames()) {
      const golden = loadGolden(name);
      if (golden.expect === 'error' && golden.error.code === 'NOT_PDF') continue;
      const trace = await parseFixture(name);
      expect(trace.outcome.ok).toBe(golden.expect === 'result');
      if (!trace.outcome.ok) continue;
      parsed++;
      const portfolio = trace.outcome.result.portfolio as Portfolio;
      const asOf = portfolio.statementDate;
      portfolioSummary(portfolio, asOf);
      for (const f of portfolio.funds) fundXirr(f, asOf);
      disciplineScore(portfolio, asOf);
      taxEstimate(portfolio, asOf, categoryOf);
      allocation(portfolio, categoryOf);
      indexComparison(portfolioSummary(portfolio, asOf).series, benchmark, asOf);
    }
    expect(parsed).toBe(22);
    expect(calls).toEqual([]);
  });
  it('the stubs do throw when called (negative test)', () => {
    expect(() => (g.fetch as () => void)()).toThrow(/forbidden/);
    expect(() => (g.localStorage as () => void)()).toThrow(/forbidden/);
    expect(() => ((g.navigator as { sendBeacon: () => void }).sendBeacon)()).toThrow(/forbidden/);
    expect(calls).toEqual(['fetch', 'localStorage', 'navigator.sendBeacon']);
    calls.length = 0;
  });
});
