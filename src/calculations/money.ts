// src/calculations/money.ts
// Rounding and exact summation helpers (design §3.1). Money is rupees as numbers; every emitted amount is
// rounded once at the boundary with round-half-away-from-zero, and long series are summed with compensation.

/** Round half away from zero at `dp` decimals, nudged against binary noise (1e-9). */
export function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  const x = Math.abs(n) * f;
  const r = Math.floor(x + 0.5 + 1e-9);
  return (n < 0 ? -r : r) / f;
}

export const round2 = (n: number): number => roundTo(n, 2);
export const round3 = (n: number): number => roundTo(n, 3);
export const round4 = (n: number): number => roundTo(n, 4);
export const roundRupee = (n: number): number => roundTo(n, 0);

/** Neumaier (improved Kahan-Babuska) summation: exact to the last bit for thousands of rupee amounts. */
export function sumExact(values: Iterable<number>): number {
  let sum = 0;
  let c = 0;
  for (const v of values) {
    const t = sum + v;
    if (Math.abs(sum) >= Math.abs(v)) c += sum - t + v;
    else c += v - t + sum;
    sum = t;
  }
  return sum + c;
}

/** |a - b| <= tol. */
export function within(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

/** Relative closeness: |a - b| <= rel x max(|a|, |b|). */
export function withinRelative(a: number, b: number, rel: number): boolean {
  return Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));
}
