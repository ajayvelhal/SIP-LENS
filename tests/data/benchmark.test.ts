// Bundled benchmark series (design §5.1; data design V-15, size budget) and the loader.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadBenchmark, makeBenchmarkSeries, isBenchmarkNavFile } from '../../src/data/benchmark';
import { dayNumber, daysBetween, isoFromDayNumber, isoDate } from '../../src/calculations/dates';
import type { BenchmarkNavFile } from '../../src/data/types';
import { REPO_ROOT } from '../helpers/pdfjsNode';

const filePath = path.join(REPO_ROOT, 'src', 'data', 'benchmarkNav.json');
const raw = fs.readFileSync(filePath);
const file = JSON.parse(raw.toString('utf8')) as BenchmarkNavFile;

describe('src/data/benchmarkNav.json', () => {
  it('has the designed schema and provenance', () => {
    expect(isBenchmarkNavFile(file)).toBe(true);
    expect(file.schemaVersion).toBe(1);
    expect(file.isin).toMatch(/^INF/);
    expect(file.amfiCode).toBe('120716');
    expect(file.schemeNameOnAmfi.toUpperCase()).toMatch(/NIFTY\s?50/);
    expect(file.schemeNameOnAmfi.toUpperCase()).toMatch(/DIRECT/);
    expect(file.schemeNameOnAmfi.toUpperCase()).toMatch(/GROWTH/);
    expect(file.source.name).toBe('AMFI NAV history');
    expect(file.source.licenceNote).toMatch(/AMFI/);
    expect(file.source.url).toMatch(/^https:\/\/www\.amfiindia\.com\//);
    expect(file.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(file.epoch).toBe(file.firstDate);
  });
  it('V-15: strictly increasing dates, positive 4-dp NAVs, no day change > 20%, no gap > 7 days, counts agree', () => {
    expect(file.points).toBe(file.nav.length);
    expect(file.dayOffsets.length).toBe(file.nav.length);
    expect(file.dayOffsets[0]).toBe(0);
    for (let i = 0; i < file.nav.length; i++) {
      const nav = file.nav[i]!;
      expect(nav).toBeGreaterThan(0);
      expect(Math.round(nav * 10000) / 10000).toBe(nav);
      if (i > 0) {
        expect(file.dayOffsets[i]!).toBeGreaterThan(file.dayOffsets[i - 1]!);
        expect(file.dayOffsets[i]! - file.dayOffsets[i - 1]!).toBeLessThanOrEqual(7);
        expect(Math.abs(nav / file.nav[i - 1]! - 1)).toBeLessThanOrEqual(0.2);
      }
    }
    const last = isoFromDayNumber(dayNumber(file.epoch) + file.dayOffsets[file.dayOffsets.length - 1]!);
    expect(last).toBe(file.lastDate);
    expect(daysBetween(file.lastDate, isoDate(file.generatedAt.slice(0, 10)))).toBeLessThanOrEqual(7);
  });
  it('stays within the size budget (≤ 70 KB raw, ≤ 35 KB gzipped)', () => {
    expect(raw.length).toBeLessThanOrEqual(70 * 1024);
    expect(zlib.gzipSync(raw, { level: 9 }).length).toBeLessThanOrEqual(35 * 1024);
  });
  it('navOnOrBefore: exact day, previous business day on a weekend, null before the series', async () => {
    const loaded = await loadBenchmark();
    expect(loaded).not.toBeNull();
    const s = loaded!.series;
    expect(s.navOnOrBefore(s.firstDate)).toEqual({ date: s.firstDate, nav: file.nav[0] });
    expect(s.navOnOrBefore(isoDate('2000-01-01'))).toBeNull();
    const lastPoint = s.navOnOrBefore(isoDate('2099-01-01'))!;
    expect(lastPoint.date).toBe(s.lastDate);
    // a date between two points returns the earlier one
    const d1 = isoFromDayNumber(dayNumber(file.epoch) + file.dayOffsets[1]!);
    const between = isoFromDayNumber(dayNumber(d1) - 1);
    expect(s.navOnOrBefore(between)!.date).toBe(between === s.firstDate ? s.firstDate : s.firstDate);
  });
  it('a file with the wrong schemaVersion is treated as absent (V-7)', () => {
    expect(isBenchmarkNavFile({ ...file, schemaVersion: 2 })).toBe(false);
    expect(() => makeBenchmarkSeries(file)).not.toThrow();
  });
});
