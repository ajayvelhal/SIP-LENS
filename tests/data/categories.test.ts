// Bundled ISIN -> category map (design §5.2; data design D3, D6, V-16) and the loader.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isIsinCategoryFile, loadCategories, makeCategoryLookup } from '../../src/data/categories';
import type { IsinCategoryFile } from '../../src/data/types';
import { REPO_ROOT, FIXTURES_DIR } from '../helpers/pdfjsNode';

const raw = fs.readFileSync(path.join(REPO_ROOT, 'src', 'data', 'isinCategory.json'));
const file = JSON.parse(raw.toString('utf8')) as IsinCategoryFile;
const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'isinCategory.fixture.json'), 'utf8')) as IsinCategoryFile;

describe('src/data/isinCategory.json', () => {
  it('has the designed schema', () => {
    expect(isIsinCategoryFile(file)).toBe(true);
    expect(file.categories).toEqual(['Equity', 'Debt', 'Hybrid', 'Other']);
    expect(file.taxClasses).toEqual(['equity', 'debt', 'hybrid-other', 'unknown']);
    expect(file.source.url).toMatch(/amfiindia\.com/);
    expect(file.source.structures).toEqual(['Open Ended']);
  });
  it('V-16: valid ISINs, tuples in range, no ISIN twice, benchmark and synthetic ISINs present', () => {
    const seen = new Set<string>();
    for (const g of file.groups) {
      const [c, s, t, e] = g.t;
      expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThan(4);
      expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThan(file.subCategories.length);
      expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThan(4);
      expect([0, 1]).toContain(e);
      for (const isin of g.isins) {
        expect(isin).toMatch(/^[A-Z]{2}[A-Z0-9]{9}\d$/);
        expect(seen.has(isin), `duplicate ${isin}`).toBe(false);
        seen.add(isin);
      }
    }
    expect(seen.size).toBe(file.isinCount);
    expect(seen.has('INF789F01XA0')).toBe(true);
    expect(file.synthetic.length).toBe(24);
    for (const s of file.synthetic) { expect(s.startsWith('INF000S01')).toBe(true); expect(seen.has(s)).toBe(true); }
    expect(seen.size).toBeGreaterThan(5000);
  });
  it('stays within the size budget (≤ 320 KB raw, ≤ 80 KB gzipped)', () => {
    expect(raw.length).toBeLessThanOrEqual(320 * 1024);
    expect(zlib.gzipSync(raw, { level: 9 }).length).toBeLessThanOrEqual(80 * 1024);
  });
  it('categoryOf decodes the tuples; unknown ISIN and undefined -> undefined (E61)', async () => {
    const { categoryOf } = await loadCategories();
    expect(categoryOf('INF000S01EL2')).toEqual({ category: 'Equity', subCategory: 'ELSS', taxClass: 'equity', isElss: true });
    expect(categoryOf('INF000S01LQ6')).toMatchObject({ category: 'Debt', taxClass: 'debt', isElss: false });
    expect(categoryOf('INF000S01BA1')).toMatchObject({ category: 'Hybrid', taxClass: 'hybrid-other' });
    expect(categoryOf('INF000S01IN9')).toMatchObject({ category: 'Equity', taxClass: 'debt' });
    expect(categoryOf('INF789F01XA0')).toMatchObject({ category: 'Equity', taxClass: 'equity', isElss: false });
    expect(categoryOf('INF000S01MY8')).toBeUndefined();
    expect(categoryOf(undefined)).toBeUndefined();
    expect(categoryOf('inf000s01el2')).toBeDefined();
  });
  it('the fixture map decodes the same way and the same synthetic funds classify identically', () => {
    const bundled = makeCategoryLookup(file);
    const fx = makeCategoryLookup(fixture);
    for (const isin of fixture.synthetic) expect(bundled(isin), isin).toEqual(fx(isin));
  });
  it('a file with the wrong schemaVersion is treated as absent (V-7)', () => {
    expect(isIsinCategoryFile({ ...file, schemaVersion: 2 })).toBe(false);
  });
});
