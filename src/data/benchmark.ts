// src/data/benchmark.ts
// Typed lazy loader for the bundled benchmark NAV series (design §5.1): schemaVersion check (V-7; a mismatch
// means "dataset absent", never a crash) and navOnOrBefore by binary search over dayOffsets.

import type { ISODate } from '../parser/types';
import type { BenchmarkSeries } from '../calculations/indexCompare';
import { dayNumber, isoFromDayNumber } from '../calculations/dates';
import type { BenchmarkNavFile } from './types';

export function isBenchmarkNavFile(v: unknown): v is BenchmarkNavFile {
  if (!v || typeof v !== 'object') return false;
  const f = v as Partial<BenchmarkNavFile>;
  return f.schemaVersion === 1 && Array.isArray(f.dayOffsets) && Array.isArray(f.nav) && f.dayOffsets.length === f.nav.length
    && typeof f.epoch === 'string' && typeof f.firstDate === 'string' && typeof f.lastDate === 'string' && f.nav.length > 0;
}

/** Builds the lookup from a file (used by the app for the bundled file and by tests for the fixture series). */
export function makeBenchmarkSeries(file: BenchmarkNavFile): BenchmarkSeries {
  const epochDay = dayNumber(file.epoch);
  const offsets = file.dayOffsets;
  const navs = file.nav;
  const n = offsets.length;
  return {
    fundName: file.fundName,
    amfiCode: file.amfiCode,
    isin: file.isin,
    firstDate: file.firstDate,
    lastDate: file.lastDate,
    navOnOrBefore(date: ISODate) {
      const target = dayNumber(date) - epochDay;
      // last index with offsets[i] <= target
      let lo = 0, hi = n - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((offsets[mid] as number) <= target) { found = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (found === -1) return null;
      return { date: isoFromDayNumber(epochDay + (offsets[found] as number)), nav: navs[found] as number };
    },
  };
}

/** Lazy import of the bundled JSON (own chunk, loaded with the dashboard). null when the file is unreadable (V-7). */
export async function loadBenchmark(): Promise<{ series: BenchmarkSeries; file: BenchmarkNavFile } | null> {
  const mod = (await import('./benchmarkNav.json')) as { default?: unknown };
  const file = mod.default ?? mod;
  if (!isBenchmarkNavFile(file)) return null;
  return { series: makeBenchmarkSeries(file), file };
}
