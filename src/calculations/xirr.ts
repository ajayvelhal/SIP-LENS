// src/calculations/xirr.ts
// Annualised internal rate of return with spreadsheet XIRR() semantics (design §4.5): bracketing on a rate grid,
// bounded Newton inside each bracket with bisection fallback, root nearest zero when several exist (A8).
// Day count actual/365 from the earliest flow (A9). Pure; never throws for finite inputs.

import type { ISODate } from '../parser/types';
import type { Cashflow, XirrResult } from './types';
import { dayNumber, isValidIsoDate } from './dates';

export interface XirrOptions {
  /** Max Newton iterations per bracket. Default 50. */
  maxNewtonIterations?: number;
  /** Max bisection iterations per bracket. Default 200 (bracket width 1e-12 reached far earlier). */
  maxBisectionIterations?: number;
  /** Convergence on rate. Default 1e-10. */
  rateTolerance?: number;
  /** Rate grid for bracketing. Default BRACKET_GRID below. */
  grid?: readonly number[];
}

export const BRACKET_GRID = [-0.9999, -0.99, -0.95, -0.9, -0.75, -0.5, -0.25, -0.1, 0, 0.05, 0.1, 0.2,
  0.35, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 50, 100] as const;

type Flow = Pick<Cashflow, 'date' | 'amount'>;

interface Prepared {
  t: Float64Array; // years from the earliest flow
  a: Float64Array; // amounts
}

function prepare(cashflows: ReadonlyArray<Flow>): Prepared {
  const nz: Flow[] = [];
  for (const cf of cashflows) {
    if (typeof cf.amount !== 'number' || !Number.isFinite(cf.amount)) throw new TypeError('xirr: amount must be a finite number');
    if (!isValidIsoDate(cf.date)) throw new TypeError('xirr: date must be an ISODate');
    if (cf.amount !== 0) nz.push(cf);
  }
  let d0 = Number.POSITIVE_INFINITY;
  const days = nz.map((cf) => { const d = dayNumber(cf.date); if (d < d0) d0 = d; return d; });
  const t = new Float64Array(nz.length);
  const a = new Float64Array(nz.length);
  for (let i = 0; i < nz.length; i++) {
    t[i] = ((days[i] as number) - d0) / 365;
    a[i] = (nz[i] as Flow).amount;
  }
  return { t, a };
}

/** (1+r)^(-t) computed as exp(-t * log1p(r)) to stay finite near r = -1. */
function npvPrepared(p: Prepared, r: number): number {
  const l = Math.log1p(r);
  let s = 0;
  for (let i = 0; i < p.a.length; i++) s += (p.a[i] as number) * Math.exp(-(p.t[i] as number) * l);
  return s;
}

function dnpvPrepared(p: Prepared, r: number): number {
  const l = Math.log1p(r);
  let s = 0;
  for (let i = 0; i < p.a.length; i++) {
    const t = p.t[i] as number;
    s += -t * (p.a[i] as number) * Math.exp(-(t + 1) * l);
  }
  return s;
}

/** Net present value at `rate` over the same series; exported for the drawer's "check this yourself" line. */
export function npv(cashflows: ReadonlyArray<Flow>, rate: number): number {
  return npvPrepared(prepare(cashflows), rate);
}

/**
 * Annualised internal rate of return of dated cashflows (spreadsheet XIRR semantics).
 * Units: `rate` is a decimal fraction per year (0.132 = 13.2%). The UI formats to 1 dp.
 * Sign convention: investor perspective (outflows negative). Day count: actual/365 from the earliest date (A9).
 * Never throws for finite inputs; returns a discriminated result. Throws TypeError only on NaN/Infinity/invalid dates.
 * Pure and deterministic; no dependence on the order of `cashflows`.
 */
export function xirr(cashflows: ReadonlyArray<Flow>, opts: XirrOptions = {}): XirrResult {
  const maxNewton = opts.maxNewtonIterations ?? 50;
  const maxBisect = opts.maxBisectionIterations ?? 200;
  const tol = opts.rateTolerance ?? 1e-10;
  const grid = opts.grid ?? BRACKET_GRID;

  const p = prepare(cashflows);
  const n = p.a.length;
  if (n < 2) return { status: 'insufficient', reason: 'fewer-than-two' };
  const dates = new Set<ISODate>();
  for (const cf of cashflows) if (cf.amount !== 0) dates.add(cf.date);
  if (dates.size < 2) return { status: 'insufficient', reason: 'same-day' };
  let pos = false, neg = false;
  for (let i = 0; i < n; i++) { if ((p.a[i] as number) > 0) pos = true; else neg = true; }
  if (!pos || !neg) return { status: 'insufficient', reason: 'same-sign' };

  // Bracketing: adjacent grid points with opposite signs (or an exact zero).
  const brackets: Array<[number, number]> = [];
  let prevR = grid[0] as number;
  let prevF = npvPrepared(p, prevR);
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i] as number;
    const f = npvPrepared(p, r);
    if (prevF === 0) brackets.push([prevR, prevR]);
    else if (Number.isFinite(prevF) && Number.isFinite(f) && Math.sign(prevF) !== Math.sign(f)) brackets.push([prevR, r]);
    prevR = r;
    prevF = f;
  }
  if (prevF === 0) brackets.push([prevR, prevR]);
  if (brackets.length === 0) return { status: 'no-convergence', reason: 'no-bracket' };

  const roots: Array<{ rate: number; iterations: number; method: 'newton' | 'bisection' }> = [];
  let exhausted = false;
  for (const [bLo, bHi] of brackets) {
    if (bLo === bHi) { roots.push({ rate: bLo, iterations: 0, method: 'newton' }); continue; }
    let lo = bLo, hi = bHi;
    let r = (lo + hi) / 2;
    let it = 0;
    let converged = false;
    let method: 'newton' | 'bisection' = 'newton';
    for (; it < maxNewton; it++) {
      const f = npvPrepared(p, r);
      const d = dnpvPrepared(p, r);
      if (!Number.isFinite(d) || d === 0) break;
      const next = r - f / d;
      if (!Number.isFinite(next) || next <= lo || next >= hi) break;
      if (Math.abs(next - r) < tol) { r = next; converged = true; it++; break; }
      r = next;
    }
    if (!converged) {
      method = 'bisection';
      let fLo = npvPrepared(p, lo);
      for (it = 0; it < maxBisect && hi - lo > tol; it++) {
        const mid = (lo + hi) / 2;
        const fm = npvPrepared(p, mid);
        if (fm === 0) { lo = hi = mid; break; }
        if (Math.sign(fm) === Math.sign(fLo)) { lo = mid; fLo = fm; } else hi = mid;
      }
      if (hi - lo > tol) { exhausted = true; continue; }
      r = (lo + hi) / 2;
    }
    if (!roots.some((x) => Math.abs(x.rate - r) < 1e-6)) roots.push({ rate: r, iterations: it, method });
  }
  if (roots.length === 0) return { status: 'no-convergence', reason: exhausted ? 'iterations' : 'no-bracket' };
  roots.sort((x, y) => Math.abs(x.rate) - Math.abs(y.rate));
  const best = roots[0] as { rate: number; iterations: number; method: 'newton' | 'bisection' };
  const result: XirrResult = { status: 'ok', rate: best.rate, iterations: best.iterations, method: best.method };
  if (roots.length > 1) result.warning = 'multiple-roots';
  return result;
}
