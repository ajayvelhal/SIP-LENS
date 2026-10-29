#!/usr/bin/env node
// scripts/gen-fixtures.mjs
//
// Generates the synthetic fixture corpus: CAMS- and KFintech-style detailed CAS PDFs, summary CAS PDFs,
// NSDL/CDSL depository PDFs, a scanned PDF, non-CAS PDFs, a non-PDF file, the public sample CAS, and for
// each of them the golden JSON the parser and calculation engine must reproduce (02-database-design.md,
// "Fixture corpus" and "Golden format").
//
//   node scripts/gen-fixtures.mjs                 # dry-run: expand, lay out and build every golden in memory; print the table; write nothing
//   node scripts/gen-fixtures.mjs --apply         # write tests/fixtures/* and public/sample-cas.pdf
//   node scripts/gen-fixtures.mjs --only cams-2019-plain-sip --apply
//   node scripts/gen-fixtures.mjs --list
//
// Outputs (all inside the repo, nowhere else):
//   tests/fixtures/<name>.pdf              the synthetic statement (or the not-a-pdf bytes)
//   tests/fixtures/<name>.golden.json      expected ParseResult / ParseError + invariants
//   tests/fixtures/<name>.meta.json        password, encryption, page count, sha256 of the PDF
//   tests/fixtures/benchmarkNav.fixture.json   synthetic benchmark series (same schema as src/data/benchmarkNav.json)
//   tests/fixtures/isinCategory.fixture.json   synthetic ISIN map (same schema as src/data/isinCategory.json)
//   tests/fixtures/MANIFEST.json           every file above with its sha256; CI fails on any *.pdf not listed here
//   public/sample-cas.pdf                  the "Try with a sample CAS" statement (US-11); its golden stays in tests/fixtures
//
// Safety: this script has NO inputs. It never opens, reads, copies or lists any PDF. Every investor, folio,
// PAN, fund, ISIN (namespace INF000S01xx) and number is generated from a fixed seed. Dry-run by default;
// --apply writes only the files listed above. The dry-run path needs no npm packages; --apply needs the
// devDependency `pdfkit` (see lib/cas-pdf.mjs for why).

import { createHash } from 'node:crypto';
import {
  REPO_ROOT, assertInsideRepo, parseArgs, printHelp, log, fmtBytes, gzipSize, writeFileInRepo, stableJson, dayNumber,
} from './lib/cli.mjs';
import { FIXTURES, expandFixture, GENERATOR_VERSION } from './lib/fixtures-spec.mjs';
import { layoutCas, layoutDepository, layoutBankStatement, layoutCamsLetter } from './lib/cas-layout.mjs';
import { buildGolden } from './lib/golden.mjs';
import { navSeries, SCHEMES, BENCHMARK_FIXTURE_KEY, syntheticCategoryOverlay, SYNTHETIC_HOLIDAYS } from './lib/synthetic.mjs';

const SPEC = {
  apply:        { type: 'boolean', default: false, help: 'Write the fixture files (otherwise dry-run).' },
  only:         { type: 'string',  default: '', help: 'Comma-separated fixture names to generate (default: all).' },
  list:         { type: 'boolean', default: false, help: 'List fixtures with their expected outcome and exit.' },
  'out-dir':    { type: 'string',  default: 'tests/fixtures', help: 'Fixture directory, relative to the repo root.' },
  'public-dir': { type: 'string',  default: 'public', help: 'Where sample-cas.pdf goes, relative to the repo root.' },
  'no-pdf':     { type: 'boolean', default: false, help: 'With --apply: write goldens, meta and data fixtures only (no pdfkit needed).' },
  'render-check': { type: 'boolean', default: false, help: 'Dry-run: also render PDFs in memory (needs pdfkit) to report byte sizes.' },
  help:         { type: 'boolean', default: false, help: 'Show this help.' },
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function benchmarkFixtureFile() {
  const s = SCHEMES[BENCHMARK_FIXTURE_KEY];
  const series = navSeries(BENCHMARK_FIXTURE_KEY);
  const dates = [...series.keys()].filter((d) => d <= '2026-09-30');
  const epoch = dates[0];
  const e0 = dayNumber(epoch);
  return {
    schemaVersion: 1,
    fundName: s.name,
    schemeNameOnAmfi: s.name,
    amfiCode: s.amfi,
    amcCode: '0',
    isin: s.isin,
    source: { name: 'SYNTHETIC fixture series (scripts/gen-fixtures.mjs)', url: 'about:blank', termsUrl: 'about:blank', licenceNote: 'Synthetic data for tests only. Not AMFI data. Same schema as src/data/benchmarkNav.json.' },
    generatedAt: '1970-01-01T00:00:00.000Z',
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    epoch,
    points: dates.length,
    validation: { maxDayChangePct: null, maxGapDays: null, maxGapAfter: null, staleDaysAtGeneration: 0, syntheticHolidays: SYNTHETIC_HOLIDAYS },
    dayOffsets: dates.map((d) => dayNumber(d) - e0),
    nav: dates.map((d) => series.get(d)),
  };
}

function isinFixtureFile() {
  const CATEGORIES = ['Equity', 'Debt', 'Hybrid', 'Other'];
  const TAX = ['equity', 'debt', 'hybrid-other', 'unknown'];
  const overlay = syntheticCategoryOverlay();
  const subCategories = [...new Set(overlay.map((o) => o.subCategory))].sort();
  const groups = new Map();
  for (const o of overlay) {
    const t = [CATEGORIES.indexOf(o.category), subCategories.indexOf(o.subCategory), TAX.indexOf(o.taxClass), o.isElss ? 1 : 0];
    const k = t.join(',');
    if (!groups.has(k)) groups.set(k, { t, isins: [] });
    groups.get(k).isins.push(o.isin);
  }
  return {
    schemaVersion: 1,
    generatedAt: '1970-01-01T00:00:00.000Z',
    source: { name: 'SYNTHETIC fixture map (scripts/gen-fixtures.mjs)', url: 'about:blank', termsUrl: 'about:blank', licenceNote: 'Synthetic data for tests only. Same schema as src/data/isinCategory.json.', structures: ['Open Ended'] },
    categories: CATEGORIES,
    subCategories,
    taxClasses: TAX,
    isinCount: overlay.length,
    groups: [...groups.values()].sort((a, b) => a.t.join(',').localeCompare(b.t.join(','))).map((g) => ({ t: g.t, isins: g.isins.sort() })),
    synthetic: overlay.map((o) => o.isin).sort(),
  };
}

/** Produces { golden, layout, pdf?: () => Promise<Buffer>, bytes?: Buffer } for one fixture without touching disk. */
async function produce(fx, { render }) {
  const { renderLayout, renderScanned, notAPdfBytes } = render ? await import('./lib/cas-pdf.mjs') : {};
  let layout = null, golden, pdf = null, bytes = null;
  switch (fx.kind) {
    case 'detailed':
    case 'summary': {
      const expanded = expandFixture(fx);
      layout = layoutCas(expanded);
      golden = buildGolden(expanded, layout);
      if (render) pdf = () => renderLayout(layout, fx);
      break;
    }
    case 'depository':
      layout = layoutDepository(fx);
      golden = buildGolden(expandFixture(fx), layout);
      if (render) pdf = () => renderLayout(layout, fx);
      break;
    case 'not-cas':
      layout = layoutBankStatement();
      golden = buildGolden(expandFixture(fx), layout);
      if (render) pdf = () => renderLayout(layout, fx);
      break;
    case 'cams-letter':
      layout = layoutCamsLetter();
      golden = buildGolden(expandFixture(fx), layout);
      if (render) pdf = () => renderLayout(layout, fx);
      break;
    case 'scanned':
      golden = buildGolden(expandFixture(fx), { pageCount: 2 });
      if (render) pdf = () => renderScanned();
      break;
    case 'not-pdf':
      golden = buildGolden(expandFixture(fx), { pageCount: 0 });
      if (render) bytes = notAPdfBytes();
      break;
    default: throw new Error(`unknown fixture kind ${fx.kind}`);
  }
  return { golden, layout, pdf, bytes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), SPEC);
  if (args.help) { printHelp('gen-fixtures.mjs', 'generate the synthetic CAS fixture corpus and goldens', SPEC); return 0; }
  const outDir = args['out-dir'];
  const publicDir = args['public-dir'];
  assertInsideRepo(outDir); assertInsideRepo(publicDir);
  const selected = args.only ? FIXTURES.filter((f) => args.only.split(',').includes(f.name)) : FIXTURES;
  if (args.only && selected.length !== args.only.split(',').length) throw new Error(`unknown fixture in --only; known: ${FIXTURES.map((f) => f.name).join(', ')}`);

  if (args.list) {
    for (const f of FIXTURES) console.log(`${f.name.padEnd(30)} ${f.kind.padEnd(11)} expect ${f.expect.padEnd(14)} ${f.edges.join(', ')}`);
    return 0;
  }

  const render = args.apply ? !args['no-pdf'] : args['render-check'];
  const manifest = { generator: { script: 'scripts/gen-fixtures.mjs', version: GENERATOR_VERSION }, files: {} };
  const writes = []; // [relPath, Buffer|string]
  const table = [];

  for (const fx of selected) {
    const { golden, layout, pdf, bytes } = await produce(fx, { render });
    const goldenJson = stableJson(golden);
    const pdfRel = fx.publicSample ? `${publicDir}/${fx.name}.pdf` : `${outDir}/${fx.name}.pdf`;
    let pdfBuf = null;
    if (render) pdfBuf = bytes ?? (await pdf());
    const meta = {
      fixture: `${fx.name}.pdf`, kind: fx.kind, expect: fx.expect,
      password: fx.password, encryption: fx.password ? fx.encryption ?? 'AES-128' : undefined, ownerPasswordOnly: fx.ownerPassword ? true : undefined,
      pageCount: layout?.pageCount ?? golden.result?.portfolio?.pageCount ?? (fx.kind === 'scanned' ? 2 : 0),
      bytes: pdfBuf?.length, sha256: pdfBuf ? sha256(pdfBuf) : undefined,
      generator: { script: 'scripts/gen-fixtures.mjs', version: GENERATOR_VERSION },
    };
    const row = { name: fx.name, kind: fx.kind, expect: fx.expect, pages: meta.pageCount, lines: layout?.lineCount ?? 0, tx: golden.result?.stats?.transactions ?? 0, warnings: golden.result?.warnings?.map((w) => w.code).filter((v, i, a) => a.indexOf(v) === i).join(',') ?? '', golden: goldenJson.length, pdf: pdfBuf?.length, split: layout?.pageSplitRows ?? 0 };
    table.push(row);
    if (pdfBuf) writes.push([pdfRel, pdfBuf]);
    writes.push([`${outDir}/${fx.name}.golden.json`, goldenJson]);
    writes.push([`${outDir}/${fx.name}.meta.json`, stableJson(meta)]);
    if (fx.publicSample && pdfBuf && pdfBuf.length > 300 * 1024) log.warn(`sample-cas.pdf is ${fmtBytes(pdfBuf.length)}, over the 300 KB budget (design §5.4)`);
  }
  if (!args.only) {
    writes.push([`${outDir}/benchmarkNav.fixture.json`, stableJson(benchmarkFixtureFile())]);
    writes.push([`${outDir}/isinCategory.fixture.json`, stableJson(isinFixtureFile())]);
  }
  for (const [rel, data] of writes) manifest.files[rel] = { bytes: Buffer.byteLength(data), sha256: sha256(data) };
  if (!args.only) writes.push([`${outDir}/MANIFEST.json`, stableJson(manifest)]);

  // Report
  console.log('');
  console.log(['fixture'.padEnd(28), 'kind'.padEnd(11), 'expect'.padEnd(15), 'pages', ' lines', '   tx', 'split', 'golden', '   pdf', ' warnings'].join(' '));
  for (const r of table) console.log([r.name.padEnd(28), r.kind.padEnd(11), r.expect.padEnd(15), String(r.pages).padStart(5), String(r.lines).padStart(6), String(r.tx).padStart(5), String(r.split).padStart(5), fmtBytes(r.golden).padStart(8), (r.pdf ? fmtBytes(r.pdf) : '  n/a').padStart(9), ' ' + r.warnings].join(' '));
  const totalBytes = writes.reduce((a, [, d]) => a + Buffer.byteLength(d), 0);
  console.log('');
  console.log(`  ${table.length} fixtures, ${writes.length} files, ${fmtBytes(totalBytes)} total${render ? '' : ' (PDF sizes unknown in dry-run; add --render-check)'}`);
  const detailed = table.filter((r) => r.expect === 'result');
  console.log(`  detailed/parsed: ${detailed.length}, rejected: ${table.length - detailed.length}, pages max: ${Math.max(...table.map((r) => r.pages))}`);
  console.log('');

  if (!args.apply) {
    log.plan(`would write ${writes.length} files under ${outDir}/ and ${publicDir}/ (nothing written). Re-run with --apply to write them.`);
    return 0;
  }
  for (const [rel, data] of writes) {
    if (!rel.startsWith(outDir + '/') && !rel.startsWith(publicDir + '/')) throw new Error(`internal: refusing to write outside ${outDir}/ or ${publicDir}/: ${rel}`);
    writeFileInRepo(rel, data);
  }
  log.info(`wrote ${writes.length} files (${fmtBytes(totalBytes)}) under ${REPO_ROOT}`);
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => { log.error(e.stack ?? e.message); process.exit(1); });
