// Allocation by category (design §4.9, US-18, E61).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allocation } from '../../src/calculations/allocation';
import { makeCategoryLookup } from '../../src/data/categories';
import type { IsinCategoryFile } from '../../src/data/types';
import type { Portfolio } from '../../src/parser/types';
import { FIXTURES_DIR } from '../helpers/pdfjsNode';
import { loadGolden } from '../helpers/golden';

const categoryOf = makeCategoryLookup(JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'isinCategory.fixture.json'), 'utf8')) as IsinCategoryFile);

describe('allocation', () => {
  it('sample CAS: buckets sum to the printed total, ordered Equity, Hybrid, Debt, Other, Unclassified', () => {
    const golden = loadGolden('sample-cas');
    if (golden.expect !== 'result') throw new Error('unexpected');
    const portfolio = { ...golden.result.portfolio, parsedAt: 'test' } as unknown as Portfolio;
    const res = allocation(portfolio, categoryOf);
    expect(res.buckets.map((b) => b.category)).toEqual(['Equity', 'Hybrid', 'Debt', 'Other', 'Unclassified']);
    expect(res.total).toBeCloseTo(golden.invariants.portfolio.valueAsOfStatementDate, 2);
    expect(res.buckets.reduce((a, b) => a + b.value, 0)).toBeCloseTo(res.total, 2);
    expect(Math.abs(res.buckets.reduce((a, b) => a + b.percent, 0) - 100)).toBeLessThanOrEqual(0.2);
    expect(res.unclassifiedCount).toBe(0);
    expect(res.buckets.find((b) => b.category === 'Debt')!.fundIds).toEqual(['INF000S01LQ6']);
    expect(res.buckets.find((b) => b.category === 'Hybrid')!.fundIds).toEqual(['INF000S01BA1']);
    expect(res.asOf).toBe('2026-09-30');
  });
  it('unknown ISIN and missing ISIN fall into Unclassified (E28, E61)', () => {
    const golden = loadGolden('cams-2025-unknown-isin');
    if (golden.expect !== 'result') throw new Error('unexpected');
    const portfolio = { ...golden.result.portfolio, parsedAt: 'test' } as unknown as Portfolio;
    const res = allocation(portfolio, categoryOf);
    expect(res.unclassifiedCount).toBe(2);
    const u = res.buckets.find((b) => b.category === 'Unclassified')!;
    expect(u.fundIds).toContain('INF000S01MY8');
    expect(u.fundIds.some((id) => id.startsWith('name:'))).toBe(true);
    expect(res.buckets.find((b) => b.category === 'Equity')!.fundIds).toEqual(['INF000S01RN0']);
  });
});
