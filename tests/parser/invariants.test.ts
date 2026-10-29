// Structural invariants V-9 to V-12 (02-database-design.md §2) over every parsed golden, plus the manifest fence V-17.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ParseResult } from '../../src/parser/types';
import { FIXTURES_DIR, REPO_ROOT, fixtureNames } from '../helpers/pdfjsNode';
import { loadGolden } from '../helpers/golden';
import type { FixtureManifest } from './goldenTypes';

describe('invariants over goldens', () => {
  for (const name of fixtureNames()) {
    const golden = loadGolden(name);
    if (golden.expect !== 'result' || golden.digest) continue;
    it(`${name}: V-9 referential integrity, V-10 denormalised fields, V-11 aggregates, V-12 stats`, () => {
      const r = golden.result as unknown as ParseResult;
      const ids = new Set<string>();
      let txCount = 0, unknown = 0, folios = 0;
      const fundIds = new Set(r.portfolio.funds.map((f) => f.id));
      for (const fund of r.portfolio.funds) {
        const dp = fund.folios[0]!.reconciliation.decimals;
        let units = 0; let value: number | undefined;
        for (const fo of fund.folios) {
          folios++;
          const inFolio = new Set(fo.transactions.map((t) => t.id));
          fo.transactions.forEach((t, i) => {
            expect(ids.has(t.id), `duplicate id ${t.id}`).toBe(false);
            ids.add(t.id);
            expect(t.id).toBe(`${fund.id}:${fo.folioNumber}:${i}`);
            expect(t.rta).toBe(fo.rta);
            expect(t.folioNumber).toBe(fo.folioNumber);
            expect(t.isin).toBe(fund.isin);
            expect([fund.schemeName, ...(fund.alsoPrintedAs ?? [])]).toContain(t.schemeName);
            if (t.attachedTo) { expect(inFolio.has(t.attachedTo)).toBe(true); expect(fo.transactions.find((x) => x.id === t.attachedTo)!.levies).toContain(t.id); }
            for (const l of t.levies ?? []) expect(fo.transactions.find((x) => x.id === l)!.attachedTo).toBe(t.id);
            if (t.reverses) expect(fo.transactions.find((x) => x.id === t.reverses)!.reversedBy).toBe(t.id);
            if (t.reversedBy) expect(fo.transactions.find((x) => x.id === t.reversedBy)!.reverses).toBe(t.id);
            if (t.kind === 'unknown') unknown++;
            txCount++;
          });
          if (fo.closingUnits !== undefined) units += fo.closingUnits;
          if (fo.closingValue !== undefined) value = (value ?? 0) + fo.closingValue;
        }
        expect(fund.closingUnits).toBeCloseTo(units, dp);
        if (value === undefined) expect(fund.closingValue).toBeUndefined(); else expect(fund.closingValue).toBeCloseTo(value, 2);
        const flagged = r.warnings.some((w) => w.fundId === fund.id && w.severity === 'flag');
        const recNotOk = fund.folios.some((fo) => fo.reconciliation.status !== 'ok');
        expect(fund.mayBeIncomplete).toBe(flagged || recNotOk);
        const worst = fund.folios.map((fo) => fo.reconciliation.status).sort((a, b) => ({ ok: 0, 'no-closing-balance': 1, mismatch: 2 }[b] - { ok: 0, 'no-closing-balance': 1, mismatch: 2 }[a]))[0];
        expect(r.reconciliation[fund.id]).toBe(worst);
      }
      for (const w of r.warnings) if (w.fundId) expect(fundIds.has(w.fundId)).toBe(true);
      expect(Object.keys(r.reconciliation).sort()).toEqual([...fundIds].sort());
      expect(r.stats.transactions).toBe(txCount);
      expect(r.stats.unclassified).toBe(unknown);
      expect(r.stats.folios).toBe(folios);
      expect(r.stats.funds).toBe(r.portfolio.funds.length);
      expect(r.stats.pages).toBe(r.portfolio.pageCount);
      expect(r.portfolio.schemaVersion).toBe(1);
    });
  }
});

describe('fixture manifest (V-17): every PDF under tests/fixtures is one the generator wrote', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'MANIFEST.json'), 'utf8')) as FixtureManifest;
  it('every manifest entry matches on disk', () => {
    for (const [rel, info] of Object.entries(manifest.files)) {
      const buf = fs.readFileSync(path.join(REPO_ROOT, rel));
      expect(buf.length, rel).toBe(info.bytes);
      expect(createHash('sha256').update(buf).digest('hex'), rel).toBe(info.sha256);
    }
  });
  it('no stray PDF sits in tests/fixtures or public', () => {
    const listed = new Set(Object.keys(manifest.files));
    for (const dir of ['tests/fixtures', 'public']) {
      for (const f of fs.readdirSync(path.join(REPO_ROOT, dir))) {
        if (!f.endsWith('.pdf')) continue;
        expect(listed.has(`${dir}/${f}`), `${dir}/${f} is not in MANIFEST.json`).toBe(true);
      }
    }
  });
});
