// src/parser/types.ts
// Domain types of the parsed CAS. Source of truth: docs/features/sip-lens-v1/01-system-design.md §4.1,
// with the additive deltas of docs/features/sip-lens-v1/02-database-design.md §0.1.

/** Calendar date with no time or zone: 'YYYY-MM-DD'. Branded to stop accidental Date mixing. */
export type ISODate = string & { readonly __brand: 'ISODate' };

export type Rta = 'CAMS' | 'KFINTECH';

/** Closed enum. Adding a member is a schemaVersion bump. */
export type TransactionKind =
  | 'purchase'            // lump sum incl. "Purchase - via myCAMS", "Purchase-BSE", NFO, additional purchase
  | 'sip'                 // "Systematic Investment (n)", "SIP Purchase", "Purchase - Systematic"
  | 'switch_in'           // incl. STP in, lateral shift in
  | 'switch_out'          // incl. STP out, lateral shift out
  | 'redemption'          // incl. SWP
  | 'dividend_payout'     // IDCW payout; cash to investor, units unchanged
  | 'dividend_reinvest'   // IDCW reinvestment; no cash, units added at NAV
  | 'stamp_duty'          // levy row; attaches to a purchase-like parent
  | 'stt_tds'             // STT / TDS / tax-deducted row; attaches to a redemption-like parent
  | 'reversal'            // cancels an earlier row (pairs via `reverses`)
  | 'segregated'          // segregated-portfolio / side-pocket unit creation; no cash
  | 'unit_adjustment'     // bonus, merger, transfer in/out, transmission, broker change; no cash
  | 'unknown';            // dated row whose description matched nothing; raises UNCLASSIFIED_ROW

export interface Transaction {
  /** Stable within a ParseResult: `${fundId}:${folioNumber}:${rowIndex}` (rowIndex = index into folio.transactions). */
  id: string;
  rta: Rta;
  folioNumber: string;
  /** Scheme name as printed on this row's section header, after boilerplate removal, keeping plan and option. */
  schemeName: string;
  isin?: string;
  amfiCode?: string;
  date: ISODate;
  /** Description exactly as printed (multi-line joined with a single space). */
  description: string;
  kind: TransactionKind;
  /**
   * Rupees, SIGNED AS PRINTED in the CAS (scheme perspective): positive when money enters the scheme
   * (purchase, SIP, switch-in, dividend reinvested, levies), negative when it leaves (redemption,
   * switch-out). Dividend payout is printed positive. Reversal rows carry the opposite sign of the row
   * they reverse. 2 decimals. `undefined` for rows that print no amount (segregated, some adjustments).
   * The investor-perspective sign is applied by calculations/cashflows.ts, never here.
   */
  amount?: number;
  /** Units, SIGNED AS PRINTED (negative for redemption/switch-out). Printed precision (3 or 4 dp). */
  units?: number;
  /** NAV per unit as printed, 4 dp typical. */
  nav?: number;
  /** Running unit balance after this row as printed; used for reconciliation. Absent on levy rows. */
  unitBalance?: number;
  /** Page the row started on (for the redacted report; never shown with content). */
  page: number;
  /** For stamp_duty / stt_tds: id of the parent row. */
  attachedTo?: string;
  /** For purchase-like / redemption-like rows: ids of levies attached to them. */
  levies?: string[];
  /** For reversal rows: id of the reversed row. For reversed rows: id of the reversal. */
  reverses?: string;
  reversedBy?: string;
  /** True for reversed pairs, orphan reversals, segregated, unit_adjustment, unknown: shown as "ignored" in the drawer. */
  excludedFromCashflows: boolean;
}

export interface Folio {
  folioNumber: string;
  rta: Rta;
  /** Printed "Opening Unit Balance" (0 for folios opened in the period). */
  openingUnits: number;
  closingUnits?: number;
  closingNav?: number;
  /** Printed closing value (units x NAV as the RTA computed it). */
  closingValue?: number;
  /** As printed on the valuation row, if different from the statement date (A10). */
  valuationDate?: ISODate;
  transactions: Transaction[];
  reconciliation: FolioReconciliation;
}

export interface FolioReconciliation {
  status: 'ok' | 'mismatch' | 'no-closing-balance';
  computedClosingUnits: number;
  printedClosingUnits?: number;
  /** computed - printed, printed precision. */
  diff?: number;
  /** Index (into folio.transactions) of the first running-balance violation. */
  firstMismatchRow?: number;
  /** Tolerance used (A2): 2 x 10^-decimals. */
  toleranceUnits: number;
  decimals: 3 | 4;
}

export interface Fund {
  /** ISIN when printed; else `name:${normalisedSchemeName}|${folioNumber}` (A22, P1). */
  id: string;
  isin?: string;
  amfiCode?: string;
  /** Name printed on the first section seen for this fund (P2). */
  schemeName: string;
  /** Which AMC, extracted from the scheme header ("Mutual Fund" prefix) when printed. */
  amc?: string;
  folios: Folio[];
  /** Sum over folios of printed closing units / value; NAV is the common printed NAV. */
  closingUnits: number;
  closingNav?: number;
  closingValue?: number;
  /** True when any folio reconciliation is not 'ok' or any UNCLASSIFIED_ROW / ORPHAN_REVERSAL / FUTURE_DATED_ROW /
   *  COLUMN_DRIFT / PAGE_EXTRACT_FAILED warning references this fund. Drives "may be incomplete" everywhere (US-08). */
  mayBeIncomplete: boolean;
  /** Delta D1: other scheme names this ISIN was printed under in the same statement (E26). */
  alsoPrintedAs?: string[];
}

export type DocumentType =
  | 'RTA_DETAILED'
  | 'RTA_SUMMARY'
  | 'DEPOSITORY_NSDL'
  | 'DEPOSITORY_CDSL'
  | 'NOT_CAS'
  | 'NO_TEXT';

export interface Portfolio {
  /** Bump on any breaking change to this file. v1.0 ships 1. */
  schemaVersion: 1;
  /** Which RTA generated the document (the file as a whole). Folios carry their own rta. */
  issuer: Rta;
  statementDate: ISODate;
  statementPeriod: { from: ISODate; to: ISODate };
  /** Printed "generated on" date when the CAS prints one. */
  casGeneratedOn?: ISODate;
  /** When this object was produced (ISO 8601 datetime); the ONLY wall-clock value in the engine,
   *  injected by the worker, never read inside parsing. Stripped from goldens. */
  parsedAt: string;
  /** First investor's name line as printed, for the optional greeting only. Never on share card or in reports (A28). */
  investorName?: string;
  /** Distinct investor blocks seen (A3). PANs are not retained. */
  investorCount: number;
  funds: Fund[];
  pageCount: number;
  /** Decimal places the CAS prints for units (3 or 4); informs tolerances. */
  unitDecimals: 3 | 4;
}

export type ParseWarningCode =
  | 'UNCLASSIFIED_ROW'        // dated row, kind 'unknown'
  | 'UNIT_MISMATCH'           // running or closing balance off by more than tolerance
  | 'NO_CLOSING_BALANCE'      // scheme section ended without a closing/valuation row
  | 'ORPHAN_LEVY'             // stamp duty / STT with no same-day parent
  | 'ORPHAN_REVERSAL'         // reversal with no matching original
  | 'MISSING_ISIN'            // identity fell back to name+folio
  | 'MISSING_STATEMENT_DATE'
  | 'FUTURE_DATED_ROW'        // transaction after statement date (A27)
  | 'COLUMN_DRIFT'            // numeric cell outside calibrated columns, or amount/units/NAV arithmetic violated (D9)
  | 'PAGE_EXTRACT_FAILED'     // pdfjs threw for one page; parsing continued
  | 'DUPLICATE_SECTION'       // same folio+scheme header seen twice (duplicate pages)
  | 'MULTI_PAN';              // informational

export interface ParseWarning {
  id: string;                  // `${code}:${fundId ?? '-'}:${page ?? '-'}:${rowIndex ?? '-'}`
  code: ParseWarningCode;
  fundId?: string;
  folioNumber?: string;        // present in the UI banner; STRIPPED by lib/report.ts
  schemeName?: string;         // present in the UI banner; STRIPPED by lib/report.ts
  page?: number;
  rowIndex?: number;
  /** Description text with every digit replaced by '#'. Safe for the redacted report. */
  maskedRowText?: string;
  /** Severity: 'flag' marks the fund mayBeIncomplete; 'info' does not. */
  severity: 'flag' | 'info';
}

export interface ParseResult {
  portfolio: Portfolio;
  warnings: ParseWarning[];
  /** Per fund id: convenience projection of folio reconciliations (worst status wins: mismatch > no-closing-balance > ok). */
  reconciliation: Record<string, FolioReconciliation['status']>;
  stats: {
    pages: number;
    rows: number;
    transactions: number;
    unclassified: number;
    folios: number;
    funds: number;
    extractMs: number;
    parseMs: number;
  };
}

export type ParseErrorCode =
  | 'NOT_PDF'            // main thread
  | 'MULTIPLE_FILES'     // main thread
  | 'FILE_TOO_LARGE'     // main thread, > 50 MB
  | 'PDF_CORRUPT'        // pdfjs could not open (not a password problem)
  | 'TOO_MANY_PAGES'     // > 400
  | 'NO_TEXT'            // scanned / image-only (A4)
  | 'NOT_CAS'            // US-04
  | 'SUMMARY_CAS'        // US-05
  | 'DEPOSITORY_CAS'     // US-06
  | 'NO_FOLIOS_PARSED'   // detailed markers but the walk produced nothing usable (treated by UI as US-04)
  | 'CANCELLED'
  | 'WORKER_CRASH'
  | 'UNSUPPORTED_BROWSER'
  | 'INTERNAL';          // caught exception with a safe, content-free message

export type ParseError =
  | { code: 'NOT_PDF' | 'MULTIPLE_FILES' | 'TOO_MANY_PAGES' | 'PDF_CORRUPT' | 'NO_TEXT' | 'NOT_CAS'
          | 'NO_FOLIOS_PARSED' | 'CANCELLED' | 'WORKER_CRASH' | 'UNSUPPORTED_BROWSER';
      message: string }                                            // message is a fixed UI key (`ui.error.<CODE>`), not content
  | { code: 'FILE_TOO_LARGE'; message: string; sizeBytes: number; limitBytes: number }
  | { code: 'SUMMARY_CAS'; message: string; issuer: Rta; schemeNames: string[]; statementDate?: ISODate }
  | { code: 'DEPOSITORY_CAS'; message: string; depository: 'NSDL' | 'CDSL' }
  | { code: 'INTERNAL'; message: string; stage: 'open' | 'extract' | 'detect' | 'parse' | 'reconcile';
      /** Error class name only (e.g. 'RangeError'); never the message, which could echo content. */
      errorName: string };

/** Hard input limits (design A14). */
export const LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxPages: 400,
  /** Characters of text across pages 1-3 below which the PDF is treated as a scan (A4). */
  minTextChars: 200,
} as const;

/** ParseError.message is a fixed UI key; the UI maps it to the spec's strings (data design P9). */
export const uiErrorKey = (code: ParseErrorCode): string => `ui.error.${code}`;
