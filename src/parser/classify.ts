// src/parser/classify.ts
// description -> TransactionKind via an ordered pattern table (design §3.4). First match wins; nothing matches
// -> 'unknown'. Taxonomy checklist credited to the open-source `casparser` project.

import type { TransactionKind } from './types';

export interface ClassifyContext {
  /** Printed units, signed; undefined when the row has no units cell. */
  units?: number;
  amount?: number;
  nav?: number;
}

interface Rule {
  kind: TransactionKind;
  patterns: RegExp[];
}

/** Applied to the upper-cased description. Order is the contract. */
export const CLASSIFY_TABLE: readonly Rule[] = [
  { kind: 'stamp_duty', patterns: [/\*\*\*\s*STAMP DUTY/, /STAMP DUTY/] },
  { kind: 'stt_tds', patterns: [/\*\*\*\s*STT/, /STT PAID/, /\bTDS\b/, /\bTAX DEDUCTED/] },
  { kind: 'reversal', patterns: [/REVERSAL/, /REJECT/, /REVERSED/, /\*\*\*\s*REV\b/] },
  { kind: 'segregated', patterns: [/SEGREGAT/, /SIDE POCKET/] },
  { kind: 'switch_in', patterns: [/SWITCH[- ]*IN\b/, /SWITCH IN - FROM/, /\bSTP[- ]*IN\b/, /LATERAL SHIFT IN/] },
  { kind: 'switch_out', patterns: [/SWITCH[- ]*OUT\b/, /SWITCH OUT - TO/, /\bSTP[- ]*OUT\b/, /LATERAL SHIFT OUT/] },
  { kind: 'dividend_reinvest', patterns: [/(IDCW|DIVIDEND).*(REINVEST)/] },
  { kind: 'dividend_payout', patterns: [/(IDCW|DIVIDEND).*(PAYOUT|PAID)/] },
  { kind: 'sip', patterns: [/SYSTEMATIC INVESTMENT/, /\bSIP\b/, /PURCHASE - SYSTEMATIC/, /SIP PURCHASE/] },
  { kind: 'redemption', patterns: [/REDEMPTION/, /REDEEM/, /\bSWP\b/, /SYSTEMATIC WITHDRAWAL/] },
  { kind: 'purchase', patterns: [/PURCHASE/, /SUBSCRIPTION/, /\bNFO\b/, /NEW PURCHASE/, /ADDITIONAL PURCHASE/] },
  { kind: 'unit_adjustment', patterns: [/\bBONUS\b/, /UNIT ADJUSTMENT/, /MERGER/, /CONSOLIDATION/, /TRANSFER IN/, /TRANSFER OUT/, /TRANSMISSION/, /CHANGE OF BROKER/] },
];

const BARE_DIVIDEND = /\b(IDCW|DIVIDEND)\b/;

/**
 * A row whose description opens with a transaction verb ("Redemption - IDCW Payout Option", "Redemption (Less TDS)",
 * "Purchase (Net of Stamp Duty)") is that transaction; the dividend / TDS / stamp-duty words only qualify the plan
 * option or the net amount. Such rows skip the levy and dividend rules, which otherwise sit ahead of redemption/purchase.
 */
const LEADING_VERB = /^(REDEMPTION|REDEEM|PURCHASE|ADDITIONAL PURCHASE|NEW PURCHASE|SYSTEMATIC INVESTMENT|SIP\b|SWP\b|NFO\b)/;
const LEVY_OR_DIVIDEND: ReadonlySet<TransactionKind> = new Set(['stamp_duty', 'stt_tds', 'dividend_reinvest', 'dividend_payout']);

/**
 * Classifies a printed description. The bare "IDCW" / "Dividend" row (E17) is resolved by its numbers:
 * units > 0 with amount ≈ units x NAV -> dividend_reinvest, otherwise dividend_payout.
 */
export function classifyDescription(description: string, ctx: ClassifyContext = {}): TransactionKind {
  const d = description.toUpperCase().replace(/\s+/g, ' ').trim();
  const leadingVerb = LEADING_VERB.test(d);
  for (const rule of CLASSIFY_TABLE) {
    if (leadingVerb && LEVY_OR_DIVIDEND.has(rule.kind)) continue;
    if (rule.kind === 'sip' && !leadingVerb && BARE_DIVIDEND.test(d)) {
      // Pattern 8 fallback sits between 8 and 9 in the design's order: a bare IDCW/Dividend row.
      return bareDividendKind(ctx);
    }
    if (rule.patterns.some((p) => p.test(d))) return rule.kind;
  }
  if (!leadingVerb && BARE_DIVIDEND.test(d)) return bareDividendKind(ctx);
  return 'unknown';
}

function bareDividendKind(ctx: ClassifyContext): TransactionKind {
  const { units, amount, nav } = ctx;
  if (units !== undefined && units > 0) {
    if (amount === undefined || nav === undefined) return 'dividend_reinvest';
    const expected = units * nav;
    if (Math.abs(Math.abs(amount) - expected) <= Math.max(0.01, 0.01 * expected)) return 'dividend_reinvest';
  }
  return 'dividend_payout';
}

export const PURCHASE_LIKE: ReadonlySet<TransactionKind> = new Set(['purchase', 'sip', 'switch_in', 'dividend_reinvest']);
export const REDEMPTION_LIKE: ReadonlySet<TransactionKind> = new Set(['redemption', 'switch_out']);
export const NO_CASH_KINDS: ReadonlySet<TransactionKind> = new Set(['segregated', 'unit_adjustment', 'unknown']);
