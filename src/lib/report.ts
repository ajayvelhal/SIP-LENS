// src/lib/report.ts
// "Report a parsing issue" payload (design §7.5). Built from ParseResult and ParseError only: counts, codes, page
// numbers and digit-masked row text. No amounts, units, NAVs, names, PAN, folio numbers, emails, addresses or dates.

import type { ParseError, ParseErrorCode, ParseResult, ParseWarningCode, Rta, TransactionKind } from '../engine';

export interface ParseIssueReport {
  reportVersion: 1;
  app: { version: string; commit: string };
  browser: { userAgent: string; isMobile: boolean };
  document?: {
    issuer: Rta | 'unknown';
    rtasSeen: Rta[];
    statementYear: number;
    pageCount: number;
    unitDecimals: 3 | 4;
    investorCount: number;
  };
  structure?: {
    folios: number; funds: number; rows: number; transactions: number;
    kindCounts: Record<TransactionKind, number>;
    reconciliation: { ok: number; mismatch: number; noClosingBalance: number };
  };
  warnings: { code: ParseWarningCode; count: number; maskedExamples: string[]; pages: number[] }[];
  error?: { code: ParseErrorCode; stage?: string; errorName?: string };
  timing?: { extractMs: number; parseMs: number };
}

const KINDS: TransactionKind[] = ['purchase', 'sip', 'switch_in', 'switch_out', 'redemption', 'dividend_payout', 'dividend_reinvest',
  'stamp_duty', 'stt_tds', 'reversal', 'segregated', 'unit_adjustment', 'unknown'];

/** Digits are already '#' in maskedRowText; this re-masks defensively and trims to 80 characters. */
function mask(text: string): string {
  return text.replace(/\d/g, '#').slice(0, 80);
}

export function buildReport(input: { result?: ParseResult; error?: ParseError }): ParseIssueReport {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const ua = nav?.userAgent ?? '';
  const report: ParseIssueReport = {
    reportVersion: 1,
    app: { version: __APP_VERSION__, commit: import.meta.env.VITE_COMMIT ?? 'dev' },
    browser: { userAgent: ua, isMobile: /Mobi|Android/i.test(ua) },
    warnings: [],
  };
  const { result, error } = input;
  if (result) {
    const p = result.portfolio;
    const kindCounts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<TransactionKind, number>;
    const rtas = new Set<Rta>();
    for (const f of p.funds) for (const fo of f.folios) {
      rtas.add(fo.rta);
      for (const t of fo.transactions) kindCounts[t.kind]++;
    }
    const recon = { ok: 0, mismatch: 0, noClosingBalance: 0 };
    for (const s of Object.values(result.reconciliation)) {
      if (s === 'ok') recon.ok++;
      else if (s === 'mismatch') recon.mismatch++;
      else recon.noClosingBalance++;
    }
    report.document = {
      issuer: p.issuer,
      rtasSeen: [...rtas],
      statementYear: Number(p.statementDate.slice(0, 4)),
      pageCount: p.pageCount,
      unitDecimals: p.unitDecimals,
      investorCount: p.investorCount,
    };
    report.structure = {
      folios: result.stats.folios, funds: result.stats.funds, rows: result.stats.rows, transactions: result.stats.transactions,
      kindCounts, reconciliation: recon,
    };
    const byCode = new Map<ParseWarningCode, { count: number; examples: Set<string>; pages: Set<number> }>();
    for (const w of result.warnings) {
      const entry = byCode.get(w.code) ?? { count: 0, examples: new Set<string>(), pages: new Set<number>() };
      entry.count++;
      if (w.maskedRowText && entry.examples.size < 5) entry.examples.add(mask(w.maskedRowText));
      if (w.page !== undefined) entry.pages.add(w.page);
      byCode.set(w.code, entry);
    }
    report.warnings = [...byCode.entries()].map(([code, e]) => ({ code, count: e.count, maskedExamples: [...e.examples], pages: [...e.pages].sort((a, b) => a - b) }));
    report.timing = { extractMs: result.stats.extractMs, parseMs: result.stats.parseMs };
  }
  if (error) {
    report.error = { code: error.code };
    if (error.code === 'INTERNAL') { report.error.stage = error.stage; report.error.errorName = error.errorName; }
  }
  return report;
}
