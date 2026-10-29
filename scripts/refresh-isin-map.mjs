#!/usr/bin/env node
// scripts/refresh-isin-map.mjs
//
// Builds src/data/isinCategory.json (ISIN -> category / subCategory / taxClass / ELSS flag) from the
// AMFI scheme master as exposed in NAVAll.txt, whose section headers carry the SEBI category
// ("Open Ended Schemes(Equity Scheme - ELSS)") and whose rows carry the growth/payout ISIN and the
// reinvestment ISIN of every plan.
//
//   node scripts/refresh-isin-map.mjs            # dry-run: fetch, classify, print counts and sizes, write nothing
//   node scripts/refresh-isin-map.mjs --apply    # also write src/data/isinCategory.json
//
// Shape (02-database-design.md, "Bundled datasets"; grouped-by-tuple encoding, a delta to §5.2's per-ISIN map):
//   { schemaVersion, generatedAt, source, categories, subCategories, taxClasses,
//     groups: [ { t: [categoryIdx, subCategoryIdx, taxClassIdx, isElss], isins: [...] } ],
//     synthetic: [ ...ISINs that come from the fixture overlay, not from AMFI ] }
//
// SEBI sub-category -> (category, taxClass) is the table TAX_TABLE below (design A15). Index funds, ETFs
// and FoFs are split equity / debt / gold by scheme-name heuristics (INDEX_RULES), because AMFI files
// them all under "Other Scheme".
//
// Safety: dry-run by default; writes only inside the repo; contacts only AMFI hosts; reads no PDFs.
// Requires Node >= 20 (global fetch). No npm dependencies.

import {
  assertInsideRepo, parseArgs, printHelp, log, gzipSize, fmtBytes,
  writeFileInRepo, readJsonInRepoIfExists, stableJson,
} from './lib/cli.mjs';
import { amfiFetchText, parseAmfiTable, parseSectionHeader, isIsin, NAVALL_URL, AMFI_TERMS_URL } from './lib/amfi.mjs';
import { pathToFileURL } from 'node:url';
import { syntheticCategoryOverlay } from './lib/synthetic.mjs';

const SPEC = {
  apply:              { type: 'boolean', default: false, help: 'Write src/data/isinCategory.json (otherwise dry-run).' },
  out:                { type: 'string',  default: 'src/data/isinCategory.json', help: 'Output path, relative to the repo root.' },
  'include-closed':   { type: 'boolean', default: false, help: 'Also include close-ended and interval schemes (default: open-ended only, to stay within budget).' },
  'include-synthetic':{ type: 'boolean', default: true,  help: 'Merge the fixture/sample synthetic ISINs (INF000S01xx) so the bundled sample CAS classifies.' },
  'allow-shrink':     { type: 'boolean', default: false, help: 'Allow more than 5% of previously bundled ISINs to disappear.' },
  'allow-unknown-subcategory': { type: 'boolean', default: false, help: 'Map SEBI sub-categories missing from TAX_TABLE to Other/unknown instead of failing.' },
  'allow-over-budget':{ type: 'boolean', default: false, help: 'Write even if the file exceeds the §7.2 budget (320 KB raw / 80 KB gz).' },
  'expect-isin':      { type: 'string',  default: 'INF789F01XA0', help: 'Comma-separated ISINs that must be present (default: the benchmark fund); missing ones fail the run.' },
  help:               { type: 'boolean', default: false, help: 'Show this help.' },
};

const RAW_BUDGET = 320 * 1024;
const GZ_BUDGET = 80 * 1024;

export const CATEGORIES = ['Equity', 'Debt', 'Hybrid', 'Other'];
export const TAX_CLASSES = ['equity', 'debt', 'hybrid-other', 'unknown'];

/**
 * SEBI sub-category (as printed inside the NAVAll.txt section header) -> [category, taxClass].
 * Design A15: aggressive hybrid, arbitrage, equity index/ETF/FoF-domestic-equity -> equity;
 * debt, liquid, international, gold, FoF-overseas -> debt; balanced advantage, dynamic asset
 * allocation, multi-asset, conservative hybrid, equity savings -> hybrid-other.
 * Keys are matched case-insensitively after collapsing whitespace and slashes.
 */
export const TAX_TABLE = {
  // Equity Scheme
  'multi cap fund': ['Equity', 'equity'], 'large cap fund': ['Equity', 'equity'], 'large & mid cap fund': ['Equity', 'equity'],
  'mid cap fund': ['Equity', 'equity'], 'small cap fund': ['Equity', 'equity'], 'dividend yield fund': ['Equity', 'equity'],
  'value fund': ['Equity', 'equity'], 'contra fund': ['Equity', 'equity'], 'focused fund': ['Equity', 'equity'],
  'sectoral thematic': ['Equity', 'equity'], 'sectoral/ thematic': ['Equity', 'equity'], 'elss': ['Equity', 'equity'],
  'flexi cap fund': ['Equity', 'equity'],
  // Names as AMFI actually prints them in NAVAll.txt (read on 2026-10-26); same classes as the rows above.
  'sectoral fund': ['Equity', 'equity'], 'thematic fund': ['Equity', 'equity'], 'elss- tax saver fund': ['Equity', 'equity'],
  'growth': ['Equity', 'equity'],                                   // legacy "Open Ended Schemes(Growth)" section
  'equity funds': ['Equity', 'equity'], 'equity etf': ['Equity', 'equity'], 'other etf': ['Equity', 'equity'],
  'etfs investing overseas': ['Equity', 'debt'], 'fund of funds investing overseas': ['Equity', 'debt'],
  // Debt Scheme
  'overnight fund': ['Debt', 'debt'], 'liquid fund': ['Debt', 'debt'], 'ultra short duration fund': ['Debt', 'debt'],
  'low duration fund': ['Debt', 'debt'], 'money market fund': ['Debt', 'debt'], 'short duration fund': ['Debt', 'debt'],
  'medium duration fund': ['Debt', 'debt'], 'medium to long duration fund': ['Debt', 'debt'], 'long duration fund': ['Debt', 'debt'],
  'dynamic bond': ['Debt', 'debt'], 'dynamic bond fund': ['Debt', 'debt'], 'corporate bond fund': ['Debt', 'debt'], 'credit risk fund': ['Debt', 'debt'],
  'banking and psu fund': ['Debt', 'debt'], 'gilt fund': ['Debt', 'debt'], 'gilt fund with 10 year constant duration': ['Debt', 'debt'],
  'floater fund': ['Debt', 'debt'], 'fixed maturity plans': ['Debt', 'debt'], 'fixed term plan': ['Debt', 'debt'],
  // AMFI's "Income/Debt Oriented Schemes" sub-categories and legacy debt sections (read on 2026-10-26)
  'income': ['Debt', 'debt'], 'gilt': ['Debt', 'debt'], 'debt funds': ['Debt', 'debt'], 'debt etf': ['Debt', 'debt'],
  '10-year constant maturity gilt fund': ['Debt', 'debt'], 'banking and psu debt fund': ['Debt', 'debt'],
  'dynamic term fund': ['Debt', 'debt'], 'floating interest rates fund': ['Debt', 'debt'],
  'long term fund': ['Debt', 'debt'], 'medium term fund': ['Debt', 'debt'], 'medium to long term fund': ['Debt', 'debt'],
  'short term fund': ['Debt', 'debt'], 'ultra short term fund': ['Debt', 'debt'], 'ultra short to short term fund': ['Debt', 'debt'],
  'other debt scheme': ['Debt', 'debt'],
  // Hybrid Scheme
  'conservative hybrid fund': ['Hybrid', 'hybrid-other'], 'balanced hybrid fund': ['Hybrid', 'hybrid-other'],
  'aggressive hybrid fund': ['Hybrid', 'equity'], 'dynamic asset allocation or balanced advantage': ['Hybrid', 'hybrid-other'],
  'balanced advantage fund': ['Hybrid', 'hybrid-other'], 'multi asset allocation': ['Hybrid', 'hybrid-other'],
  'arbitrage fund': ['Hybrid', 'equity'], 'equity savings': ['Hybrid', 'hybrid-other'],
  'balanced advantage fund/ dynamic asset allocation': ['Hybrid', 'hybrid-other'], 'hybrid fund': ['Hybrid', 'hybrid-other'],
  'hybrid etf': ['Hybrid', 'hybrid-other'], 'fund of funds scheme (domestic)': ['Hybrid', 'hybrid-other'],
  // Solution Oriented Scheme
  'retirement fund': ['Other', 'hybrid-other'], "children's fund": ['Other', 'hybrid-other'], 'childrens fund': ['Other', 'hybrid-other'],
  "childrens' fund": ['Other', 'hybrid-other'], 'children\u2019s fund': ['Other', 'hybrid-other'],
  'life cycle fund': ['Other', 'hybrid-other'],                     // "Life Cycle Fund with Maturity of N Years" (see classify)
  // Other Scheme: resolved by INDEX_RULES on the scheme name; these are the fallbacks
  'index funds': ['Equity', 'equity'], 'other etfs': ['Equity', 'equity'], 'gold etf': ['Other', 'debt'], 'silver etf': ['Other', 'debt'],
  'fof domestic': ['Hybrid', 'hybrid-other'], 'fof overseas': ['Equity', 'debt'],
};

/** Name heuristics for Other-scheme rows (index funds, ETFs, FoFs). First matching rule wins. */
export const INDEX_RULES = [
  { test: /\b(GOLD|SILVER)\b/i,                                                             to: ['Other', 'debt'] },
  { test: /(G-?SEC|GILT|SDL|PSU BOND|CORPORATE BOND|CRISIL IBX|BHARAT BOND|TARGET MATURITY|T-?BILL|TREASURY|MONEY MARKET|LIQUID|OVERNIGHT|DEBT|BOND|NIFTY 5 ?YR|NIFTY 10 ?YR|BENCHMARK)/i, to: ['Debt', 'debt'] },
  { test: /(NASDAQ|S&P 500|US |U\.S\.|GLOBAL|INTERNATIONAL|OVERSEAS|WORLD|CHINA|JAPAN|EUROPE|EMERGING|HANG SENG|FANG|BRAZIL|TAIWAN|DEVELOPED)/i, to: ['Equity', 'debt'] },
  { test: /(NIFTY|SENSEX|BSE|NSE|MIDCAP|SMALLCAP|LARGECAP|EQUITY|MOMENTUM|QUALITY|VALUE|ALPHA|LOW VOL|BANK|IT |PHARMA|AUTO|FMCG|INFRA|REALTY|CONSUMPTION|500|250|150|100|50)/i, to: ['Equity', 'equity'] },
];

function normaliseSub(sub) {
  return sub.toLowerCase().replace(/\s*\/\s*/g, '/ ').replace(/\s+/g, ' ').replace(/\s*&\s*/g, ' & ').trim();
}

/** Returns { category, subCategory, taxClass, isElss } or null when the sub-category is unknown. */
export function classify(section, schemeName) {
  const h = parseSectionHeader(section);
  if (!h) return null;
  const sub = h.subCategory || h.sebiClass;
  const key = normaliseSub(sub);
  let hit = TAX_TABLE[key] ?? TAX_TABLE[key.replace(/ fund$/, '')] ?? TAX_TABLE[key + ' fund'];
  if (!hit && /^life cycle fund/.test(key)) hit = TAX_TABLE['life cycle fund'];
  // Index funds, ETFs and FoFs are split by scheme name whatever class AMFI files them under (design A15).
  const isOther = /^(other|index funds|exchange traded|fund of funds|overseas fund of funds)/i.test(h.sebiClass);
  if (isOther) {
    for (const r of INDEX_RULES) if (r.test.test(schemeName)) { hit = r.to; break; }
    if (!hit) hit = TAX_TABLE[key] ?? ['Other', 'unknown'];
  }
  if (!hit) return null;
  return { category: hit[0], subCategory: sub, taxClass: hit[1], isElss: /elss/i.test(sub) || /\bELSS\b|TAX SAVER|TAX SAVING/i.test(schemeName) && hit[0] === 'Equity' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), SPEC);
  if (args.help) { printHelp('refresh-isin-map.mjs', 'build the bundled ISIN -> category map from the AMFI scheme master', SPEC); return 0; }
  assertInsideRepo(args.out);

  log.info(`fetching ${NAVALL_URL}`);
  const text = await amfiFetchText(NAVALL_URL);
  const { rows, sections } = parseAmfiTable(text);
  log.info(`${rows.length} scheme rows, ${sections.length} sections`);

  const entries = new Map(); // isin -> { category, subCategory, taxClass, isElss, schemeName }
  const unknownSubs = new Map();
  const problems = [];
  const warnings = [];
  let skippedStructure = 0, skippedNoIsin = 0, conflicts = 0;

  for (const r of rows) {
    const h = parseSectionHeader(r._section);
    if (!h) { skippedNoIsin++; continue; }
    if (!args['include-closed'] && h.structure !== 'Open Ended') { skippedStructure++; continue; }
    const cls = classify(r._section, r.schemeName);
    if (!cls) {
      unknownSubs.set(h.subCategory || h.sebiClass, (unknownSubs.get(h.subCategory || h.sebiClass) ?? 0) + 1);
      if (!args['allow-unknown-subcategory']) continue;
    }
    const info = cls ?? { category: 'Other', subCategory: h.subCategory || h.sebiClass, taxClass: 'unknown', isElss: false };
    for (const isin of [r.isinGrowthOrPayout, r.isinReinvest]) {
      if (!isin || !isIsin(isin)) { if (!isin || isin === '-') skippedNoIsin++; continue; }
      const prev = entries.get(isin);
      if (prev && (prev.category !== info.category || prev.taxClass !== info.taxClass)) conflicts++;
      entries.set(isin, { ...info, schemeName: r.schemeName });
    }
  }
  if (unknownSubs.size) {
    const list = [...unknownSubs].map(([k, n]) => `"${k}" (${n} rows)`).join(', ');
    (args['allow-unknown-subcategory'] ? warnings : problems).push(`SEBI sub-categories missing from TAX_TABLE: ${list}. Add them to the table (design A15) and re-run.`);
  }
  if (conflicts) warnings.push(`${conflicts} ISINs appeared under two sections with different classes; the later section won`);

  // Overlay: synthetic ISINs used by the fixtures and the bundled sample CAS.
  const synthetic = [];
  if (args['include-synthetic']) {
    for (const s of syntheticCategoryOverlay()) {
      entries.set(s.isin, { category: s.category, subCategory: s.subCategory, taxClass: s.taxClass, isElss: s.isElss, schemeName: s.schemeName });
      synthetic.push(s.isin);
    }
  }

  // Expected ISINs (benchmark fund by default).
  for (const isin of args['expect-isin'].split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!entries.has(isin)) problems.push(`expected ISIN ${isin} is not in the AMFI master (benchmark fund ISIN to verify; pass --expect-isin= to override)`);
  }

  // Encode: group by tuple.
  const subCategories = [...new Set([...entries.values()].map((e) => e.subCategory))].sort();
  const groups = new Map();
  for (const [isin, e] of entries) {
    const t = [CATEGORIES.indexOf(e.category), subCategories.indexOf(e.subCategory), TAX_CLASSES.indexOf(e.taxClass), e.isElss ? 1 : 0];
    if (t.includes(-1)) throw new Error(`internal: bad tuple for ${isin}: ${JSON.stringify(e)}`);
    const k = t.join(',');
    if (!groups.has(k)) groups.set(k, { t, isins: [] });
    groups.get(k).isins.push(isin);
  }
  const groupList = [...groups.values()].sort((a, b) => a.t.join(',').localeCompare(b.t.join(','))).map((g) => ({ t: g.t, isins: g.isins.sort() }));

  // Diff guard against the bundled file.
  const previous = readJsonInRepoIfExists(args.out);
  if (previous?.groups) {
    const prevIsins = new Set(previous.groups.flatMap((g) => g.isins));
    const gone = [...prevIsins].filter((i) => !entries.has(i)).length;
    const pct = prevIsins.size ? gone / prevIsins.size : 0;
    const msg = `${gone} of ${prevIsins.size} previously bundled ISINs (${(pct * 100).toFixed(1)}%) are missing from the new master`;
    if (pct > 0.05) (args['allow-shrink'] ? warnings : problems).push(msg); else log.info(msg);
  }

  const file = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      name: 'AMFI scheme master (NAVAll.txt)',
      url: NAVALL_URL,
      termsUrl: AMFI_TERMS_URL,
      licenceNote: 'Scheme master published by AMFI (amfiindia.com) for public information; SEBI categorisation per the section headers. ' +
        'Redistributed as a derived classification map with attribution. Regenerated monthly by CI; no runtime request is made.',
      structures: args['include-closed'] ? ['Open Ended', 'Close Ended', 'Interval Fund'] : ['Open Ended'],
    },
    categories: CATEGORIES,
    subCategories,
    taxClasses: TAX_CLASSES,
    isinCount: entries.size,
    groups: groupList,
    synthetic,
  };
  const json = stableJson(file);
  const raw = Buffer.byteLength(json);
  const gz = gzipSize(json);
  if (raw > RAW_BUDGET || gz > GZ_BUDGET) (args['allow-over-budget'] ? warnings : problems).push(`size ${fmtBytes(raw)} raw / ${fmtBytes(gz)} gz exceeds budget ${fmtBytes(RAW_BUDGET)} / ${fmtBytes(GZ_BUDGET)}`);

  // Report.
  const count = (pred) => [...entries.values()].filter(pred).length;
  console.log('');
  console.log(`  ISINs:            ${entries.size}  (${synthetic.length} synthetic overlay)`);
  console.log(`  skipped:          ${skippedStructure} rows not open-ended, ${skippedNoIsin} cells without ISIN`);
  console.log(`  by category:      ${CATEGORIES.map((c) => `${c} ${count((e) => e.category === c)}`).join(', ')}`);
  console.log(`  by taxClass:      ${TAX_CLASSES.map((c) => `${c} ${count((e) => e.taxClass === c)}`).join(', ')}`);
  console.log(`  ELSS ISINs:       ${count((e) => e.isElss)}`);
  console.log(`  sub-categories:   ${subCategories.length}   groups: ${groupList.length}`);
  console.log(`  size:             ${fmtBytes(raw)} raw, ${fmtBytes(gz)} gzipped   (budget ${fmtBytes(RAW_BUDGET)} / ${fmtBytes(GZ_BUDGET)})`);
  if (previous) console.log(`  bundled file:     ${previous.isinCount ?? '?'} ISINs, generated ${previous.generatedAt}`);
  console.log('');
  for (const w of warnings) log.warn(w);
  for (const p of problems) log.error(p);
  if (problems.length) { log.error(`${problems.length} validation problem(s); nothing written.`); return 2; }

  if (!args.apply) {
    log.plan(`would write ${args.out} (${fmtBytes(raw)}). Re-run with --apply to write it.`);
    return 0;
  }
  const abs = writeFileInRepo(args.out, json);
  log.info(`wrote ${abs}`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().then((code) => process.exit(code)).catch((e) => { log.error(e.message); process.exit(1); });
