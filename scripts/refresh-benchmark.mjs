#!/usr/bin/env node
// scripts/refresh-benchmark.mjs
//
// Downloads the benchmark index fund's NAV history from AMFI and writes src/data/benchmarkNav.json
// in the schema of 01-system-design.md §5.1 (plus the additive fields listed in 02-database-design.md).
//
//   node scripts/refresh-benchmark.mjs            # dry-run: fetch, validate, print counts and date range, write nothing
//   node scripts/refresh-benchmark.mjs --apply    # also write src/data/benchmarkNav.json
//
// Source: AMFI's own NAV history endpoint (the one behind the "NAV History" form on amfiindia.com).
// AMFI does have a history endpoint, so the mfapi.in mirror is NOT used, in CI or anywhere else.
//
// Benchmark (design A1): UTI Nifty 50 Index Fund - Direct Plan - Growth. AMFI scheme code 120716 and
// ISIN INF789F01XA0 are "to verify at first --apply run": this script was written without network
// access. It therefore fails loudly unless the scheme name AMFI returns for the code contains
// "NIFTY 50", "DIRECT" and "GROWTH" (case-insensitive), so a wrong code cannot silently produce a
// plausible-looking file.
//
// Safety: dry-run by default; writes only inside the repo; contacts only AMFI hosts; reads no PDFs.
// Requires Node >= 20 (global fetch). No npm dependencies.

import {
  REPO_ROOT, assertInsideRepo, parseArgs, printHelp, log, gzipSize, fmtBytes,
  writeFileInRepo, readJsonInRepoIfExists, stableJson, todayIso, isoToAmfi, amfiToIso,
  dayNumber, isoFromDayNumber,
} from './lib/cli.mjs';
import { amfiFetchText, parseAmfiTable, AmfiFormatError, NAV_HISTORY_URL, NAVALL_URL, AMFI_TERMS_URL } from './lib/amfi.mjs';

const SPEC = {
  apply:          { type: 'boolean', default: false, help: 'Write src/data/benchmarkNav.json (otherwise dry-run).' },
  'scheme-code':  { type: 'string',  default: '120716', help: 'AMFI scheme code of the benchmark plan (UTI Nifty 50 Index Fund - Direct Plan - Growth; to verify).' },
  'amc-code':     { type: 'string',  default: '28', help: 'AMFI "mf" code of the AMC for the history endpoint (28 = UTI Mutual Fund; to verify).' },
  from:           { type: 'string',  default: '2013-01-01', help: 'First date to request (direct plans start 1 Jan 2013).' },
  to:             { type: 'string',  default: '', help: 'Last date to request (default: today, UTC).' },
  'chunk-days':   { type: 'number',  default: 90, help: 'Days per history request; AMFI limits the span per request.' },
  out:            { type: 'string',  default: 'src/data/benchmarkNav.json', help: 'Output path, relative to the repo root.' },
  'max-day-change': { type: 'number', default: 0.20, help: 'Fail if |NAV change| day-on-day exceeds this fraction.' },
  'max-gap-days': { type: 'number',  default: 7, help: 'Fail if two consecutive NAV dates are further apart than this.' },
  'max-stale-days': { type: 'number', default: 7, help: 'Fail if the last NAV is older than this many days (relative to --to).' },
  'allow-gaps':   { type: 'boolean', default: false, help: 'Downgrade the gap check to a warning.' },
  'allow-stale':  { type: 'boolean', default: false, help: 'Downgrade the staleness check to a warning.' },
  'allow-over-budget': { type: 'boolean', default: false, help: 'Write even if the file exceeds the §7.2 size budget (70 KB raw / 35 KB gz).' },
  'skip-name-check': { type: 'boolean', default: false, help: 'DANGEROUS: skip the "Nifty 50 / Direct / Growth" scheme-name assertion.' },
  help:           { type: 'boolean', default: false, help: 'Show this help.' },
};

const RAW_BUDGET = 70 * 1024;
const GZ_BUDGET = 35 * 1024;

async function main() {
  const args = parseArgs(process.argv.slice(2), SPEC);
  if (args.help) { printHelp('refresh-benchmark.mjs', 'refresh the bundled benchmark NAV series from AMFI', SPEC); return 0; }
  const to = args.to || todayIso();
  const from = args.from;
  assertInsideRepo(args.out);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('--from/--to must be YYYY-MM-DD');

  log.info(`benchmark scheme code ${args['scheme-code']} (AMC mf=${args['amc-code']}), ${from} → ${to}, chunks of ${args['chunk-days']} days`);

  // 1. Fetch the history in chunks. AMFI's report endpoint caps the span per request; 90 days is safe.
  const byDate = new Map(); // iso -> { nav, name, isin }
  let schemeName = null;
  let isin = null;
  let requests = 0;
  let emptyWindows = 0;
  for (let start = dayNumber(from); start <= dayNumber(to); start += args['chunk-days']) {
    const end = Math.min(start + args['chunk-days'] - 1, dayNumber(to));
    const url = `${NAV_HISTORY_URL}?mf=${encodeURIComponent(args['amc-code'])}&tp=1&frmdt=${isoToAmfi(isoFromDayNumber(start))}&todt=${isoToAmfi(isoFromDayNumber(end))}`;
    const text = await amfiFetchText(url);
    requests++;
    if ((/no data|not available|no record/i.test(text.slice(0, 400)) && !text.includes(';')) || /^\s*<(!doctype|html|head)/i.test(text)) {
      // AMFI answers a window with no data (and windows before the history it keeps online) with a redirect to an HTML page.
      log.warn(`no rows for ${isoFromDayNumber(start)}..${isoFromDayNumber(end)} (AMFI returned no table)`);
      emptyWindows++;
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    let rows;
    try { ({ rows } = parseAmfiTable(text)); } catch (e) {
      if (!(e instanceof AmfiFormatError)) throw e;
      log.warn(`no rows for ${isoFromDayNumber(start)}..${isoFromDayNumber(end)} (${e.message})`);
      emptyWindows++;
      continue;
    }
    for (const r of rows) {
      if (r.schemeCode !== String(args['scheme-code'])) continue;
      const iso = amfiToIso(r.date);
      const nav = Number(String(r.nav).replace(/,/g, ''));
      if (!iso || !Number.isFinite(nav) || nav <= 0) continue;
      schemeName = r.schemeName || schemeName;
      const rowIsin = r.isinGrowthOrPayout && r.isinGrowthOrPayout !== '-' ? r.isinGrowthOrPayout : null;
      isin = rowIsin || isin;
      byDate.set(iso, nav);
    }
    await new Promise((r) => setTimeout(r, 400)); // be polite to AMFI
  }
  log.info(`${requests} history requests (${emptyWindows} without a table); ${byDate.size} NAV points for scheme ${args['scheme-code']}`);

  if (byDate.size === 0) {
    throw new Error(`AMFI returned no rows for scheme code ${args['scheme-code']} under AMC mf=${args['amc-code']}. ` +
      `Check both codes against ${NAVALL_URL} (the scheme code is the first column; the AMC code is the "mf" value the NAV History form posts).`);
  }

  // 2. Identity check: fail loudly if this is not a Nifty 50 direct growth plan.
  const nameUpper = (schemeName ?? '').toUpperCase().replace(/\s+/g, ' ');
  const nameOk = /NIFTY\s?50/.test(nameUpper) && /DIRECT/.test(nameUpper) && /GROWTH/.test(nameUpper);
  if (!nameOk && !args['skip-name-check']) {
    throw new Error(`Scheme ${args['scheme-code']} is named "${schemeName}" on AMFI, which does not contain all of "Nifty 50", "Direct" and "Growth". ` +
      `Refusing to write a benchmark file for it. Find the right code in ${NAVALL_URL} and pass --scheme-code.`);
  }
  if (!nameOk) log.warn(`scheme-name check SKIPPED by flag; AMFI name is "${schemeName}"`);
  if (!isin) throw new Error('AMFI rows carried no ISIN for the scheme; refusing to write a file without one.');
  log.info(`AMFI scheme name: "${schemeName}"  ISIN: ${isin}`);

  // 3. Build the columnar series and validate it.
  const dates = [...byDate.keys()].sort();
  const epoch = dates[0];
  const epochDay = dayNumber(epoch);
  const dayOffsets = dates.map((d) => dayNumber(d) - epochDay);
  const nav = dates.map((d) => Math.round(byDate.get(d) * 10000) / 10000);
  const problems = [];
  const warnings = [];
  let maxChange = 0, maxGap = 0, maxGapAt = null;
  for (let i = 1; i < dates.length; i++) {
    const change = Math.abs(nav[i] / nav[i - 1] - 1);
    if (change > maxChange) maxChange = change;
    if (change > args['max-day-change']) problems.push(`NAV jumps ${(change * 100).toFixed(1)}% between ${dates[i - 1]} and ${dates[i]}`);
    const gap = dayOffsets[i] - dayOffsets[i - 1];
    if (gap > maxGap) { maxGap = gap; maxGapAt = dates[i - 1]; }
    if (gap > args['max-gap-days']) (args['allow-gaps'] ? warnings : problems).push(`${gap}-day gap after ${dates[i - 1]}`);
  }
  const staleDays = dayNumber(to) - dayNumber(dates[dates.length - 1]);
  if (staleDays > args['max-stale-days']) (args['allow-stale'] ? warnings : problems).push(`last NAV ${dates[dates.length - 1]} is ${staleDays} days before ${to}`);
  if (dates[0] > from) warnings.push(`series starts ${dates[0]}, after the requested ${from} (expected for a plan launched later)`);

  const previous = readJsonInRepoIfExists(args.out);
  if (previous?.lastDate && previous.lastDate > dates[dates.length - 1]) problems.push(`new lastDate ${dates[dates.length - 1]} is earlier than the bundled ${previous.lastDate}`);
  if (previous?.nav?.length && previous.nav.length > nav.length) problems.push(`new series has ${nav.length} points, bundled has ${previous.nav.length}`);
  if (previous?.isin && previous.isin !== isin) problems.push(`ISIN changed from ${previous.isin} to ${isin}`);

  const file = {
    schemaVersion: 1,
    fundName: 'UTI Nifty 50 Index Fund - Direct Plan - Growth',
    schemeNameOnAmfi: schemeName,
    amfiCode: String(args['scheme-code']),
    amcCode: String(args['amc-code']),
    isin,
    source: {
      name: 'AMFI NAV history',
      url: 'https://www.amfiindia.com/net-asset-value/nav-history',
      endpoint: NAV_HISTORY_URL,
      termsUrl: AMFI_TERMS_URL,
      licenceNote: 'NAV data published by AMFI (amfiindia.com) for public information. Not NSE index data. ' +
        'Redistributed here as a derived, bundled series with attribution; see AMFI terms at the termsUrl. ' +
        'This file is regenerated monthly by CI; no runtime request is made.',
    },
    generatedAt: new Date().toISOString(),
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    epoch,
    points: dates.length,
    validation: {
      maxDayChangePct: Math.round(maxChange * 10000) / 100,
      maxGapDays: maxGap,
      maxGapAfter: maxGapAt,
      staleDaysAtGeneration: staleDays,
    },
    dayOffsets,
    nav,
  };
  const json = stableJson(file);
  const raw = Buffer.byteLength(json);
  const gz = gzipSize(json);
  const overBudget = raw > RAW_BUDGET || gz > GZ_BUDGET;
  if (overBudget) (args['allow-over-budget'] ? warnings : problems).push(`size ${fmtBytes(raw)} raw / ${fmtBytes(gz)} gz exceeds budget ${fmtBytes(RAW_BUDGET)} / ${fmtBytes(GZ_BUDGET)}`);

  // 4. Report.
  console.log('');
  console.log(`  rows (business days): ${dates.length}`);
  console.log(`  date range:           ${dates[0]} → ${dates[dates.length - 1]}  (requested ${from} → ${to})`);
  console.log(`  first / last NAV:     ${nav[0]} / ${nav[nav.length - 1]}`);
  console.log(`  max day change:       ${(maxChange * 100).toFixed(2)}%   max gap: ${maxGap} days (after ${maxGapAt})`);
  console.log(`  size:                 ${fmtBytes(raw)} raw, ${fmtBytes(gz)} gzipped   (budget ${fmtBytes(RAW_BUDGET)} / ${fmtBytes(GZ_BUDGET)})`);
  if (previous) console.log(`  bundled file:         ${previous.points ?? previous.nav?.length} points, lastDate ${previous.lastDate}`);
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

main().then((code) => process.exit(code)).catch((e) => { log.error(e.message); process.exit(1); });
