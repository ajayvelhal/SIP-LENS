// src/data/types.ts
// On-disk shapes of the bundled datasets (02-database-design.md §3, §7.2).
import type { ISODate } from '../parser/types';

/** On-disk shape of src/data/benchmarkNav.json (02-database-design.md §3.1). */
export interface BenchmarkNavFile {
  schemaVersion: 1;
  fundName: string;                 // 'UTI Nifty 50 Index Fund - Direct Plan - Growth'
  schemeNameOnAmfi: string;         // verbatim AMFI name at generation (D4)
  amfiCode: string;                 // '120716' (to verify at first --apply)
  amcCode: string;                  // AMFI `mf` code, '28' (to verify)
  isin: string;                     // 'INF789F01XA0' (to verify)
  source: { name: string; url: string; endpoint: string; termsUrl: string; licenceNote: string };
  generatedAt: string;              // ISO 8601 datetime
  firstDate: ISODate;
  lastDate: ISODate;
  epoch: ISODate;                   // dayOffsets are days since this date (equals firstDate)
  points: number;                   // === dayOffsets.length === nav.length
  validation: { maxDayChangePct: number | null; maxGapDays: number | null; maxGapAfter: ISODate | null; staleDaysAtGeneration: number };
  dayOffsets: number[];             // strictly increasing integers
  nav: number[];                    // 4 dp, > 0
}

export type CategoryName = 'Equity' | 'Debt' | 'Hybrid' | 'Other';
export type TaxClass = 'equity' | 'debt' | 'hybrid-other' | 'unknown';

/** On-disk shape of src/data/isinCategory.json (02-database-design.md §3.2, delta D3). */
export interface IsinCategoryFile {
  schemaVersion: 1;
  generatedAt: string;
  source: { name: string; url: string; termsUrl: string; licenceNote: string; structures: string[] };
  categories: readonly CategoryName[];              // index 0..3, fixed order
  subCategories: string[];                          // sorted SEBI sub-category strings
  taxClasses: readonly TaxClass[];                  // index 0..3, fixed order
  isinCount: number;
  /** Each group: t = [categoryIdx, subCategoryIdx, taxClassIdx, isElss (0|1)]; isins sorted. No ISIN appears twice. */
  groups: { t: [number, number, number, 0 | 1]; isins: string[] }[];
  /** ISINs that come from the fixture overlay (namespace INF000S01xx), not from AMFI (D6). */
  synthetic: string[];
}
