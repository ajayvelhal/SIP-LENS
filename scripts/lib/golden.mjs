// scripts/lib/golden.mjs
// Builds the golden JSON for a fixture: the ParseResult the parser must produce (minus parsedAt) and the
// invariants the calculation engine must reproduce (per-fund closing units, investor cashflows, reference
// XIRR, discipline counts, FIFO tax lots). Pure; no I/O.
//
// The ParseResult projection follows 01-system-design.md §4.1 field by field. Where the design leaves a
// convention open, the choice is recorded in 02-database-design.md ("Pinned conventions") and here.

import { createHash } from 'node:crypto';
import { round, addMonths, addDays, rollForward } from './synthetic.mjs';
import { dayNumber } from './cli.mjs';
import { sipSchedule, GENERATOR_VERSION } from './fixtures-spec.mjs';

export const GOLDEN_VERSION = 1;
export const UI_KEY = (code) => `ui.error.${code}`; // ParseError.message is a fixed UI key; the comparison ignores it.

const FLAG_CODES = new Set(['UNCLASSIFIED_ROW', 'UNIT_MISMATCH', 'NO_CLOSING_BALANCE', 'ORPHAN_REVERSAL', 'FUTURE_DATED_ROW', 'COLUMN_DRIFT', 'PAGE_EXTRACT_FAILED']);
const EXCLUDED_KINDS = new Set(['segregated', 'unit_adjustment', 'unknown']);

export function normaliseSchemeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function maskDigits(s) {
  return s.replace(/\d/g, '#');
}

const warnId = (code, fundId, page, rowIndex) => `${code}:${fundId ?? '-'}:${page ?? '-'}:${rowIndex ?? '-'}`;

// ---------------------------------------------------------------- ParseResult projection

/**
 * @param expanded  expandFixture() output
 * @param layout    layoutCas() output (rowPage, sectionPage, pageCount, lineCount)
 */
export function buildParseResult(expanded, layout) {
  const fx = expanded.fixture;
  const dp = expanded.dp;
  const tolInt = 2; // design A2: 2 units of the printed precision
  const asOf = fx.period.to;
  const funds = [];
  const fundById = new Map();
  const warnings = [];
  let transactionsTotal = 0, unclassified = 0, folioCount = 0;

  for (const f of expanded.folios) {
    for (const h of f.holdings) {
      const isin = h.scheme.isin ?? undefined;
      const fundId = isin ?? `name:${normaliseSchemeName(h.printedName)}|${f.folioNumber}`;
      let fund = fundById.get(fundId);
      if (!fund) {
        fund = { id: fundId, isin, amfiCode: undefined, schemeName: h.printedName, amc: h.scheme.amc, folios: [], closingUnits: 0, closingNav: undefined, closingValue: undefined, mayBeIncomplete: false, alsoPrintedAs: undefined, _flagged: false };
        fundById.set(fundId, fund);
        funds.push(fund);
      } else if (fund.schemeName !== h.printedName) {
        fund.alsoPrintedAs = [...new Set([...(fund.alsoPrintedAs ?? []), h.printedName])];
      }
      if (!isin) warnings.push({ id: warnId('MISSING_ISIN', fundId, layout.sectionPage.get(h)), code: 'MISSING_ISIN', fundId, folioNumber: f.folioNumber, schemeName: h.printedName, page: layout.sectionPage.get(h), severity: 'info' });
      if (h.duplicate) warnings.push({ id: warnId('DUPLICATE_SECTION', fundId, h.duplicatePage), code: 'DUPLICATE_SECTION', fundId, folioNumber: f.folioNumber, schemeName: h.printedName, page: h.duplicatePage, severity: 'info' });

      const printed = h.rows.filter((r) => !r.hidden);
      const txs = [];
      const idOf = (i) => `${fundId}:${f.folioNumber}:${i}`;
      printed.forEach((row, i) => {
        const tx = {
          id: idOf(i), rta: f.rta, folioNumber: f.folioNumber, schemeName: h.printedName, isin, amfiCode: undefined,
          date: row.date, description: row.description, kind: row.kind,
          amount: row.amountPaise === undefined ? undefined : row.amountPaise / 100,
          units: row.unitsInt === undefined ? undefined : row.unitsInt / 10 ** dp,
          nav: row.nav,
          unitBalance: row.printBalance && row.balanceInt !== undefined ? row.balanceInt / 10 ** dp : undefined,
          page: layout.rowPage.get(row),
          attachedTo: undefined, levies: undefined, reverses: undefined, reversedBy: undefined,
          excludedFromCashflows: EXCLUDED_KINDS.has(row.kind),
        };
        txs.push(tx);
      });
      // Attachments and reversal pairs (indices in `printed` are indices in `txs` because hidden rows are not printed).
      printed.forEach((row, i) => {
        if (row.attachTo !== undefined) {
          const parentIdx = printed.indexOf(h.rows[row.attachTo]);
          txs[i].attachedTo = idOf(parentIdx);
          (txs[parentIdx].levies ??= []).push(idOf(i));
        }
        if (row.reverses !== undefined) {
          const origIdx = printed.indexOf(h.rows[row.reverses]);
          txs[i].reverses = idOf(origIdx);
          txs[origIdx].reversedBy = idOf(i);
          txs[i].excludedFromCashflows = true;
          txs[origIdx].excludedFromCashflows = true;
        }
        if (row.orphanReversal) { txs[i].excludedFromCashflows = true; }
      });
      // Warnings per row
      printed.forEach((row, i) => {
        const page = layout.rowPage.get(row);
        if (row.kind === 'unknown') { unclassified++; warnings.push({ id: warnId('UNCLASSIFIED_ROW', fundId, page, i), code: 'UNCLASSIFIED_ROW', fundId, folioNumber: f.folioNumber, schemeName: h.printedName, page, rowIndex: i, maskedRowText: maskDigits(row.description), severity: 'flag' }); }
        if (row.orphanLevy) warnings.push({ id: warnId('ORPHAN_LEVY', fundId, page, i), code: 'ORPHAN_LEVY', fundId, folioNumber: f.folioNumber, schemeName: h.printedName, page, rowIndex: i, maskedRowText: maskDigits(row.description), severity: 'info' });
        if (row.orphanReversal) warnings.push({ id: warnId('ORPHAN_REVERSAL', fundId, page, i), code: 'ORPHAN_REVERSAL', fundId, folioNumber: f.folioNumber, schemeName: h.printedName, page, rowIndex: i, maskedRowText: maskDigits(row.description), severity: 'flag' });
        if (row.date > asOf) warnings.push({ id: warnId('FUTURE_DATED_ROW', fundId, page, i), code: 'FUTURE_DATED_ROW', fundId, folioNumber: f.folioNumber, schemeName: h.printedName, page, rowIndex: i, maskedRowText: maskDigits(row.description), severity: 'flag' });
      });
      // Reconciliation (design §3.4 steps 4-5) over printed rows only.
      let prev = h.openingInt, firstMismatchRow;
      printed.forEach((row, i) => {
        if (!row.printBalance || row.balanceInt === undefined) return;
        const expected = prev + (row.unitsInt ?? 0);
        if (firstMismatchRow === undefined && Math.abs(row.balanceInt - expected) > tolInt) firstMismatchRow = i;
        prev = row.balanceInt;
      });
      const computedInt = h.openingInt + printed.reduce((a, r) => a + (r.unitsInt ?? 0), 0);
      const reconciliation = {
        status: 'ok', computedClosingUnits: computedInt / 10 ** dp, printedClosingUnits: undefined, diff: undefined, firstMismatchRow,
        toleranceUnits: tolInt / 10 ** dp, decimals: dp,
      };
      if (h.noClosing) {
        reconciliation.status = 'no-closing-balance';
        warnings.push({ id: warnId('NO_CLOSING_BALANCE', fundId, h.lastRowPage), code: 'NO_CLOSING_BALANCE', fundId, folioNumber: f.folioNumber, schemeName: h.printedName, page: h.lastRowPage, severity: 'flag' });
      } else {
        reconciliation.printedClosingUnits = h.closingInt / 10 ** dp;
        reconciliation.diff = (computedInt - h.closingInt) / 10 ** dp;
        if (firstMismatchRow !== undefined || Math.abs(computedInt - h.closingInt) > tolInt) {
          reconciliation.status = 'mismatch';
          const page = firstMismatchRow !== undefined ? layout.rowPage.get(printed[firstMismatchRow]) : h.closingPage;
          warnings.push({ id: warnId('UNIT_MISMATCH', fundId, page, firstMismatchRow), code: 'UNIT_MISMATCH', fundId, folioNumber: f.folioNumber, schemeName: h.printedName, page, rowIndex: firstMismatchRow, severity: 'flag' });
        }
      }
      const folio = {
        folioNumber: f.folioNumber, rta: f.rta, openingUnits: h.openingInt / 10 ** dp,
        closingUnits: h.noClosing ? undefined : h.closingInt / 10 ** dp,
        closingNav: h.noClosing ? undefined : h.closingNav,
        closingValue: h.noClosing ? undefined : h.closingValuePaise / 100,
        // Design §4.1 / P10: the printed valuation date is carried only when it differs from the statement date,
        // which happens on the E54 path (no period line: statementDate falls back to the latest transaction date).
        valuationDate: undefined, transactions: txs, reconciliation,
      };
      if (!h.noClosing && fx.omitPeriodLine) {
        const latestTx = h.rows.filter((r) => !r.hidden).map((r) => r.date).sort().pop();
        const docLatest = expanded.folios.flatMap((ff) => ff.holdings.flatMap((hh) => hh.rows.filter((r) => !r.hidden).map((r) => r.date))).sort().pop();
        if (latestTx !== undefined && fx.period.to !== docLatest) folio.valuationDate = fx.period.to;
      }
      fund.folios.push(folio);
      folioCount++;
      transactionsTotal += txs.length;
      if (!h.noClosing) {
        fund.closingUnits = round(fund.closingUnits + folio.closingUnits, dp);
        fund.closingNav = h.closingNav;
        fund.closingValue = round((fund.closingValue ?? 0) + folio.closingValue, 2);
      }
      fund._hasOpening = fund._hasOpening || h.openingInt > 0;
    }
  }
  for (const fund of funds) {
    const flagged = warnings.some((w) => w.fundId === fund.id && w.severity === 'flag');
    const recNotOk = fund.folios.some((fo) => fo.reconciliation.status !== 'ok');
    fund.mayBeIncomplete = flagged || recNotOk;
  }
  if (expanded.investors.length > 1) warnings.push({ id: warnId('MULTI_PAN', undefined, 1), code: 'MULTI_PAN', page: 1, severity: 'info' });
  let statementDate = asOf;
  let statementPeriod = { from: fx.period.from, to: fx.period.to };
  if (fx.omitPeriodLine) {
    const latest = funds.flatMap((fu) => fu.folios.flatMap((fo) => fo.transactions.map((t) => t.date))).sort().pop();
    statementDate = latest;
    statementPeriod = { from: latest, to: latest }; // pinned convention: period collapses to the fallback date
    warnings.push({ id: warnId('MISSING_STATEMENT_DATE', undefined, 1), code: 'MISSING_STATEMENT_DATE', page: 1, severity: 'info' });
  }
  warnings.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.rowIndex ?? -1) - (b.rowIndex ?? -1) || a.id.localeCompare(b.id));

  const worst = { ok: 0, 'no-closing-balance': 1, mismatch: 2 };
  const reconciliation = {};
  for (const fund of funds) reconciliation[fund.id] = fund.folios.map((fo) => fo.reconciliation.status).sort((a, b) => worst[b] - worst[a])[0];

  const portfolio = {
    schemaVersion: 1,
    issuer: fx.issuer,
    statementDate,
    statementPeriod,
    casGeneratedOn: undefined,
    // parsedAt is omitted from goldens by definition (design §5.5)
    investorName: 'LENS SAMPLE INVESTOR',
    investorCount: expanded.investors.length,
    funds: funds.map(({ _flagged, _hasOpening, ...rest }) => rest),
    pageCount: layout.pageCount,
    unitDecimals: dp,
  };
  const result = {
    portfolio,
    warnings,
    reconciliation,
    stats: { pages: layout.pageCount, rows: layout.lineCount, transactions: transactionsTotal, unclassified, folios: folioCount, funds: funds.length, extractMs: 0, parseMs: 0 },
  };
  return { result, fundsInternal: funds };
}

// ---------------------------------------------------------------- reference XIRR (design §4.5, spreadsheet semantics)

export const BRACKET_GRID = [-0.9999, -0.99, -0.95, -0.9, -0.75, -0.5, -0.25, -0.1, 0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 50, 100];

export function xirr(flows) {
  const nz = flows.filter((f) => f.amount !== 0);
  if (nz.length < 2) return { status: 'insufficient', reason: 'fewer-than-two' };
  const dates = new Set(nz.map((f) => f.date));
  if (dates.size < 2) return { status: 'insufficient', reason: 'same-day' };
  if (nz.every((f) => f.amount > 0) || nz.every((f) => f.amount < 0)) return { status: 'insufficient', reason: 'same-sign' };
  const d0 = Math.min(...nz.map((f) => dayNumber(f.date)));
  const t = nz.map((f) => (dayNumber(f.date) - d0) / 365);
  const a = nz.map((f) => f.amount);
  const npv = (r) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * Math.exp(-t[i] * Math.log1p(r)); return s; };
  const dnpv = (r) => { let s = 0; for (let i = 0; i < a.length; i++) s += -t[i] * a[i] * Math.exp(-(t[i] + 1) * Math.log1p(r)); return s; };
  const brackets = [];
  let prevR = BRACKET_GRID[0], prevF = npv(prevR);
  for (let i = 1; i < BRACKET_GRID.length; i++) {
    const r = BRACKET_GRID[i], fv = npv(r);
    if (prevF === 0) brackets.push([prevR, prevR]);
    else if (Math.sign(prevF) !== Math.sign(fv)) brackets.push([prevR, r]);
    prevR = r; prevF = fv;
  }
  if (!brackets.length) return { status: 'no-convergence', reason: 'no-bracket' };
  const roots = [];
  for (let [lo, hi] of brackets) {
    if (lo === hi) { roots.push({ rate: lo, method: 'newton', iterations: 0 }); continue; }
    let r = (lo + hi) / 2, method = 'newton', it = 0, ok = false;
    for (; it < 50; it++) {
      const f = npv(r), d = dnpv(r);
      if (!Number.isFinite(d) || d === 0) break;
      const nr = r - f / d;
      if (nr <= lo || nr >= hi || !Number.isFinite(nr)) break;
      if (Math.abs(nr - r) < 1e-10) { r = nr; ok = true; break; }
      r = nr;
    }
    if (!ok) {
      method = 'bisection';
      let flo = npv(lo);
      for (it = 0; it < 200 && hi - lo > 1e-10; it++) {
        const mid = (lo + hi) / 2, fm = npv(mid);
        if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
      }
      r = (lo + hi) / 2;
    }
    if (!roots.some((x) => Math.abs(x.rate - r) < 1e-6)) roots.push({ rate: r, method, iterations: it });
  }
  roots.sort((x, y) => Math.abs(x.rate) - Math.abs(y.rate));
  const best = roots[0];
  return { status: 'ok', rate: best.rate, iterations: best.iterations, method: best.method, warning: roots.length > 1 ? 'multiple-roots' : undefined };
}

// ---------------------------------------------------------------- cashflows (design §4.3 mapping) and invariants

function fundCashflows(fund, asOf) {
  const flows = [];
  const ignored = [];
  const byId = new Map();
  for (const fo of fund.folios) for (const tx of fo.transactions) byId.set(tx.id, tx);
  for (const fo of fund.folios) {
    for (const tx of fo.transactions) {
      if (tx.date > asOf) { ignored.push({ transactionId: tx.id, reason: 'future_dated' }); continue; }
      if (tx.excludedFromCashflows) { ignored.push({ transactionId: tx.id, reason: tx.reverses ? 'reversal' : tx.reversedBy ? 'reversed' : tx.kind }); continue; }
      const levies = (tx.levies ?? []).map((id) => byId.get(id));
      const stamp = levies.filter((l) => l.kind === 'stamp_duty').reduce((a, l) => a + l.amount, 0);
      const stt = levies.filter((l) => l.kind === 'stt_tds').reduce((a, l) => a + l.amount, 0);
      switch (tx.kind) {
        case 'purchase': case 'sip': case 'switch_in':
          flows.push({ date: tx.date, amount: -round(Math.abs(tx.amount) + stamp, 2), fundId: fund.id, transactionIds: [tx.id, ...(tx.levies ?? [])], kind: 'outflow', label: tx.kind === 'switch_in' ? 'Switch in' : tx.kind === 'sip' ? 'SIP' : 'Purchase' + (stamp ? ' + stamp duty' : '') });
          break;
        case 'redemption': case 'switch_out':
          flows.push({ date: tx.date, amount: round(Math.abs(tx.amount) - stt, 2), fundId: fund.id, transactionIds: [tx.id, ...(tx.levies ?? [])], kind: 'inflow', label: tx.kind === 'switch_out' ? 'Switch out' : 'Redemption' + (stt ? ' − STT' : '') });
          break;
        case 'dividend_payout':
          flows.push({ date: tx.date, amount: round(tx.amount, 2), fundId: fund.id, transactionIds: [tx.id], kind: 'inflow', label: 'IDCW payout' });
          break;
        case 'dividend_reinvest':
          ignored.push({ transactionId: tx.id, reason: 'dividend_reinvest' });
          break;
        case 'stamp_duty': case 'stt_tds':
          if (!tx.attachedTo) flows.push({ date: tx.date, amount: -round(tx.amount, 2), fundId: fund.id, transactionIds: [tx.id], kind: 'outflow', label: tx.kind === 'stamp_duty' ? 'Stamp duty (no parent row)' : 'STT (no parent row)' });
          break;
        default:
          ignored.push({ transactionId: tx.id, reason: tx.kind });
      }
    }
  }
  flows.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'outflow' ? 0 : 1) - (b.kind === 'outflow' ? 0 : 1));
  let terminal;
  if (fund.closingUnits > 0 && fund.closingNav !== undefined) terminal = { date: asOf, amount: round(fund.closingUnits * fund.closingNav, 2), fundId: fund.id, transactionIds: [], kind: 'terminal', label: 'Value as of statement date' };
  const invested = round(flows.filter((f) => f.amount < 0).reduce((a, f) => a - f.amount, 0), 2);
  const redeemed = round(flows.filter((f) => f.amount > 0).reduce((a, f) => a + f.amount, 0), 2);
  return { flows, ignored, terminal, totals: { invested, redeemed, terminalValue: terminal?.amount ?? 0 } };
}

const pct4 = (rate) => round(rate * 100, 4);

/** Discipline pins per SIP event (design §4.6 / Q4 / A18 as read in 02-database-design.md). */
function disciplinePins(expanded, fundOfHolding) {
  const asOf = expanded.fixture.period.to;
  const pins = [];
  for (const f of expanded.folios) for (const h of f.holdings) for (const rec of h.sips) {
    if (rec.ev.pin === false) continue;
    const ev = rec.ev;
    // expected dates: the SIP's own schedule extended to asOf
    const extended = sipSchedule({ ...ev, to: ev.freq === 'weekly' ? asOf : asOf.slice(0, 7) }).filter((d) => d <= asOf);
    const madeSet = new Set(rec.made);
    const lastObserved = rec.made.length ? rollForward(rec.made[rec.made.length - 1]) : undefined;
    const gapLimit = ev.freq === 'weekly' ? addDays(lastObserved, 14) : ev.freq === 'quarterly' ? addMonths(lastObserved, 6) : addMonths(lastObserved, 2);
    const stopped = lastObserved && gapLimit < asOf;
    const stoppedSince = stopped ? extended.find((d) => d > rec.made[rec.made.length - 1]) : undefined;
    const counts = { expected: 0, made: 0, missed: 0, stopped: 0 };
    let madeAmt = 0, expAmt = 0;
    const amountAt = (nominal) => { let a = ev.amount; for (const su of ev.stepUps) if (nominal.slice(0, 7) >= su.from) a = su.amount; return a; };
    for (const d of extended) {
      counts.expected++;
      const amt = amountAt(d);
      if (madeSet.has(d)) { counts.made++; madeAmt += amt; expAmt += amt; }
      else if (stopped && d >= stoppedSince) counts.stopped++;
      else { counts.missed++; expAmt += amt; }
    }
    const amounts = [{ from: rollForward(extended[0]), amount: ev.amount }, ...ev.stepUps.map((su) => ({ from: rollForward(extended.find((d) => d.slice(0, 7) >= su.from)), amount: su.amount }))];
    pins.push({ fundId: fundOfHolding.get(h).id, folioNumber: f.folioNumber, frequency: ev.freq, amounts, firstDate: rollForward(rec.made[0] ?? extended[0]), lastObserved, counts, percent: expAmt ? Math.round((100 * madeAmt) / expAmt) : 0, stoppedSince, _madeAmt: madeAmt, _expAmt: expAmt });
  }
  const totMade = pins.reduce((a, p) => a + p._madeAmt, 0), totExp = pins.reduce((a, p) => a + p._expAmt, 0);
  const score = pins.length ? Math.round((100 * totMade) / totExp) : null;
  return { score, sips: pins.map(({ _madeAmt, _expAmt, ...p }) => p) };
}

/** FIFO lots and holding-term classification (design §4.8) for funds of fixtures that set pinTax. */
function taxPins(fund, scheme, asOf) {
  const byId = new Map();
  for (const fo of fund.folios) for (const tx of fo.transactions) byId.set(tx.id, tx);
  const txs = fund.folios.flatMap((fo) => fo.transactions).filter((t) => !t.excludedFromCashflows && t.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
  let lots = [];
  for (const tx of txs) {
    if (['purchase', 'sip', 'switch_in', 'dividend_reinvest'].includes(tx.kind) && tx.units > 0) {
      const stamp = (tx.levies ?? []).map((id) => byId.get(id)).filter((l) => l.kind === 'stamp_duty').reduce((a, l) => a + l.amount, 0);
      lots.push({ acquiredOn: tx.date, units: tx.units, nav: tx.nav, costPerUnit: round((tx.amount + stamp) / tx.units, 6), source: tx.kind, sourceTransactionId: tx.id });
    } else if ((tx.kind === 'redemption' || tx.kind === 'switch_out') && tx.units < 0) {
      let left = -tx.units;
      while (left > 1e-9 && lots.length) {
        const lot = lots[0];
        const take = Math.min(lot.units, left);
        lot.units = round(lot.units - take, 4);
        left = round(left - take, 4);
        if (lot.units <= 0) lots.shift();
      }
    }
  }
  const ltLine = (d) => addMonths(d, 12);
  const unlock = (d) => addMonths(d, 36);
  return lots.map((lot) => {
    let term = asOf > ltLine(lot.acquiredOn) ? 'long' : 'short';
    let unlockOn;
    if (scheme.elss && asOf < unlock(lot.acquiredOn)) { term = 'locked'; unlockOn = unlock(lot.acquiredOn); }
    return { acquiredOn: lot.acquiredOn, units: lot.units, costPerUnit: lot.costPerUnit, source: lot.source, term, unlockOn, gain: round((fund.closingNav - lot.costPerUnit) * lot.units, 2) };
  });
}

/**
 * Digest mode for very large fixtures: each folio's transactions are replaced by their count and a SHA-256
 * over the canonical tuple of every transaction. The test harness applies the same function to the
 * parser's ParseResult before comparing. Canonical tuple = [date, kind, amount, units, nav, unitBalance,
 * description, page, attachedTo?, reverses?] joined by '\u001f', one transaction per line.
 */
export function digestResult(result) {
  const out = structuredClone(result);
  for (const fund of out.portfolio.funds) {
    for (const folio of fund.folios) {
      const h = createHash('sha256');
      for (const t of folio.transactions) {
        h.update([t.date, t.kind, t.amount ?? '', t.units ?? '', t.nav ?? '', t.unitBalance ?? '', t.description, t.page, t.attachedTo ?? '', t.reverses ?? ''].join('\u001f') + '\n');
      }
      folio.transactions = { count: folio.transactions.length, sha256: h.digest('hex') };
    }
  }
  out.digest = { algorithm: 'sha256', canonical: 'date\u001fkind\u001famount\u001funits\u001fnav\u001funitBalance\u001fdescription\u001fpage\u001fattachedTo\u001freverses, one line per transaction' };
  return out;
}

/** Builds the whole golden file for a fixture. */
export function buildGolden(expanded, layout) {
  const fx = expanded.fixture;
  const base = { goldenVersion: GOLDEN_VERSION, fixture: `${fx.name}.pdf`, generator: { script: 'scripts/gen-fixtures.mjs', version: GENERATOR_VERSION }, stories: fx.stories, edges: fx.edges, notes: fx.notes };
  if (fx.expect !== 'result') {
    const error = { code: fx.expect, message: UI_KEY(fx.expect) };
    if (fx.expect === 'SUMMARY_CAS') {
      error.issuer = fx.issuer;
      error.schemeNames = expanded.folios.flatMap((f) => f.holdings.map((h) => h.printedName));
      error.statementDate = fx.period.to;
    }
    if (fx.expect === 'DEPOSITORY_CAS') error.depository = fx.depository;
    return { ...base, expect: 'error', error };
  }
  const { result, fundsInternal } = buildParseResult(expanded, layout);
  const asOf = result.portfolio.statementDate;
  const fundOfHolding = new Map();
  for (const f of expanded.folios) for (const h of f.holdings) fundOfHolding.set(h, fundsInternal.find((fu) => fu.folios.some((fo) => fo.folioNumber === f.folioNumber && fo.transactions.some((t) => t.schemeName === h.printedName)) || fu.schemeName === h.printedName || (fu.alsoPrintedAs ?? []).includes(h.printedName)));

  const perFund = {};
  const pooled = [];
  let pooledTerminal = 0;
  const skipped = [];
  for (const fund of fundsInternal) {
    const cf = fundCashflows(fund, asOf);
    const openingWithoutHistory = fund.folios.some((fo) => fo.openingUnits > 0);
    let x;
    if (openingWithoutHistory) x = { status: 'insufficient', reason: 'opening-balance-without-history' };
    else x = xirr([...cf.flows, ...(cf.terminal ? [cf.terminal] : [])].map((f) => ({ date: f.date, amount: f.amount })));
    perFund[fund.id] = {
      schemeName: fund.schemeName,
      closingUnits: fund.closingUnits, closingNav: fund.closingNav, closingValue: fund.closingValue,
      mayBeIncomplete: fund.mayBeIncomplete, openingWithoutHistory,
      invested: cf.totals.invested, redeemed: cf.totals.redeemed, netInvested: round(cf.totals.invested - cf.totals.redeemed, 2), terminalValue: cf.totals.terminalValue,
      cashflowCount: cf.flows.length, ignoredCount: cf.ignored.length,
      cashflows: cf.flows.length <= 80 ? [...cf.flows, ...(cf.terminal ? [cf.terminal] : [])].map((f) => ({ date: f.date, amount: f.amount, label: f.label })) : undefined,
      ignored: cf.ignored.length <= 40 ? cf.ignored : undefined,
      xirr: x.status === 'ok' ? { status: 'ok', ratePct4dp: pct4(x.rate), method: x.method, warning: x.warning } : x,
    };
    if (fund.mayBeIncomplete) skipped.push({ fundId: fund.id, reason: 'may-be-incomplete' });
    else if (openingWithoutHistory) skipped.push({ fundId: fund.id, reason: 'opening-balance-without-history' });
    else { pooled.push(...cf.flows); pooledTerminal = round(pooledTerminal + (cf.terminal?.amount ?? 0), 2); }
  }
  pooled.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'outflow' ? 0 : 1) - (b.kind === 'outflow' ? 0 : 1));
  const pooledX = xirr([...pooled, ...(pooledTerminal > 0 ? [{ date: asOf, amount: pooledTerminal }] : [])].map((f) => ({ date: f.date, amount: f.amount })));
  const portfolioInv = {
    asOf,
    totalInvested: round(pooled.filter((f) => f.amount < 0).reduce((a, f) => a - f.amount, 0), 2),
    totalRedeemed: round(pooled.filter((f) => f.amount > 0).reduce((a, f) => a + f.amount, 0), 2),
    valueAsOfStatementDate: round(fundsInternal.filter((f) => f.closingValue !== undefined).reduce((a, f) => a + f.closingValue, 0), 2),
    fundsWithoutPrintedValue: fundsInternal.filter((f) => f.closingValue === undefined).length,
    terminalValue: pooledTerminal,
    skippedFunds: skipped,
    xirr: pooledX.status === 'ok' ? { status: 'ok', ratePct4dp: pct4(pooledX.rate), method: pooledX.method, warning: pooledX.warning } : pooledX,
  };
  const invariants = { portfolio: portfolioInv, funds: perFund, discipline: disciplinePins(expanded, fundOfHolding) };
  if (fx.pinTax) {
    invariants.taxLots = {};
    for (const f of expanded.folios) for (const h of f.holdings) {
      const fund = fundOfHolding.get(h);
      if (fund && !invariants.taxLots[fund.id]) invariants.taxLots[fund.id] = { taxClass: h.scheme.tax, isElss: h.scheme.elss, lots: taxPins(fund, h.scheme, asOf) };
    }
  }
  if (fx.digest) {
    for (const f of Object.values(invariants.funds)) { delete f.cashflows; delete f.ignored; }
    return { ...base, expect: 'result', digest: true, result: digestResult(result), invariants };
  }
  return { ...base, expect: 'result', result, invariants };
}
