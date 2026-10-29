// src/calculations/dates.ts
// ISODate helpers (design §3.1). Pure integer arithmetic on calendar days; no Date objects cross module
// boundaries and nothing here reads the clock.

import type { ISODate } from '../parser/types';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(s: string): s is ISODate {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/** Asserts and brands. Throws TypeError on malformed input (the contract's only throwing path). */
export function isoDate(s: string): ISODate {
  if (!isValidIsoDate(s)) throw new TypeError(`invalid ISODate: ${s}`);
  return s;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function ymd(iso: ISODate): { y: number; m: number; d: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

export function fromYmd(y: number, m: number, d: number): ISODate {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` as ISODate;
}

/** Days since 1970-01-01. */
export function dayNumber(iso: ISODate): number {
  const { y, m, d } = ymd(iso);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function isoFromDayNumber(n: number): ISODate {
  return new Date(n * 86_400_000).toISOString().slice(0, 10) as ISODate;
}

/** b - a in calendar days (positive when b is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return dayNumber(b) - dayNumber(a);
}

export function addDays(iso: ISODate, days: number): ISODate {
  return isoFromDayNumber(dayNumber(iso) + days);
}

/** Calendar-month arithmetic with month-end clamping: 31 Jan + 1 month = 28/29 Feb (E33, E40). */
export function addMonths(iso: ISODate, months: number): ISODate {
  const { y, m, d } = ymd(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return fromYmd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Indian financial year of a date: 'FY2026-27' for 2026-04-01..2027-03-31 (A17). */
export function fyOf(iso: ISODate): string {
  const { y, m } = ymd(iso);
  const start = m >= 4 ? y : y - 1;
  return `FY${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekday(iso: ISODate): number {
  return (dayNumber(iso) + 4) % 7;
}

export function compareIso(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minIso(dates: readonly ISODate[]): ISODate | undefined {
  let best: ISODate | undefined;
  for (const d of dates) if (best === undefined || d < best) best = d;
  return best;
}

export function maxIso(dates: readonly ISODate[]): ISODate | undefined {
  let best: ISODate | undefined;
  for (const d of dates) if (best === undefined || d > best) best = d;
  return best;
}
