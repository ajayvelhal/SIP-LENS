// src/lib/format.ts
// The only place display formatting decisions live (design §4.10, UI design §1 copy rules). Components receive
// already formatted strings from here; calculations never format. Rupees use Indian grouping, a true minus and no
// decimals outside the cash-flow drawer; dates read "30 Sep 2026"; XIRR is one decimal; gaps carry a sign and "pp".

import type { ISODate } from '../engine';

const MINUS = '−';
export const DASH = '—';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const groupInt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const group2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function signOf(n: number): '' | typeof MINUS {
  return n < 0 ? MINUS : '';
}

/** ₹12,34,567 (rounded to the rupee); negatives as −₹1,234. `decimals: 2` for the drawer and CSV. */
export function formatRupees(n: number, opts: { decimals?: 0 | 2; signed?: boolean } = {}): string {
  const abs = Math.abs(n);
  const digits = opts.decimals === 2 ? group2.format(abs) : groupInt.format(abs);
  const isZero = opts.decimals === 2 ? abs < 0.005 : abs < 0.5;
  const sign = isZero ? '' : n < 0 ? MINUS : opts.signed ? '+' : '';
  return `${sign}₹${digits}`;
}

/** Plain number with Indian grouping at the given decimals (units held, NAVs). */
export function formatNumber(n: number, decimals: number): string {
  return `${signOf(n)}${new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(n))}`;
}

/** XIRR as "13.2%"; negative as "−4.2%". `rate` is a decimal per year. */
export function formatXirr(rate: number): string {
  const pct = Math.abs(rate) * 100;
  const rounded = Math.round(pct * 10) / 10;
  return `${rate < 0 && rounded !== 0 ? MINUS : ''}${rounded.toFixed(1)}%`;
}

/** Allocation share "42.0%". */
export function formatShare(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

export type GapWord = 'ahead' | 'behind' | 'level';

/**
 * UA5: the contract's `gapPoints` is benchmark − yours; the investor reads yours − benchmark, so the sign is
 * flipped here and the word carries the meaning. |gap| below 0.05 pp is "level".
 */
export function formatGap(gapPoints: number): { text: string; word: GapWord; sign: -1 | 0 | 1 } {
  const yoursMinusIndex = -gapPoints * 100;
  const rounded = Math.round(yoursMinusIndex * 10) / 10;
  if (Math.abs(yoursMinusIndex) < 0.05 || rounded === 0) return { text: '0.0 pp', word: 'level', sign: 0 };
  const sign = rounded > 0 ? '+' : MINUS;
  return { text: `${sign}${Math.abs(rounded).toFixed(1)} pp`, word: rounded > 0 ? 'ahead' : 'behind', sign: rounded > 0 ? 1 : -1 };
}

/** "30 Sep 2026" (UA1: no leading zero). */
export function formatDate(iso: ISODate | string): string {
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`;
}

/** "Mar 2021". */
export function formatMonthYear(iso: ISODate | string): string {
  const m = Number(iso.slice(5, 7));
  return `${MONTHS[m - 1] ?? ''} ${iso.slice(0, 4)}`;
}

/** "Mar 21" for instalment chips. */
export function formatMonthShort(iso: ISODate | string): string {
  const m = Number(iso.slice(5, 7));
  return `${MONTHS[m - 1] ?? ''} ${iso.slice(2, 4)}`;
}

/** "FY2026-27" from the rules config reads "FY 2026-27" in headings. */
export function formatFy(fy: string): string {
  return fy.replace(/^FY(?=\d)/, 'FY ');
}

export function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** "1 fund" / "3 funds". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${groupInt.format(n)} ${n === 1 ? singular : pluralForm}`;
}

export const FREQUENCY_WORD = { weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly' } as const;
export const PERIOD_WORD = { weekly: 'week', monthly: 'month', quarterly: 'quarter' } as const;

/** Today's date as ISO (the UI's only clock read; used for the 60-day staleness note, US-15). */
export function todayIso(): ISODate {
  return new Date().toISOString().slice(0, 10) as ISODate;
}

/** Abbreviation for the cash-flow drawer's Fund column: first letters of the scheme name words. */
export function abbreviateScheme(name: string): string {
  const words = name.split(/[\s–-]+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  return words.slice(0, 5).map((w) => (w[0] as string).toUpperCase()).join('');
}
