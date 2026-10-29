// scripts/lib/fixtures-spec.mjs
// Declarative definitions of every synthetic fixture and the engine that expands them into printed rows.
// Pure: no I/O, no wall clock, no dependencies beyond ./synthetic.mjs and ./cli.mjs.
//
// A fixture is a document description (issuer, period, investors, folios, holdings, events). expandFixture()
// turns the events of each holding into the exact rows a CAMS/KFintech detailed CAS would print, with
// running unit balances, stamp duty / STT levy rows, switch counterparts, reversals and the deliberate
// defects that exercise the edge-case register (hidden rows, orphan levies, unknown descriptions, ...).
//
// Money and units are carried as integers (paise, units x 10^dp) so running balances are exact.

import { SCHEMES, INVESTORS, navOn, round, rollForward, addDays, addMonths, isBusinessDay, folioNumber, maskedPan, fmtDate } from './synthetic.mjs';
import { dayNumber } from './cli.mjs';

export const STAMP_DUTY_FROM = '2020-07-01';   // 0.005% on purchases, switch-ins and reinvestments
export const STAMP_DUTY_RATE = 0.00005;
export const STT_RATE = 0.00001;               // 0.001% on equity redemptions / switch-outs
export const GENERATOR_VERSION = '1.0.0';

// ---------------------------------------------------------------- description vocab per RTA style

const VOCAB = {
  cams: {
    sip: (n) => `Systematic Investment (${n})`,
    purchase: (i) => ['Purchase - via myCAMS', 'Purchase-BSE', 'Purchase - via Online'][i % 3],
    redeem: () => 'Redemption - via Online',
    swp: () => 'Systematic Withdrawal (1)',
    switchOut: (to) => `Switch Out - To ${to}`,
    switchIn: (from) => `Switch In - From ${from}`,
    stpOut: (to) => `STP Out - To ${to}`,
    stpIn: (from) => `STP In - From ${from}`,
    stamp: () => '*** Stamp Duty ***',
    stt: () => '*** STT Paid ***',
    payout: (old) => (old ? 'Dividend Paid' : 'IDCW Payout'),
    reinvest: (old) => (old ? 'Dividend Reinvested' : 'IDCW Reinvestment'),
    bareIdcw: () => 'IDCW',
    reversal: (orig) => `${orig} - Reversal`,
    rejected: () => 'Purchase - Rejected (Cheque Dishonoured)',
    segregated: () => 'Creation of Units - Segregated Portfolio 1',
    bonus: () => 'Bonus Units Allotted',
    unknown: () => 'Lien Marked - Loan Against Units',
  },
  kfin: {
    sip: (n) => `Purchase - Systematic (Instalment ${n})`,
    purchase: (i) => ['Purchase - Online', 'Purchase - via Distributor', 'Additional Purchase - Online'][i % 3],
    redeem: () => 'Redemption - Online',
    swp: () => 'Systematic Withdrawal - Online',
    switchOut: (to) => `Switch-Out To ${to}`,
    switchIn: (from) => `Switch-In From ${from}`,
    stpOut: (to) => `STP Out - To ${to}`,
    stpIn: (from) => `STP In - From ${from}`,
    stamp: () => '*** Stamp Duty ***',
    stt: () => '*** STT Paid ***',
    payout: (old) => (old ? 'Dividend Payout' : 'IDCW Payout'),
    reinvest: (old) => (old ? 'Dividend Reinvestment' : 'IDCW Reinvestment'),
    bareIdcw: () => 'IDCW',
    reversal: (orig) => `${orig} - Reversed`,
    rejected: () => 'Purchase Rejected - Payment Failure',
    segregated: () => 'Segregated Portfolio - Units Credited',
    bonus: () => 'Bonus Units Allotted',
    unknown: () => 'Lien Marked - Loan Against Units',
  },
};

// ---------------------------------------------------------------- event helpers (used by the fixture table)

/** Monthly/weekly/quarterly SIP. skip: ['YYYY-MM' | 'YYYY-MM-DD'] nominal dates to miss; stepUps: [{ from:'YYYY-MM', amount }]. */
const sip = (amount, from, to, opts = {}) => ({ type: 'sip', amount, from, to, day: opts.day ?? 10, freq: opts.freq ?? 'monthly', skip: opts.skip ?? [], stepUps: opts.stepUps ?? [], reversed: opts.reversed ?? [], pin: opts.pin ?? true, weekday: opts.weekday });
const buy = (date, amount, opts = {}) => ({ type: 'purchase', date, amount, ...opts });
const redeem = (date, units = 'all', opts = {}) => ({ type: 'redeem', date, units, ...opts });
const swp = (date, units) => ({ type: 'redeem', date, units, swp: true });
const switchOut = (date, units, to, opts = {}) => ({ type: 'switchOut', date, units, to, ...opts });
const stp = (from, to, months, amount, target) => ({ type: 'stp', from, to, months, amount, target });
const payout = (date, perUnit, opts = {}) => ({ type: 'payout', date, perUnit, ...opts });
const reinvest = (date, perUnit, opts = {}) => ({ type: 'reinvest', date, perUnit, ...opts });
const bareIdcw = (date, perUnit, withUnits) => ({ type: 'bareIdcw', date, perUnit, withUnits });
const reversedBuy = (date, amount, opts = {}) => ({ type: 'reversedBuy', date, amount, ...opts });
const orphanReversal = (date, amount, units) => ({ type: 'orphanReversal', date, amount, units });
const orphanStamp = (date, amount) => ({ type: 'orphanStamp', date, amount });
const segregated = (date, units) => ({ type: 'segregated', date, units });
const bonus = (date, ratio) => ({ type: 'bonus', date, ratio });
const unknownRow = (date) => ({ type: 'unknown', date });
const hiddenBuy = (date, amount) => ({ type: 'purchase', date, amount, hidden: true });
const futureBuy = (date, amount) => ({ type: 'purchase', date, amount, future: true });
const opening = (units) => ({ type: 'opening', units });

const H = (scheme, events, opts = {}) => ({ scheme, events, ...opts });
const F = (label, rta, holdings, opts = {}) => ({ label, rta, investor: opts.investor ?? 'primary', holdings, ...opts });

// ---------------------------------------------------------------- the corpus

/**
 * Every fixture. `kind` decides the writer: 'detailed' | 'summary' | 'depository' | 'not-cas' | 'cams-letter'
 * | 'scanned' | 'not-pdf'. `expect` is what the parser must produce: 'result' or an error code.
 * `edges` are rows of the system design's §6 register; `stories` the spec's US numbers.
 */
export const FIXTURES = [
  {
    name: 'cams-2019-plain-sip', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2016-01-01', to: '2019-03-29' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'CAMS', [H('LC', [sip(5000, '2016-02', '2019-03')])])],
    stories: ['US-07', 'US-09', 'US-10', 'US-12', 'US-13', 'US-14', 'US-16', 'US-17', 'US-23', 'US-24', 'US-25', 'US-27'],
    edges: ['E48 (ok path)', 'E52', 'E59'],
    notes: 'Baseline: CAMS detailed, one folio, one fund, 38 monthly SIP instalments before stamp duty existed. Simplest spreadsheet cross-check.',
  },
  {
    name: 'cams-2022-stamp-duty-stt', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2019-04-01', to: '2022-09-30' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'CAMS', [
      H('FLEXI', [sip(10000, '2019-05', '2022-09'), buy('2021-03-15', 50000), redeem('2022-02-14', 400), orphanStamp('2022-05-20', 0.5)]),
    ])],
    stories: ['US-09', 'US-14', 'US-17', 'US-23'],
    edges: ['E20', 'E21', 'E22', 'E32'],
    notes: 'SIP crossing the 1 Jul 2020 stamp-duty boundary; a lump-sum top-up; a partial redemption with an STT row; one stamp-duty row with no same-day parent (ORPHAN_LEVY, info).',
  },
  {
    name: 'cams-2025-switch-pair', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result', forceSplit: true,
    period: { from: '2021-01-01', to: '2025-06-30' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'CAMS', [
      H('LC', [sip(8000, '2021-02', '2023-12'), switchOut('2024-01-18', 'all', 'MID', { exitLoad: 0.01 })]),
      H('LIQUID', [buy('2024-02-05', 120000), stp('2024-03', '2024-08', 6, 20000, 'MID')]),
      H('MID', []),
    ])],
    stories: ['US-09', 'US-14', 'US-17', 'US-27', 'US-30'],
    edges: ['E14', 'E15', 'E51'],
    notes: 'Full switch LC -> MID with a 1% exit load (amounts differ), then a 6-leg STP LIQUID -> MID. Switch descriptions wrap onto two lines.',
  },
  {
    name: 'cams-2025-idcw', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2019-01-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'CAMS', [
      H('LCIDCW', [buy('2019-02-11', 200000), payout('2019-12-16', 0.9, { old: true }), payout('2021-03-15', 1.1), bareIdcw('2023-03-20', 1.0, false), payout('2024-03-18', 1.2)]),
      H('FLIDCWR', [buy('2019-02-11', 150000), reinvest('2019-12-16', 0.8, { old: true }), reinvest('2021-03-15', 1.0), bareIdcw('2023-03-20', 0.9, true), reinvest('2024-03-18', 1.1)]),
    ])],
    stories: ['US-09', 'US-14', 'US-17', 'US-30'],
    edges: ['E16', 'E17', 'E20', 'E42'],
    notes: 'IDCW payout plan (inflows, units unchanged) and IDCW reinvestment plan (zero cash, new lots, stamp duty on post-2020 reinvestments). Bare "IDCW" rows with and without units.',
  },
  {
    name: 'cams-2025-reversal', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2019-01-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [
      F('A', 'CAMS', [H('ELSS', [sip(5000, '2019-02', '2025-03', { reversed: ['2019-08'] })])]),
      F('B', 'CAMS', [H('FLEXI', [buy('2021-06-14', 25000), orphanReversal('2022-01-10', 8000, 45)])]),
    ],
    stories: ['US-09', 'US-14', 'US-17', 'US-24'],
    edges: ['E18', 'E19', 'E30'],
    notes: 'One SIP instalment reversed three days later (pair excluded; counts as a missed instalment), dated before stamp duty so no levy reversal arises. Folio B has a reversal with no original (ORPHAN_REVERSAL, flagged).',
  },
  {
    name: 'cams-2025-segregated', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2018-01-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'CAMS', [
      H('CREDIT', [buy('2018-04-10', 300000), redeem('2021-07-15', 5000)]),
      H('CRSEG', [segregated('2020-03-06', 21345.678)]),
      H('AGGR', [buy('2018-04-10', 100000), bonus('2022-09-12', 0.1)]),
    ])],
    stories: ['US-09', 'US-14', 'US-17'],
    edges: ['E23', 'E24'],
    notes: 'Segregated-portfolio section (units created, no cash, own closing value) and a bonus unit-adjustment row (no cash, counted in reconciliation).',
  },
  {
    name: 'cams-2025-fully-redeemed', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2017-01-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [
      F('A', 'CAMS', [H('SMALL', [sip(3000, '2017-02', '2020-12'), redeem('2021-11-22', 'all')]), H('INDEX', [sip(10000, '2020-04', '2025-03')])]),
      F('B', 'CAMS', [H('INDEX', [buy('2022-08-16', 100000)])]),
    ],
    stories: ['US-13', 'US-14', 'US-17', 'US-27'],
    edges: ['E25', 'E27', 'E37'],
    notes: 'SMALL fully redeemed (zero closing balance, XIRR without terminal); INDEX held in two folios (one Fund, two Folios; index fund tracks the fixture benchmark exactly).',
  },
  {
    name: 'cams-2025-sip-patterns', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2020-01-01', to: '2025-09-30' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'CAMS', [
      H('LC', [sip(5000, '2020-02', '2025-09', { stepUps: [{ from: '2022-02', amount: 7500 }, { from: '2024-02', amount: 10000 }] })]),
      H('FLEXI', [sip(4000, '2020-02', '2025-09', { skip: ['2021-06', '2021-07', '2023-11'] })]),
      H('MID', [sip(6000, '2020-02', '2023-03')]),
      H('ELSS', [sip(12500, '2020-01', '2025-09', { day: 31 }), buy('2021-12-20', 50000), buy('2023-03-27', 50000)]),
      H('GILT', [sip(15000, '2020-03', '2025-09', { freq: 'quarterly', day: 5 })]),
    ])],
    stories: ['US-23', 'US-24', 'US-25', 'US-26'],
    edges: ['E29', 'E30', 'E31', 'E32', 'E33'],
    notes: 'Discipline cases: step-up (same SIP, new amounts), paused (3 missed), stopped (last instalment Mar 2023), top-ups in a SIP scheme, SIP on the 31st (month-end clamp), quarterly SIP.',
  },
  {
    name: 'cams-2025-elss-tax', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result', pinTax: true,
    period: { from: '2021-04-01', to: '2025-09-30' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'CAMS', [
      H('ELSS', [buy('2022-03-31', 50000), buy('2022-04-01', 50000), sip(5000, '2022-10', '2025-09'), buy('2024-09-30', 25000), buy('2025-09-29', 10000)]),
      H('LC', [buy('2024-03-28', 100000), switchOut('2024-10-01', 200, 'ELSS'), buy('2024-09-27', 20000), buy('2024-09-30', 20000)]),
      H('LIQUID', [buy('2023-06-05', 200000)]),
      H('BAF', [buy('2023-06-05', 100000)]),
      H('AGGR', [buy('2024-06-10', 100000)]),
      H('INTL', [buy('2022-06-10', 60000)]),
    ])],
    stories: ['US-18', 'US-30', 'US-31', 'US-32', 'US-33', 'US-34'],
    edges: ['E40', 'E41', 'E42', 'E38'],
    notes: 'Tax preview: ELSS lots on both sides of the 36-month lock, LC lots exactly 12 months (short, strict rule) and 12 months + 3 days (long) before the statement date, FY-boundary lots (31 Mar / 1 Apr), a switch-in lot into ELSS, a purchase one day before the statement date, debt (slab), hybrid-other, aggressive hybrid (equity) and an overseas FoF (debt class).',
  },
  {
    name: 'cams-2025-unknown-isin', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2019-01-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [
      F('A', 'CAMS', [
        H('MYSTERY', [sip(2000, '2019-02', '2025-03')]),
        H('NOISIN', [buy('2020-10-12', 40000)]),
        H('RENAMED', [buy('2019-05-13', 30000)], { printName: 'former' }),
      ]),
      F('B', 'CAMS', [H('RENAMED', [sip(2000, '2022-02', '2025-03')])]),
    ],
    stories: ['US-13', 'US-18', 'US-30'],
    edges: ['E26', 'E28', 'E61'],
    notes: 'ISIN not in the map (Unclassified), scheme header without ISIN (name+folio identity, MISSING_ISIN), the same ISIN printed under its former name in folio A and its new name in folio B (one Fund, two Folios, alsoPrintedAs).',
  },
  {
    name: 'cams-2025-parse-warnings', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2022-04-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [
      F('A', 'CAMS', [
        H('LC', [sip(5000, '2022-05', '2025-03'), hiddenBuy('2023-08-21', 20000)]),
        H('FLEXI', [buy('2022-06-13', 60000), unknownRow('2024-02-19')]),
        H('MID', [buy('2022-06-13', 30000), futureBuy('2025-04-07', 10000)]),
        H('GILT', [buy('2022-06-13', 80000)], { noClosing: true }),
        H('SMALL', [sip(3000, '2022-05', '2025-03')]),
      ]),
      F('B', 'CAMS', [H('INDEX', [opening(1234.567), sip(5000, '2022-05', '2025-03')], { duplicate: true })]),
    ],
    stories: ['US-08', 'US-10', 'US-14'],
    edges: ['E39', 'E43', 'E48', 'E53', 'UNCLASSIFIED_ROW', 'NO_CLOSING_BALANCE'],
    notes: 'Every flag the partial banner can show: a missing row (running-balance jump then closing mismatch), an unknown description, a future-dated row, a section without a closing row, an opening balance without history, a duplicated section (second copy ignored), plus one clean fund so the tiles still render.',
  },
  {
    name: 'cams-2025-missing-period', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2023-01-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary'], omitPeriodLine: true,
    folios: [F('A', 'CAMS', [H('LC', [sip(5000, '2023-02', '2025-03')])])],
    stories: ['US-15'], edges: ['E54'],
    notes: 'No statement-period line: statementDate falls back to the latest transaction date with MISSING_STATEMENT_DATE.',
  },
  {
    name: 'kfin-2020-plain', kind: 'detailed', issuer: 'KFINTECH', style: 'kfin', expect: 'result',
    period: { from: '2017-01-01', to: '2020-12-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'KFINTECH', [H('SMALL', [sip(5000, '2017-03', '2020-12'), redeem('2019-10-14', 500)]), H('CORP', [buy('2018-07-16', 150000)])])],
    stories: ['US-07', 'US-09', 'US-10', 'US-14'],
    edges: ['E50', 'E51', 'E64'],
    notes: 'KFintech layout: different column anchors, negatives in parentheses, numbers printed on the last line of a wrapped description.',
  },
  {
    name: 'kfin-2023-4dp', kind: 'detailed', issuer: 'KFINTECH', style: 'kfin', expect: 'result', forceSplit: true,
    period: { from: '2020-01-01', to: '2023-09-29' }, unitDecimals: 4, investors: ['primary'],
    folios: [F('A', 'KFINTECH', [H('MID', [sip(7000, '2020-02', '2023-09'), switchOut('2022-05-16', 100, 'ARB')]), H('ARB', [])])],
    stories: ['US-09', 'US-10'], edges: ['E49', 'E14'],
    notes: 'Units printed with four decimals: unitDecimals 4, tolerance 0.0002.',
  },
  {
    name: 'kfin-2026-weekly-sip', kind: 'detailed', issuer: 'KFINTECH', style: 'kfin', expect: 'result',
    period: { from: '2024-04-01', to: '2026-03-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [
      F('A', 'KFINTECH', [H('FOCUS', [sip(1000, '2024-04-03', '2026-03-25', { freq: 'weekly' })])]),
      F('B', 'KFINTECH', [H('SHORT', [buy('2024-04-08', 100000), swp('2025-01-10', 100), swp('2025-02-10', 100), swp('2025-03-10', 100)])]),
    ],
    stories: ['US-23', 'US-24', 'US-25', 'US-30'], edges: ['E33', 'E40', 'E15'],
    notes: 'Weekly SIP (frequency detection), SWP rows (redemption kind), statement dated on an FY end.',
  },
  {
    name: 'joint-cams-kfin-2025', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2020-01-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [
      F('A', 'CAMS', [H('LC', [sip(5000, '2020-02', '2025-03')])]),
      F('B', 'KFINTECH', [H('SMALL', [sip(5000, '2020-02', '2025-03')])]),
    ],
    stories: ['US-10'], edges: ['E64'],
    notes: 'Joint RTA CAS issued by CAMS carrying a KFintech-serviced folio (Registrar: KFINTECH on the scheme header).',
  },
  {
    name: 'multi-pan-2025', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result',
    period: { from: '2020-01-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary', 'spouse'],
    folios: [
      F('A', 'CAMS', [H('FLEXI', [sip(5000, '2020-02', '2025-03')])], { investor: 'primary' }),
      F('B', 'CAMS', [H('ELSS', [sip(4000, '2020-02', '2025-03')])], { investor: 'spouse' }),
    ],
    stories: ['US-10'], edges: ['E63'],
    notes: 'Two investor blocks and two PANs: parsed in full, MULTI_PAN info, investorCount 2.',
  },
  {
    name: 'cams-2025-growth-15f-2000t', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result', digest: true,
    period: { from: '2015-10-01', to: '2025-09-30' }, unitDecimals: 3, investors: ['primary'],
    folios: [
      F('A', 'CAMS', [
        H('LC', [sip(5000, '2015-11', '2025-09')]), H('FLEXI', [sip(5000, '2016-01', '2025-09')]), H('MID', [sip(3000, '2015-11', '2025-09')]),
        H('ELSS', [sip(5000, '2015-11', '2025-09', { day: 5 })]), H('INDEX', [sip(10000, '2017-01', '2025-09')]), H('BAF', [sip(4000, '2017-04', '2025-09')]),
        H('AGGR', [buy('2016-03-14', 200000), sip(2000, '2018-01', '2025-09')]), H('LIQUID', [buy('2020-04-06', 500000), redeem('2021-04-06', 100), redeem('2023-04-10', 50)]),
      ]),
      F('B', 'CAMS', [
        H('SMALL', [sip(3000, '2017-01', '2025-09')]), H('FOCUS', [sip(2500, '2017-06', '2025-09')]), H('DIVY', [buy('2019-02-11', 75000)]),
        H('CORP', [buy('2018-07-16', 300000)]), H('INTL', [sip(2000, '2020-01', '2025-09')]), H('GOLD', [sip(2000, '2017-06', '2025-09')]),
        H('MULTI', [sip(3000, '2021-01', '2025-09')]),
      ]),
    ],
    stories: ['US-07', 'US-12', 'US-13', 'US-17'], edges: ['E44 (growth scenario of 02-database-design.md §6)'],
    notes: 'The growth scenario: ten years, fifteen funds, about two thousand transaction rows (SIP instalments plus their stamp-duty rows), roughly fifty pages.',
  },
  {
    name: 'stress-cams-2025-100p', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result', digest: true,
    period: { from: '2015-10-01', to: '2025-09-30' }, unitDecimals: 3, investors: ['primary'],
    folios: [
      F('A', 'CAMS', [H('LC', [sip(1000, '2017-01-04', '2025-09-24', { freq: 'weekly', pin: false })]), H('FLEXI', [sip(1000, '2017-01-05', '2025-09-25', { freq: 'weekly', pin: false })]), H('MID', [sip(1000, '2018-01-03', '2025-09-24', { freq: 'weekly', pin: false })]), H('SMALL', [sip(1000, '2018-01-04', '2025-09-25', { freq: 'weekly', pin: false })])]),
      F('B', 'CAMS', [H('ELSS', [sip(1000, '2019-01-02', '2025-09-24', { freq: 'weekly', pin: false })]), H('INDEX', [sip(1000, '2019-01-03', '2025-09-25', { freq: 'weekly', pin: false })]), H('FOCUS', [sip(1000, '2020-01-01', '2025-09-30', { freq: 'weekly', pin: false })]), H('DIVY', [sip(1000, '2020-01-02', '2025-09-24', { freq: 'weekly', pin: false })])]),
      F('C', 'CAMS', [H('BAF', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('AGGR', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('INTL', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('GOLD', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('MULTI', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('CONS', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('ARB', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('CORP', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('SHORT', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('GILT', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('LIQUID', [sip(2000, '2015-11', '2025-09', { pin: false })]), H('CREDIT', [sip(2000, '2015-11', '2025-09', { pin: false })])]),
    ],
    stories: ['US-07'], edges: ['E44', 'E51', 'E52'],
    notes: 'Stress: more than 100 pages, 20 funds, weekly and monthly SIPs, several thousand rows. Budget: parse <= 8 s, worker peak <= 250 MB (design §7.1).',
  },
  {
    name: 'cams-2024-protected', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result', password: 'LENSP0001A', encryption: 'AES-128',
    period: { from: '2022-01-01', to: '2024-12-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'CAMS', [H('LC', [sip(5000, '2022-02', '2024-12')])])],
    stories: ['US-03'], edges: ['E4', 'E5', 'E6', 'E65'],
    notes: 'User-password protected (the password is the synthetic PAN, as the UI hint suggests). Golden is the parsed result; the password lives in the .meta.json.',
  },
  {
    name: 'cams-2024-owner-locked', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result', ownerPassword: 'owner-only-not-needed-to-open',
    period: { from: '2022-01-01', to: '2024-12-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'CAMS', [H('LC', [sip(5000, '2022-02', '2024-12')])])],
    stories: ['US-03'], edges: ['E4 (owner-password-only opens without a prompt)'],
    notes: 'Owner password only: must open without a password prompt and parse like an unprotected file.',
  },
  {
    name: 'cams-2025-summary', kind: 'summary', issuer: 'CAMS', style: 'cams', expect: 'SUMMARY_CAS',
    period: { from: '2013-01-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'CAMS', [H('LC', [buy('2020-01-13', 100000)]), H('ELSS', [buy('2021-01-11', 50000)])])],
    stories: ['US-05'], edges: ['E10'],
    notes: 'CAMS summary CAS: scheme sections with closing balance / cost / market value and zero transaction rows. Rejected with the scheme names and statement date found.',
  },
  {
    name: 'kfin-2025-summary', kind: 'summary', issuer: 'KFINTECH', style: 'kfin', expect: 'SUMMARY_CAS',
    period: { from: '2013-01-01', to: '2025-03-31' }, unitDecimals: 3, investors: ['primary'],
    folios: [F('A', 'KFINTECH', [H('SMALL', [buy('2020-01-13', 100000)])])],
    stories: ['US-05'], edges: ['E10'],
    notes: 'KFintech summary CAS; the UI shows the KFintech request steps.',
  },
  { name: 'nsdl-2025-depository', kind: 'depository', depository: 'NSDL', expect: 'DEPOSITORY_CAS', period: { from: '2025-03-01', to: '2025-03-31' }, investors: ['primary'], stories: ['US-06'], edges: ['E11'], notes: 'NSDL monthly e-CAS: prints "Consolidated Account Statement" and lists MF folios serviced by CAMS/KFintech, so depository markers must win.' },
  { name: 'cdsl-2025-depository', kind: 'depository', depository: 'CDSL', expect: 'DEPOSITORY_CAS', period: { from: '2025-03-01', to: '2025-03-31' }, investors: ['primary'], stories: ['US-06'], edges: ['E11'], notes: 'CDSL e-CAS with BO ID and myeasi markers.' },
  { name: 'scanned-2025', kind: 'scanned', expect: 'NO_TEXT', stories: ['US-04'], edges: ['E8'], notes: 'Two pages of vector blocks and no text objects: fewer than 200 characters on pages 1-3.' },
  { name: 'not-cas-bank-statement', kind: 'not-cas', expect: 'NOT_CAS', stories: ['US-04'], edges: ['E9'], notes: 'A synthetic bank account statement PDF: text, but no RTA + CAS markers.' },
  { name: 'not-cas-cams-letter', kind: 'cams-letter', expect: 'NOT_CAS', stories: ['US-04'], edges: ['E9'], notes: 'A CAMS service letter mentioning a folio and PAN: passes the page-1 marker test, but the full walk finds zero folio sections.' },
  { name: 'not-a-pdf', kind: 'not-pdf', expect: 'NOT_PDF', stories: ['US-02'], edges: ['E1', 'E46'], notes: 'PNG bytes under a .pdf name: rejected on the main thread before any worker starts.' },
  {
    name: 'sample-cas', kind: 'detailed', issuer: 'CAMS', style: 'cams', expect: 'result', publicSample: true,
    period: { from: '2019-04-01', to: '2026-09-30' }, unitDecimals: 3, investors: ['primary'],
    folios: [
      F('A', 'CAMS', [
        H('LC', [sip(5000, '2019-05', '2026-09', { stepUps: [{ from: '2023-05', amount: 7500 }] })]),
        H('ELSS', [sip(4000, '2019-05', '2026-09', { skip: ['2020-05', '2020-06'] })]),
        H('FLEXI', [buy('2020-04-06', 100000), switchOut('2024-06-17', 'all', 'INDEX')]),
        H('INDEX', [sip(5000, '2022-01', '2026-09')]),
        H('FLIDCWR', [buy('2019-06-10', 50000), reinvest('2021-03-15', 1.0), reinvest('2024-03-18', 1.1)]),
        H('LCIDCW', [buy('2019-06-10', 50000), payout('2021-03-15', 1.1), payout('2024-03-18', 1.2)]),
      ]),
      F('B', 'KFINTECH', [
        H('SMALL', [sip(3000, '2019-05', '2022-12'), redeem('2023-09-18', 'all')]),
        H('LIQUID', [buy('2024-01-08', 150000), redeem('2025-02-10', 10)]),
        H('BAF', [buy('2021-08-09', 80000), hiddenBuy('2023-02-13', 20000)]),
        H('MID', [sip(5000, '2020-02', '2025-01', { reversed: ['2020-03'] })]),
      ]),
    ],
    stories: ['US-11'], edges: ['§5.4 sample contents'],
    notes: 'public/sample-cas.pdf: unprotected, both RTA styles, every TransactionKind except segregated/unit_adjustment/unknown (kept out of the demo on purpose), ELSS, debt, switch pair, reversal pair, fully redeemed fund, one unit mismatch (BAF) so the partial banner is demonstrable.',
  },
];

// ---------------------------------------------------------------- expansion

const scale = (dp) => 10 ** dp;
const toPaise = (rupees) => Math.round(rupees * 100 + Number.EPSILON * 1e4 * Math.sign(rupees));
const paiseToRupees = (p) => p / 100;

/** units (integer at dp) from paise and NAV: round-half-up of paise / 100 / nav × 10^dp. */
function unitsFor(paise, nav, dp) {
  return Math.round((paise / 100 / nav) * scale(dp) + 1e-9);
}
function paiseFor(unitsInt, nav, dp) {
  return Math.round((unitsInt / scale(dp)) * nav * 100 + 1e-9);
}
function stampFor(grossPaise, date) {
  if (date < STAMP_DUTY_FROM) return 0;
  return Math.max(1, Math.round(grossPaise * STAMP_DUTY_RATE + 1e-9)); // in paise; at least 1 paisa
}
function sttFor(grossPaise, isEquity) {
  if (!isEquity) return 0;
  return Math.max(1, Math.round(grossPaise * STT_RATE + 1e-9));
}
function isEquityLike(s) {
  return s.taxClass === 'equity' || s.tax === 'equity';
}

/** Expands a SIP event into nominal instalment dates (not yet rolled to business days). */
export function sipSchedule(ev) {
  const dates = [];
  if (ev.freq === 'weekly') {
    let d = ev.from.length === 7 ? `${ev.from}-01` : ev.from;
    const end = ev.to.length === 7 ? addMonths(`${ev.to}-01`, 1) : ev.to;
    while (d <= end) { dates.push(d); d = addDays(d, 7); }
    return dates;
  }
  const step = ev.freq === 'quarterly' ? 3 : 1;
  const [fy, fm] = ev.from.split('-').map(Number);
  const first = `${fy}-${String(fm).padStart(2, '0')}-${String(Math.min(ev.day, 28)).padStart(2, '0')}`;
  const endMonth = ev.to.slice(0, 7);
  for (let i = 0; ; i++) {
    const nominalBase = addMonths(first, i * step);
    if (nominalBase.slice(0, 7) > endMonth) break;
    // day-of-month with month-end clamping (design dates.ts semantics; day 31 clamps to 28/29/30)
    const [y, m] = nominalBase.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    dates.push(`${y}-${String(m).padStart(2, '0')}-${String(Math.min(ev.day, last)).padStart(2, '0')}`);
  }
  return dates;
}

function amountAt(ev, nominal) {
  let amt = ev.amount;
  for (const su of ev.stepUps) if (nominal.slice(0, 7) >= su.from) amt = su.amount;
  return amt;
}

/**
 * Expands one fixture. Returns:
 * { fixture, statementDate, investors, folios: [{ label, folioNumber, rta, investor, pan, holdings: [{ scheme, printedName(s),
 *   openingUnits, rows: [...], closing: {...} | null, noClosing, duplicate, sips: [...] }] }] }
 * Each row: { date, description, kind, amountPaise?, unitsInt?, nav?, balanceInt?, printBalance, hidden, future,
 *   attachTo?: rowIdx, reverses?: rowIdx, orphanLevy?, sipRef? }
 */
export function expandFixture(fx) {
  if (fx.kind !== 'detailed' && fx.kind !== 'summary') return { fixture: fx, folios: [], investors: fx.investors ?? [] };
  const dp = fx.unitDecimals;
  const vocab = VOCAB[fx.style];
  const asOf = fx.period.to;
  const folios = fx.folios.map((f) => ({
    label: f.label,
    folioNumber: folioNumber(f.rta, `${fx.name}-${f.label}`),
    rta: f.rta,
    investor: f.investor,
    pan: INVESTORS[f.investor].pan,
    holdings: f.holdings.map((h) => ({ def: h, scheme: SCHEMES[h.scheme], ops: [], rows: [], sips: [], openingInt: 0, noClosing: !!h.noClosing, duplicate: !!h.duplicate })),
  }));
  const findHolding = (key) => {
    for (const f of folios) for (const h of f.holdings) if (h.scheme.key === key) return h;
    throw new Error(`${fx.name}: switch target ${key} is not a holding in this fixture`);
  };
  const equity = (h) => isEquityLike(h.scheme);

  // Phase 1: ops per holding (dates rolled to business days), including counterparts pushed into other holdings.
  let purchaseStyle = 0;
  for (const f of folios) {
    for (const h of f.holdings) {
      let sipNo = 0;
      for (const ev of h.def.events) {
        switch (ev.type) {
          case 'opening': h.openingInt = Math.round(ev.units * scale(dp)); break;
          case 'sip': {
            const nominals = sipSchedule(ev);
            const sipRec = { ev, nominals, made: [], skipped: [], reversed: [], amounts: [] };
            h.sips.push(sipRec);
            for (const nominal of nominals) {
              sipNo++;
              const skip = ev.skip.some((s) => nominal.startsWith(s));
              const rev = ev.reversed.some((s) => nominal.startsWith(s));
              const amt = amountAt(ev, nominal);
              if (skip) { sipRec.skipped.push(nominal); continue; }
              const date = rollForward(nominal);
              if (date > asOf) { sipRec.skipped.push(nominal); continue; }
              const descr = vocab.sip(sipNo);
              h.ops.push({ date, order: 0, type: 'buy', gross: toPaise(amt), descr, sipRef: sipRec, nominal });
              if (rev) { h.ops.push({ date: rollForward(addDays(date, 3)), order: 0, type: 'reverse', targetDescr: descr, targetDate: date }); sipRec.reversed.push(nominal); }
              else sipRec.made.push(nominal);
            }
            break;
          }
          case 'purchase':
            h.ops.push({ date: ev.future ? ev.date : rollForward(ev.date), order: 0, type: 'buy', gross: toPaise(ev.amount), descr: vocab.purchase(purchaseStyle++), hidden: !!ev.hidden, future: !!ev.future });
            break;
          case 'reversedBuy': {
            const date = rollForward(ev.date);
            const descr = vocab.purchase(purchaseStyle++);
            h.ops.push({ date, order: 0, type: 'buy', gross: toPaise(ev.amount), descr });
            h.ops.push({ date: rollForward(addDays(date, 3)), order: 0, type: 'reverse', targetDescr: descr, targetDate: date, rejected: true });
            break;
          }
          case 'redeem':
            h.ops.push({ date: rollForward(ev.date), order: 1, type: 'sell', units: ev.units, descr: ev.swp ? vocab.swp() : vocab.redeem(), stt: equity(h) });
            break;
          case 'switchOut': {
            const target = findHolding(ev.to);
            h.ops.push({ date: rollForward(ev.date), order: 1, type: 'sell', units: ev.units, descr: vocab.switchOut(target.scheme.name), stt: equity(h), exitLoad: ev.exitLoad ?? 0, switchTo: target, switchDescr: vocab.switchIn(h.scheme.name) });
            break;
          }
          case 'stp': {
            const target = findHolding(ev.target);
            for (let i = 0; i < ev.months; i++) {
              const date = rollForward(addMonths(`${ev.from}-10`, i));
              h.ops.push({ date, order: 1, type: 'sellAmount', amount: toPaise(ev.amount), descr: vocab.stpOut(target.scheme.name), stt: equity(h), switchTo: target, switchDescr: vocab.stpIn(h.scheme.name) });
            }
            break;
          }
          case 'payout': h.ops.push({ date: rollForward(ev.date), order: 2, type: 'payout', perUnit: ev.perUnit, descr: vocab.payout(!!ev.old) }); break;
          case 'reinvest': h.ops.push({ date: rollForward(ev.date), order: 2, type: 'reinvest', perUnit: ev.perUnit, descr: vocab.reinvest(!!ev.old) }); break;
          case 'bareIdcw': h.ops.push({ date: rollForward(ev.date), order: 2, type: ev.withUnits ? 'reinvest' : 'payout', perUnit: ev.perUnit, descr: vocab.bareIdcw(), bare: true }); break;
          case 'orphanReversal': h.ops.push({ date: rollForward(ev.date), order: 0, type: 'orphanReversal', amount: toPaise(ev.amount), unitsInt: Math.round(ev.units * scale(dp)), descr: vocab.reversal(vocab.purchase(0)) }); break;
          case 'orphanStamp': h.ops.push({ date: rollForward(ev.date), order: 3, type: 'orphanStamp', amount: toPaise(ev.amount), descr: vocab.stamp() }); break;
          case 'segregated': h.ops.push({ date: ev.date, order: 0, type: 'segregated', unitsInt: Math.round(ev.units * scale(dp)), descr: vocab.segregated() }); break;
          case 'bonus': h.ops.push({ date: rollForward(ev.date), order: 2, type: 'bonus', ratio: ev.ratio, descr: vocab.bonus() }); break;
          case 'unknown': h.ops.push({ date: rollForward(ev.date), order: 2, type: 'unknown', descr: vocab.unknown() }); break;
          default: throw new Error(`${fx.name}: unknown event type ${ev.type}`);
        }
      }
    }
  }

  // Phase 2: run each holding's ops in date order. Switch counterparts are appended to the target's op
  // list while the source runs, so a holding runs only after every holding that switches into it.
  const all = folios.flatMap((f) => f.holdings);
  const sourcesOf = (h) => all.filter((src) => src !== h && src.ops.some((op) => op.switchTo === h));
  const done = new Set();
  const runHolding = (h) => {
    if (done.has(h)) return;
    for (const src of sourcesOf(h)) runHolding(src);
    done.add(h);
    h.ops.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
    let bal = h.openingInt;
    const rows = h.rows;
    const push = (row) => { rows.push(row); return rows.length - 1; };
    for (let k = 0; k < h.ops.length; k++) {
      const op = h.ops[k];
      const navAt = navOn(h.scheme.key, op.date);
      switch (op.type) {
        case 'buy': {
          const stamp = stampFor(op.gross, op.date);
          const net = op.gross - stamp;
          const u = unitsFor(net, navAt, dp);
          bal += u;
          const kind = op.switchIn ? 'switch_in' : op.sipRef ? 'sip' : 'purchase';
          const idx = push({ date: op.date, description: op.descr, kind, amountPaise: net, unitsInt: u, nav: navAt, balanceInt: bal, printBalance: true, hidden: !!op.hidden, future: !!op.future, sipRef: op.sipRef, nominal: op.nominal, grossPaise: op.gross });
          if (stamp && !op.hidden) push({ date: op.date, description: vocab.stamp(), kind: 'stamp_duty', amountPaise: stamp, printBalance: false, attachTo: idx, future: !!op.future });
          break;
        }
        case 'reverse': {
          const origIdx = rows.findIndex((r) => r.description === op.targetDescr && r.date === op.targetDate);
          if (origIdx < 0) throw new Error(`${fx.name}: reversal target not found`);
          const orig = rows[origIdx];
          bal -= orig.unitsInt;
          push({ date: op.date, description: op.rejected ? vocab.rejected() : vocab.reversal(orig.description), kind: 'reversal', amountPaise: -orig.amountPaise, unitsInt: -orig.unitsInt, nav: orig.nav, balanceInt: bal, printBalance: true, reverses: origIdx });
          break;
        }
        case 'sell':
        case 'sellAmount': {
          let u;
          if (op.type === 'sellAmount') u = unitsFor(op.amount, navAt, dp);
          else u = op.units === 'all' ? bal : Math.round(op.units * scale(dp));
          if (u > bal) throw new Error(`${fx.name}: ${h.scheme.key} selling ${u} > balance ${bal} on ${op.date}`);
          const gross = paiseFor(u, navAt, dp);
          const load = Math.round(gross * (op.exitLoad ?? 0));
          const amount = gross - load;
          bal -= u;
          const idx = push({ date: op.date, description: op.descr, kind: op.switchTo ? 'switch_out' : 'redemption', amountPaise: -amount, unitsInt: -u, nav: navAt, balanceInt: bal, printBalance: true });
          const stt = sttFor(gross, op.stt);
          if (stt) push({ date: op.date, description: vocab.stt(), kind: 'stt_tds', amountPaise: stt, printBalance: false, attachTo: idx });
          if (op.switchTo) {
            if (done.has(op.switchTo)) throw new Error(`${fx.name}: switch into ${op.switchTo.scheme.key} after it was already expanded`);
            op.switchTo.ops.push({ date: op.date, order: 0, type: 'buy', gross: amount, descr: op.switchDescr, switchIn: true });
          }
          break;
        }
        case 'payout': {
          const amount = Math.round((bal / scale(dp)) * op.perUnit * 100);
          push({ date: op.date, description: op.descr, kind: 'dividend_payout', amountPaise: amount, nav: navAt, balanceInt: bal, printBalance: true });
          break;
        }
        case 'reinvest': {
          const gross = Math.round((bal / scale(dp)) * op.perUnit * 100);
          const stamp = stampFor(gross, op.date);
          const net = gross - stamp;
          const u = unitsFor(net, navAt, dp);
          bal += u;
          const idx = push({ date: op.date, description: op.descr, kind: 'dividend_reinvest', amountPaise: net, unitsInt: u, nav: navAt, balanceInt: bal, printBalance: true });
          if (stamp) push({ date: op.date, description: vocab.stamp(), kind: 'stamp_duty', amountPaise: stamp, printBalance: false, attachTo: idx });
          break;
        }
        case 'orphanReversal':
          bal -= op.unitsInt;
          push({ date: op.date, description: op.descr, kind: 'reversal', amountPaise: -op.amount, unitsInt: -op.unitsInt, nav: navAt, balanceInt: bal, printBalance: true, orphanReversal: true });
          break;
        case 'orphanStamp':
          push({ date: op.date, description: op.descr, kind: 'stamp_duty', amountPaise: op.amount, printBalance: false, orphanLevy: true });
          break;
        case 'segregated':
          bal += op.unitsInt;
          push({ date: op.date, description: op.descr, kind: 'segregated', unitsInt: op.unitsInt, balanceInt: bal, printBalance: true });
          break;
        case 'bonus': {
          const u = Math.round(bal * op.ratio);
          bal += u;
          push({ date: op.date, description: op.descr, kind: 'unit_adjustment', unitsInt: u, balanceInt: bal, printBalance: true });
          break;
        }
        case 'unknown':
          push({ date: op.date, description: op.descr, kind: 'unknown', balanceInt: bal, printBalance: true });
          break;
        default: throw new Error(`internal: op ${op.type}`);
      }
    }
    h.closingInt = bal;
    h.closingNav = navOn(h.scheme.key, asOf);
    h.closingValuePaise = paiseFor(bal, h.closingNav, dp);
    // E26: a holding flagged printName:'former' prints its section under the scheme's former name.
    h.printedName = h.def.printName === 'former' ? h.scheme.formerName : h.scheme.name;
  };
  for (const h of all) runHolding(h);
  return { fixture: fx, folios, investors: fx.investors, statementDate: asOf, dp };
}

// ---------------------------------------------------------------- summary-CAS and non-CAS content helpers

export function investorBlock(key) {
  const inv = INVESTORS[key];
  return { ...inv, maskedPan: maskedPan(inv.pan) };
}

export { fmtDate, dayNumber, isBusinessDay };
