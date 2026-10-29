// src/calculations/discipline.ts
// SIP detection, expected schedule, missed / stopped instalments, the 0-100 score and the missed-SIP cost
// (design §4.6, Q4, A18, A19, A25; data design P15). Pure; no clock.

import type { Fund, Folio, ISODate, Portfolio, Transaction } from '../parser/types';
import { addDays, addMonths, daysBetween, daysInMonth, fromYmd, weekday, ymd } from './dates';
import { round2, roundRupee, sumExact } from './money';

export type SipFrequency = 'weekly' | 'monthly' | 'quarterly';

export interface DetectedSip {
  fundId: string;
  folioNumber: string;
  frequency: SipFrequency;
  /** Instalment amount history (step-ups, A18): [{ from, amount }], first entry at the first instalment. */
  amounts: { from: ISODate; amount: number }[];
  firstDate: ISODate;
  lastObserved: ISODate;
  /** Transactions counted as instalments. */
  instalmentIds: string[];
  /** Expected schedule from firstDate to min(stoppedSince ?? asOf) by frequency, same day-of-month
   *  (clamped to month end). */
  expected: { date: ISODate; amount: number; matchedId?: string; status: 'made' | 'missed' | 'stopped' }[];
  /** Set when the last instalment is > 2 periods before asOf (Q4). Expected dates after it are 'stopped'. */
  stoppedSince?: ISODate;
  counts: { expected: number; made: number; missed: number; stopped: number };
  /** 100 x Σamount(made) / Σamount(expected non-stopped), integer 0..100. */
  percent: number;
  /** How the SIP was identified: description marker, or amount/spacing pattern. */
  evidence: 'description' | 'pattern' | 'both';
}

export interface DisciplineResult {
  /** null when no SIP was detected anywhere (UI shows "—", "No regular SIP found in this statement"). */
  score: number | null;         // integer 0..100 (A19)
  sips: DetectedSip[];
  /** Fund ids with purchases but no detected SIP (do not affect the score). */
  fundsWithoutSip: string[];
}

export interface DisciplineOptions {
  /** Days a purchase may be late/early and still match an expected date. Default 7 (Q4). */
  graceDays?: number;
  /** Relative tolerance on "same amount". Default 0.01 (Q4). */
  amountTolerance?: number;
  /** Minimum instalments to call it a SIP. Default 3. */
  minInstalments?: number;
  /** Periods of silence before 'stopped'. Default 2. */
  stopAfterPeriods?: number;
}

interface Instalment {
  id: string;
  date: ISODate;
  amount: number;
}

const SPACING: Record<SipFrequency, { lo: number; hi: number }> = {
  weekly: { lo: 6, hi: 8 },
  monthly: { lo: 28, hi: 35 },
  quarterly: { lo: 85, hi: 95 },
};

function frequencyOfSpacing(days: number): SipFrequency | undefined {
  if (days <= 10) return 'weekly';
  if (days >= 20 && days <= 45) return 'monthly';
  if (days >= 75 && days <= 105) return 'quarterly';
  return undefined;
}

function sameAmount(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
}

function mode<T>(values: T[], tieBreak: (a: T, b: T) => number): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestN = -1;
  for (const [v, n] of counts) {
    if (n > bestN || (n === bestN && best !== undefined && tieBreak(v, best) < 0)) { best = v; bestN = n; }
  }
  return best;
}

function modalFrequency(instalments: Instalment[]): SipFrequency {
  const freqs: SipFrequency[] = [];
  for (let i = 1; i < instalments.length; i++) {
    const f = frequencyOfSpacing(daysBetween((instalments[i - 1] as Instalment).date, (instalments[i] as Instalment).date));
    if (f) freqs.push(f);
  }
  return mode(freqs, () => 0) ?? 'monthly';
}

function addPeriods(date: ISODate, frequency: SipFrequency, n: number): ISODate {
  if (frequency === 'weekly') return addDays(date, 7 * n);
  return addMonths(date, (frequency === 'quarterly' ? 3 : 1) * n);
}

/** Expected dates from the first instalment to asOf: modal day-of-month (clamped) or modal weekday. */
function expectedDates(instalments: Instalment[], frequency: SipFrequency, asOf: ISODate, grace: number): ISODate[] {
  const first = (instalments[0] as Instalment).date;
  const out: ISODate[] = [];
  if (frequency === 'weekly') {
    const wd = mode(instalments.map((i) => weekday(i.date)), (a, b) => a - b) ?? weekday(first);
    let shift = (wd - weekday(first) + 7) % 7;
    if (shift > 3) shift -= 7;
    let d = addDays(first, shift);
    while (d <= asOf) { out.push(d); d = addDays(d, 7); }
    return out;
  }
  const dom = mode(instalments.map((i) => ymd(i.date).d), (a, b) => a - b) ?? ymd(first).d;
  const step = frequency === 'quarterly' ? 3 : 1;
  const { y, m } = ymd(first);
  let k = 0;
  // Start in the first instalment's month; if that candidate precedes the first instalment by more than the grace, start one period later.
  const startCandidate = clampDay(y, m, dom);
  if (daysBetween(startCandidate, first) > grace) k = 1;
  for (;;) {
    const total = y * 12 + (m - 1) + k * step;
    const yy = Math.floor(total / 12);
    const mm = total - yy * 12 + 1;
    const d = clampDay(yy, mm, dom);
    if (d > asOf) break;
    out.push(d);
    k++;
  }
  return out;
}

function clampDay(y: number, m: number, d: number): ISODate {
  return fromYmd(y, m, Math.min(d, daysInMonth(y, m)));
}

/** Step-up history (A18): a new amount counts once it recurs for `minInstalments` consecutive instalments. */
function amountHistory(instalments: Instalment[], tol: number, minRun: number): { from: ISODate; amount: number }[] {
  const first = instalments[0] as Instalment;
  const history = [{ from: first.date, amount: first.amount }];
  let current = first.amount;
  for (let i = 1; i < instalments.length; i++) {
    const inst = instalments[i] as Instalment;
    if (sameAmount(inst.amount, current, tol)) continue;
    let run = 0;
    for (let j = i; j < instalments.length && sameAmount((instalments[j] as Instalment).amount, inst.amount, tol); j++) run++;
    if (run >= minRun) {
      current = inst.amount;
      history.push({ from: inst.date, amount: inst.amount });
    }
  }
  return history;
}

function amountInForce(history: { from: ISODate; amount: number }[], date: ISODate): number {
  let amt = (history[0] as { amount: number }).amount;
  for (const h of history) if (h.from <= date) amt = h.amount;
  return amt;
}

function buildSip(fundId: string, folioNumber: string, instalments: Instalment[], evidence: DetectedSip['evidence'], asOf: ISODate, o: Required<DisciplineOptions>): DetectedSip {
  const sorted = [...instalments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.id < b.id ? -1 : 1));
  const frequency = modalFrequency(sorted);
  const history = amountHistory(sorted, o.amountTolerance, o.minInstalments);
  const first = sorted[0] as Instalment;
  const last = sorted[sorted.length - 1] as Instalment;
  const dates = expectedDates(sorted, frequency, asOf, o.graceDays);
  const stopped = addPeriods(last.date, frequency, o.stopAfterPeriods) < asOf;

  const unmatched = [...sorted];
  const expected: DetectedSip['expected'] = [];
  let stoppedSince: ISODate | undefined;
  for (const date of dates) {
    let bestIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    unmatched.forEach((inst, idx) => {
      const dist = Math.abs(daysBetween(date, inst.date));
      if (dist <= o.graceDays && dist < bestDist) { bestDist = dist; bestIdx = idx; }
    });
    if (bestIdx !== -1) {
      const inst = unmatched.splice(bestIdx, 1)[0] as Instalment;
      expected.push({ date, amount: amountInForce(history, inst.date), matchedId: inst.id, status: 'made' });
    } else if (stopped && date > last.date) {
      stoppedSince ??= date;
      expected.push({ date, amount: amountInForce(history, date), status: 'stopped' });
    } else {
      expected.push({ date, amount: amountInForce(history, date), status: 'missed' });
    }
  }
  const counts = { expected: expected.length, made: 0, missed: 0, stopped: 0 };
  let madeAmt = 0, expAmt = 0;
  for (const e of expected) {
    if (e.status === 'made') { counts.made++; madeAmt += e.amount; expAmt += e.amount; }
    else if (e.status === 'missed') { counts.missed++; expAmt += e.amount; }
    else counts.stopped++;
  }
  const sip: DetectedSip = {
    fundId, folioNumber, frequency, amounts: history, firstDate: first.date, lastObserved: last.date,
    instalmentIds: sorted.map((i) => i.id), expected, counts,
    percent: expAmt > 0 ? Math.round((100 * madeAmt) / expAmt) : 0,
    evidence,
  };
  if (stoppedSince !== undefined) sip.stoppedSince = stoppedSince;
  return sip;
}

/** Amount/spacing pattern detection on purchase rows (Q4): clusters of equal amounts in regular runs. */
function patternRuns(rows: Instalment[], o: Required<DisciplineOptions>): Instalment[][] {
  const runs: Instalment[][] = [];
  const remaining = [...rows].sort((a, b) => a.amount - b.amount || (a.date < b.date ? -1 : 1));
  while (remaining.length) {
    const seed = remaining[0] as Instalment;
    const cluster = remaining.filter((r) => sameAmount(r.amount, seed.amount, o.amountTolerance)).sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const c of cluster) remaining.splice(remaining.indexOf(c), 1);
    let run: Instalment[] = [];
    let runFreq: SipFrequency | undefined;
    const flush = () => { if (run.length >= o.minInstalments) runs.push(run); run = []; runFreq = undefined; };
    for (const inst of cluster) {
      const prev = run[run.length - 1];
      if (!prev) { run.push(inst); continue; }
      const gap = daysBetween(prev.date, inst.date);
      const fits = (f: SipFrequency) => (gap >= SPACING[f].lo && gap <= SPACING[f].hi) || (gap >= 2 * SPACING[f].lo && gap <= 2 * SPACING[f].hi);
      const f = runFreq ?? (['weekly', 'monthly', 'quarterly'] as SipFrequency[]).find(fits);
      if (f && fits(f)) { runFreq = f; run.push(inst); }
      else { flush(); run.push(inst); }
    }
    flush();
  }
  return runs;
}

/** Instalment amount is what left the bank: the printed amount plus its attached stamp duty (Q5), so "SIP ₹5,000" reads as the investor set it up. */
function instalmentsOf(folio: Folio, asOf: ISODate): { sipRows: Instalment[]; purchaseRows: Instalment[]; hasPurchases: boolean } {
  const sipRows: Instalment[] = [];
  const purchaseRows: Instalment[] = [];
  let hasPurchases = false;
  const byId = new Map<string, Transaction>();
  for (const tx of folio.transactions) byId.set(tx.id, tx);
  for (const tx of folio.transactions) {
    if (tx.kind !== 'sip' && tx.kind !== 'purchase') continue;
    hasPurchases = true;
    if (tx.excludedFromCashflows || tx.date > asOf || tx.amount === undefined || tx.amount <= 0) continue;
    const stamp = (tx.levies ?? []).map((id) => byId.get(id)).filter((l): l is Transaction => !!l && l.kind === 'stamp_duty' && !l.excludedFromCashflows).reduce((a, l) => a + Math.abs(l.amount ?? 0), 0);
    const inst = { id: tx.id, date: tx.date, amount: round2(Math.abs(tx.amount) + stamp) };
    if (tx.kind === 'sip') sipRows.push(inst); else purchaseRows.push(inst);
  }
  return { sipRows, purchaseRows, hasPurchases };
}

/** Pure. Uses only purchase/sip rows that are not excludedFromCashflows. Deterministic. */
export function disciplineScore(portfolio: Portfolio, asOf: ISODate, opts: DisciplineOptions = {}): DisciplineResult {
  const o: Required<DisciplineOptions> = {
    graceDays: opts.graceDays ?? 7,
    amountTolerance: opts.amountTolerance ?? 0.01,
    minInstalments: opts.minInstalments ?? 3,
    stopAfterPeriods: opts.stopAfterPeriods ?? 2,
  };
  const sips: DetectedSip[] = [];
  const fundsWithoutSip: string[] = [];
  for (const fund of portfolio.funds) {
    let fundHasSip = false;
    let fundHasPurchases = false;
    for (const folio of fund.folios) {
      const { sipRows, purchaseRows, hasPurchases } = instalmentsOf(folio, asOf);
      fundHasPurchases ||= hasPurchases;
      if (sipRows.length > 0) {
        sips.push(buildSip(fund.id, folio.folioNumber, sipRows, 'description', asOf, o));
        fundHasSip = true;
      }
      for (const run of patternRuns(purchaseRows, o)) {
        sips.push(buildSip(fund.id, folio.folioNumber, run, 'pattern', asOf, o));
        fundHasSip = true;
      }
    }
    if (fundHasPurchases && !fundHasSip) fundsWithoutSip.push(fund.id);
  }
  let made = 0, expected = 0;
  for (const s of sips) for (const e of s.expected) {
    if (e.status === 'made') { made += e.amount; expected += e.amount; }
    else if (e.status === 'missed') expected += e.amount;
  }
  const score = sips.length === 0 ? null : expected > 0 ? Math.round((100 * made) / expected) : 100;
  return { score, sips, fundsWithoutSip };
}

export interface MissedCostResult {
  fundId: string;
  /** Σ over missed instalments of (amount / navOnDate) x closingNav. */
  wouldBeWorth: number;
  /** Σ missed amounts (cash that never left the bank). */
  notInvested: number;
  /** wouldBeWorth - notInvested, rounded to the rupee. May be negative (then shown as "would have lost"). */
  growthForgone: number;
  perInstalment: { date: ISODate; amount: number; navEstimate: number; navSource: 'interpolated' | 'nearest' | 'closing' }[];
}

/** NAV interpolated from the fund's own transaction NAVs (A25). Returns null when the fund has no closing NAV. */
export function missedSipCost(fund: Fund, sip: DetectedSip, asOf: ISODate): MissedCostResult | null {
  const closingNav = fund.closingNav;
  if (closingNav === undefined) return null;
  const points: Array<{ date: ISODate; nav: number }> = [];
  for (const fo of fund.folios) for (const tx of fo.transactions) {
    if (tx.nav !== undefined && tx.nav > 0 && tx.date <= asOf) points.push({ date: tx.date, nav: tx.nav });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const perInstalment: MissedCostResult['perInstalment'] = [];
  for (const e of sip.expected) {
    if (e.status !== 'missed') continue;
    const est = estimateNav(points, e.date, closingNav, asOf);
    perInstalment.push({ date: e.date, amount: e.amount, navEstimate: est.nav, navSource: est.source });
  }
  const wouldBeWorth = round2(sumExact(perInstalment.map((p) => (p.amount / p.navEstimate) * closingNav)));
  const notInvested = round2(sumExact(perInstalment.map((p) => p.amount)));
  return { fundId: fund.id, wouldBeWorth, notInvested, growthForgone: roundRupee(wouldBeWorth - notInvested), perInstalment };
}

function estimateNav(points: Array<{ date: ISODate; nav: number }>, date: ISODate, closingNav: number, asOf: ISODate): { nav: number; source: 'interpolated' | 'nearest' | 'closing' } {
  let earlier: { date: ISODate; nav: number } | undefined;
  let later: { date: ISODate; nav: number } | undefined;
  for (const p of points) {
    if (p.date <= date) earlier = p;
    else { later = p; break; }
  }
  if (earlier && earlier.date === date) return { nav: earlier.nav, source: 'nearest' };
  if (earlier && later) {
    const span = daysBetween(earlier.date, later.date);
    const f = span > 0 ? daysBetween(earlier.date, date) / span : 0;
    return { nav: earlier.nav + (later.nav - earlier.nav) * f, source: 'interpolated' };
  }
  if (earlier) {
    const span = daysBetween(earlier.date, asOf);
    const f = span > 0 ? daysBetween(earlier.date, date) / span : 0;
    return { nav: earlier.nav + (closingNav - earlier.nav) * f, source: 'interpolated' };
  }
  if (later) return { nav: later.nav, source: 'nearest' };
  return { nav: closingNav, source: 'closing' };
}

export type { Transaction };

/** Identity of one detected SIP. A folio can hold several (different amounts or days), so the first instalment date is part of it. */
export const sipKey = (sip: Pick<DetectedSip, 'fundId' | 'folioNumber' | 'firstDate'>): string => `${sip.fundId}:${sip.folioNumber}:${sip.firstDate}`;

/** Missed-SIP cost for every detected SIP that has missed instalments, keyed per SIP (never per folio, or SIPs overwrite each other). */
export function missedCostBySip(portfolio: Portfolio, sips: readonly DetectedSip[], asOf: ISODate): Map<string, MissedCostResult> {
  const out = new Map<string, MissedCostResult>();
  for (const sip of sips) {
    const fund = portfolio.funds.find((f) => f.id === sip.fundId);
    if (!fund || sip.counts.missed === 0) continue;
    const cost = missedSipCost(fund, sip, asOf);
    if (cost) out.set(sipKey(sip), cost);
  }
  return out;
}
