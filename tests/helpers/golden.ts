// tests/helpers/golden.ts
// Golden comparison rules (02-database-design.md §4.6) and the digest canonical form shared with scripts/lib/golden.mjs.
import { createHash } from 'node:crypto';
import type { ParseResult, Transaction } from '../../src/parser/types';
import type { GoldenFile } from '../parser/goldenTypes';
import { parseFixture, readGolden } from './pdfjsNode';
import type { Portfolio } from '../../src/parser/types';

export function loadGolden(name: string): GoldenFile {
  const g = readGolden<GoldenFile>(name);
  if (g.goldenVersion !== 1) throw new Error(`${name}: goldenVersion ${String(g.goldenVersion)} is not 1; refusing to compare`);
  return g;
}

/** Strips the fields the comparison ignores: parsedAt, stats.rows, stats.extractMs, stats.parseMs. */
export function comparable(result: ParseResult): unknown {
  const { parsedAt: _parsedAt, ...portfolio } = result.portfolio;
  const { rows: _rows, extractMs: _e, parseMs: _p, ...stats } = result.stats;
  return stripUndefined({ portfolio, warnings: result.warnings, reconciliation: result.reconciliation, stats });
}

/** The same projection applied to a golden's `result` (which carries measured stats as zeros). */
export function comparableGolden<T extends { portfolio: Record<string, unknown>; stats: Record<string, unknown> }>(golden: T): unknown {
  const { parsedAt: _parsedAt, ...portfolio } = golden.portfolio;
  const { rows: _rows, extractMs: _e, parseMs: _p, ...stats } = golden.stats;
  return stripUndefined({ ...golden, portfolio, stats });
}

export function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => stripUndefined(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val !== undefined) out[k] = stripUndefined(val);
    return out as T;
  }
  return v;
}

/** Same canonical tuple as scripts/lib/golden.mjs digestResult(). */
export function digestTransactions(txs: Transaction[]): { count: number; sha256: string } {
  const h = createHash('sha256');
  for (const t of txs) {
    h.update([t.date, t.kind, t.amount ?? '', t.units ?? '', t.nav ?? '', t.unitBalance ?? '', t.description, t.page, t.attachedTo ?? '', t.reverses ?? ''].join('\u001f') + '\n');
  }
  return { count: txs.length, sha256: h.digest('hex') };
}

export function digestResult(result: ParseResult): unknown {
  const c = comparable(result) as { portfolio: { funds: Array<{ folios: Array<{ transactions: Transaction[] | { count: number; sha256: string } }> }> } };
  for (const fund of c.portfolio.funds) for (const folio of fund.folios) folio.transactions = digestTransactions(folio.transactions as Transaction[]);
  return c;
}

/** Warnings are compared as a set keyed by id (P6). */
export function warningsById(ws: ReadonlyArray<{ id: string }>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const w of ws) out[w.id] = stripUndefined(w);
  return out;
}

/** Collapses whitespace in every description so the comparison follows §4.6's description rule. */
export function normaliseDescriptions<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => normaliseDescriptions(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = k === 'description' && typeof val === 'string' ? val.replace(/\s+/g, ' ').trim() : normaliseDescriptions(val);
    }
    return out as T;
  }
  return v;
}

const portfolioCache = new Map<string, Promise<Portfolio>>();

/**
 * The Portfolio a calculation test runs on: the golden's own result for full goldens (no PDF needed), the parsed
 * PDF for the two digest goldens (their transactions are stored as a count + sha256 only).
 */
export function portfolioForFixture(name: string, golden: GoldenFile): Promise<Portfolio> {
  let p = portfolioCache.get(name);
  if (!p) {
    p = (async () => {
      if (golden.expect !== 'result') throw new Error(`${name} is a rejected fixture`);
      if (!golden.digest) return { ...golden.result.portfolio, parsedAt: 'test' } as unknown as Portfolio;
      const trace = await parseFixture(name);
      if (!trace.outcome.ok) throw new Error(`${name} did not parse: ${JSON.stringify(trace.outcome.error)}`);
      return trace.outcome.result.portfolio;
    })();
    portfolioCache.set(name, p);
  }
  return p;
}
