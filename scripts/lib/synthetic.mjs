// scripts/lib/synthetic.mjs
// Deterministic synthetic market data for the fixture corpus. No dependencies, no I/O, no wall clock.
//
// Everything here is fictitious: fund names, AMCs, ISINs (issuer prefix INF000S01, which no real AMC
// uses), folio numbers, PANs and investors. Nothing is derived from any real statement.

import zlib from 'node:zlib';
import { dayNumber, isoFromDayNumber } from './cli.mjs';

// ---------------------------------------------------------------- PRNG

/** mulberry32: small, fast, deterministic. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)) };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------- calendar

/** Synthetic exchange holidays (MM-DD), identical every year so fixtures are stable. Not real NSE holidays. */
export const SYNTHETIC_HOLIDAYS = ['01-26', '03-25', '04-14', '05-01', '08-15', '10-02', '11-01', '12-25'];

export function isWeekend(iso) {
  const d = (dayNumber(iso) + 4) % 7; // 1970-01-01 was a Thursday (4), so this is the JS getDay() convention
  return d === 0 || d === 6; // Sunday = 0, Saturday = 6
}

export function isBusinessDay(iso) {
  return !isWeekend(iso) && !SYNTHETIC_HOLIDAYS.includes(iso.slice(5));
}

/** Next business day on or after `iso`. */
export function rollForward(iso) {
  let n = dayNumber(iso);
  while (!isBusinessDay(isoFromDayNumber(n))) n++;
  return isoFromDayNumber(n);
}

/** Previous business day on or before `iso`. */
export function rollBack(iso) {
  let n = dayNumber(iso);
  while (!isBusinessDay(isoFromDayNumber(n))) n--;
  return isoFromDayNumber(n);
}

export function addDays(iso, n) {
  return isoFromDayNumber(dayNumber(iso) + n);
}

/** Calendar-month arithmetic with month-end clamping (same rule as src/calculations/dates.ts addMonths). */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12), nm = total - ny * 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}-${MON[Number(m) - 1]}-${y}`;
}

// ---------------------------------------------------------------- numbers

export function round(n, dp) {
  const f = 10 ** dp;
  // round half away from zero, after nudging for binary noise
  const x = Math.abs(n) * f;
  const r = Math.floor(x + 0.5 + 1e-9);
  return (n < 0 ? -r : r) / f;
}

/** Indian digit grouping: 1234567.891 -> "12,34,567.891". */
export function groupIndian(n, dp) {
  const neg = n < 0;
  const s = Math.abs(n).toFixed(dp);
  let [int, frac] = s.split('.');
  let out = '';
  if (int.length > 3) {
    const head = int.slice(0, -3), tail = int.slice(-3);
    out = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail;
  } else out = int;
  return (neg ? '-' : '') + out + (frac !== undefined ? '.' + frac : '');
}

/** Money as the RTA prints it. CAMS: "-1,234.50". KFintech: "(1,234.50)". */
export function fmtMoney(n, style) {
  if (n < 0 && style === 'kfin') return `(${groupIndian(-n, 2)})`;
  return groupIndian(n, 2);
}

export function fmtUnits(n, dp, style) {
  if (n < 0 && style === 'kfin') return `(${groupIndian(-n, dp)})`;
  return groupIndian(n, dp);
}

export function fmtNav(n) {
  return groupIndian(n, 4);
}

// ---------------------------------------------------------------- ISIN

/** ISIN check digit (Luhn over the digit expansion, letters A=10..Z=35). */
export function isinCheckDigit(body11) {
  const digits = [];
  for (const ch of body11) {
    const v = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) digits.push(Number(d));
  }
  let sum = 0;
  let dbl = true; // rightmost digit of the body is doubled
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return String((10 - (sum % 10)) % 10);
}

/** Synthetic ISIN in the reserved namespace INF000S01xx + check. `code` is two chars [A-Z0-9]. */
export function syntheticIsin(code) {
  if (!/^[A-Z0-9]{2}$/.test(code)) throw new Error('syntheticIsin code must be two [A-Z0-9] chars');
  const body = 'INF000S01' + code;
  return body + isinCheckDigit(body);
}

// ---------------------------------------------------------------- scheme registry

/**
 * The synthetic fund universe. `taxClass` and `category` follow design A15 and the SEBI → class table in
 * refresh-isin-map.mjs; `inMap` false means the ISIN is deliberately absent from isinCategory.json
 * (exercises E61 "unknown ISIN"). `isin: null` means the scheme header prints no ISIN (E28).
 *
 * NAV model: nav(t) = nav0 × market(t)^beta × idio(t) (geometric, business-day steps), see navSeries().
 */
export const SCHEMES = {
  LC:      { code: 'LC', name: 'Lens Sample Large Cap Fund - Direct Plan - Growth',                  amc: 'Lens Sample Mutual Fund',   amfi: '900001', category: 'Equity', sub: 'Large Cap Fund',             tax: 'equity',       elss: false, nav0: 20,   inception: '2013-01-01', beta: 1.0,  idioVol: 0.06, drift: 0.000, inMap: true },
  FLEXI:   { code: 'FL', name: 'Lens Sample Flexi Cap Fund - Direct Plan - Growth',                  amc: 'Lens Sample Mutual Fund',   amfi: '900002', category: 'Equity', sub: 'Flexi Cap Fund',             tax: 'equity',       elss: false, nav0: 30,   inception: '2013-01-01', beta: 1.05, idioVol: 0.08, drift: 0.015, inMap: true },
  MID:     { code: 'MD', name: 'Lens Sample Midcap Opportunities Fund - Direct Plan - Growth',       amc: 'Lens Sample Mutual Fund',   amfi: '900003', category: 'Equity', sub: 'Mid Cap Fund',               tax: 'equity',       elss: false, nav0: 40,   inception: '2013-01-01', beta: 1.2,  idioVol: 0.10, drift: 0.020, inMap: true },
  SMALL:   { code: 'SM', name: 'Lens Sample Small Cap Fund - Direct Plan - Growth',                  amc: 'Meridian Sample AMC',       amfi: '900004', category: 'Equity', sub: 'Small Cap Fund',             tax: 'equity',       elss: false, nav0: 15,   inception: '2013-01-01', beta: 1.3,  idioVol: 0.14, drift: 0.025, inMap: true },
  ELSS:    { code: 'EL', name: 'Lens Sample ELSS Tax Saver Fund - Direct Plan - Growth',             amc: 'Lens Sample Mutual Fund',   amfi: '900005', category: 'Equity', sub: 'ELSS',                       tax: 'equity',       elss: true,  nav0: 25,   inception: '2013-01-01', beta: 1.0,  idioVol: 0.07, drift: 0.005, inMap: true },
  INDEX:   { code: 'IX', name: 'Lens Sample Nifty 50 Index Fund - Direct Plan - Growth',             amc: 'Meridian Sample AMC',       amfi: '900006', category: 'Equity', sub: 'Index Funds',                tax: 'equity',       elss: false, nav0: 50,   inception: '2013-01-01', beta: 1.0,  idioVol: 0.00, drift: -0.002, inMap: true },
  LIQUID:  { code: 'LQ', name: 'Lens Sample Liquid Fund - Direct Plan - Growth',                     amc: 'Lens Sample Mutual Fund',   amfi: '900007', category: 'Debt',   sub: 'Liquid Fund',                tax: 'debt',         elss: false, nav0: 2000, inception: '2013-01-01', beta: 0.0,  idioVol: 0.002, drift: 0.065, inMap: true },
  GILT:    { code: 'GL', name: 'Lens Sample Gilt Fund - Direct Plan - Growth',                       amc: 'Meridian Sample AMC',       amfi: '900008', category: 'Debt',   sub: 'Gilt Fund',                  tax: 'debt',         elss: false, nav0: 30,   inception: '2013-01-01', beta: 0.0,  idioVol: 0.035, drift: 0.070, inMap: true },
  BAF:     { code: 'BA', name: 'Lens Sample Balanced Advantage Fund - Direct Plan - Growth',         amc: 'Lens Sample Mutual Fund',   amfi: '900009', category: 'Hybrid', sub: 'Balanced Advantage Fund',    tax: 'hybrid-other', elss: false, nav0: 15,   inception: '2013-01-01', beta: 0.55, idioVol: 0.04, drift: 0.030, inMap: true },
  AGGR:    { code: 'AG', name: 'Lens Sample Aggressive Hybrid Fund - Direct Plan - Growth',          amc: 'Meridian Sample AMC',       amfi: '900010', category: 'Hybrid', sub: 'Aggressive Hybrid Fund',     tax: 'equity',       elss: false, nav0: 100,  inception: '2013-01-01', beta: 0.7,  idioVol: 0.05, drift: 0.025, inMap: true },
  INTL:    { code: 'IN', name: 'Lens Sample US Equity Fund of Fund - Direct Plan - Growth',          amc: 'Meridian Sample AMC',       amfi: '900011', category: 'Equity', sub: 'FoF Overseas',               tax: 'debt',         elss: false, nav0: 12,   inception: '2013-01-01', beta: 0.3,  idioVol: 0.14, drift: 0.090, inMap: true },
  CREDIT:  { code: 'CR', name: 'Lens Sample Credit Risk Fund - Direct Plan - Growth',                amc: 'Lens Sample Mutual Fund',   amfi: '900012', category: 'Debt',   sub: 'Credit Risk Fund',           tax: 'debt',         elss: false, nav0: 14,   inception: '2013-01-01', beta: 0.0,  idioVol: 0.02, drift: 0.075, inMap: true },
  CRSEG:   { code: 'CS', name: 'Lens Sample Credit Risk Fund - Segregated Portfolio 1 - Direct Plan - Growth', amc: 'Lens Sample Mutual Fund', amfi: '900013', category: 'Debt', sub: 'Credit Risk Fund', tax: 'debt',   elss: false, nav0: 1.2,  inception: '2020-03-06', beta: 0.0,  idioVol: 0.10, drift: 0.000, inMap: true },
  LCIDCW:  { code: 'LD', name: 'Lens Sample Large Cap Fund - Direct Plan - IDCW Payout',             amc: 'Lens Sample Mutual Fund',   amfi: '900014', category: 'Equity', sub: 'Large Cap Fund',             tax: 'equity',       elss: false, nav0: 14,   inception: '2013-01-01', beta: 1.0,  idioVol: 0.06, drift: -0.040, inMap: true },
  FLIDCWR: { code: 'FR', name: 'Lens Sample Flexi Cap Fund - Direct Plan - IDCW Reinvestment',       amc: 'Lens Sample Mutual Fund',   amfi: '900015', category: 'Equity', sub: 'Flexi Cap Fund',             tax: 'equity',       elss: false, nav0: 18,   inception: '2013-01-01', beta: 1.05, idioVol: 0.08, drift: -0.030, inMap: true },
  MYSTERY: { code: 'MY', name: 'Lens Sample Thematic Opportunities Fund - Direct Plan - Growth',     amc: 'Orbit Sample Asset Managers', amfi: '900016', category: 'Equity', sub: 'Sectoral/ Thematic',       tax: 'equity',       elss: false, nav0: 22,   inception: '2013-01-01', beta: 1.1,  idioVol: 0.12, drift: 0.010, inMap: false },
  NOISIN:  { code: null, name: 'Lens Sample Value Discovery Fund - Regular Plan - Growth',           amc: 'Orbit Sample Asset Managers', amfi: null,     category: 'Equity', sub: 'Value Fund',               tax: 'equity',       elss: false, nav0: 35,   inception: '2013-01-01', beta: 1.0,  idioVol: 0.09, drift: 0.000, inMap: false },
  RENAMED: { code: 'RN', name: 'Lens Sample Large & Mid Cap Fund - Direct Plan - Growth', formerName: 'Lens Sample Bluechip Fund - Direct Plan - Growth', amc: 'Orbit Sample Asset Managers', amfi: '900018', category: 'Equity', sub: 'Large & Mid Cap Fund', tax: 'equity', elss: false, nav0: 28, inception: '2013-01-01', beta: 1.1, idioVol: 0.08, drift: 0.010, inMap: true },
  FOCUS:   { code: 'FO', name: 'Lens Sample Focused Equity Fund - Direct Plan - Growth',             amc: 'Orbit Sample Asset Managers', amfi: '900019', category: 'Equity', sub: 'Focused Fund',             tax: 'equity',       elss: false, nav0: 19,   inception: '2013-01-01', beta: 1.0,  idioVol: 0.09, drift: 0.012, inMap: true },
  DIVY:    { code: 'DY', name: 'Lens Sample Dividend Yield Fund - Direct Plan - Growth',             amc: 'Orbit Sample Asset Managers', amfi: '900020', category: 'Equity', sub: 'Dividend Yield Fund',      tax: 'equity',       elss: false, nav0: 21,   inception: '2013-01-01', beta: 0.9,  idioVol: 0.07, drift: 0.000, inMap: true },
  CORP:    { code: 'CB', name: 'Lens Sample Corporate Bond Fund - Direct Plan - Growth',             amc: 'Meridian Sample AMC',       amfi: '900021', category: 'Debt',   sub: 'Corporate Bond Fund',        tax: 'debt',         elss: false, nav0: 20,   inception: '2013-01-01', beta: 0.0,  idioVol: 0.015, drift: 0.072, inMap: true },
  ARB:     { code: 'AR', name: 'Lens Sample Arbitrage Fund - Direct Plan - Growth',                  amc: 'Orbit Sample Asset Managers', amfi: '900022', category: 'Hybrid', sub: 'Arbitrage Fund',           tax: 'equity',       elss: false, nav0: 11,   inception: '2013-01-01', beta: 0.0,  idioVol: 0.004, drift: 0.062, inMap: true },
  MULTI:   { code: 'MA', name: 'Lens Sample Multi Asset Allocation Fund - Direct Plan - Growth',     amc: 'Meridian Sample AMC',       amfi: '900023', category: 'Hybrid', sub: 'Multi Asset Allocation',     tax: 'hybrid-other', elss: false, nav0: 13,   inception: '2013-01-01', beta: 0.5,  idioVol: 0.05, drift: 0.035, inMap: true },
  SHORT:   { code: 'SD', name: 'Lens Sample Short Duration Fund - Direct Plan - Growth',             amc: 'Lens Sample Mutual Fund',   amfi: '900024', category: 'Debt',   sub: 'Short Duration Fund',        tax: 'debt',         elss: false, nav0: 25,   inception: '2013-01-01', beta: 0.0,  idioVol: 0.01, drift: 0.068, inMap: true },
  GOLD:    { code: 'GD', name: 'Lens Sample Gold Fund of Fund - Direct Plan - Growth',               amc: 'Meridian Sample AMC',       amfi: '900025', category: 'Other',  sub: 'FoF Domestic',               tax: 'debt',         elss: false, nav0: 16,   inception: '2013-01-01', beta: -0.1, idioVol: 0.13, drift: 0.070, inMap: true },
  CONS:    { code: 'CH', name: 'Lens Sample Conservative Hybrid Fund - Direct Plan - Growth',        amc: 'Orbit Sample Asset Managers', amfi: '900026', category: 'Hybrid', sub: 'Conservative Hybrid Fund', tax: 'hybrid-other', elss: false, nav0: 24,   inception: '2013-01-01', beta: 0.2,  idioVol: 0.02, drift: 0.050, inMap: true },
};

for (const [key, s] of Object.entries(SCHEMES)) {
  s.key = key;
  s.isin = s.code ? syntheticIsin(s.code) : null;
}

/** Entries merged into isinCategory.json so the sample CAS classifies (listed under "synthetic" in the file). */
export function syntheticCategoryOverlay() {
  return Object.values(SCHEMES)
    .filter((s) => s.isin && s.inMap)
    .map((s) => ({ isin: s.isin, schemeName: s.name, category: s.category, subCategory: s.sub, taxClass: s.tax, isElss: s.elss }));
}

// ---------------------------------------------------------------- NAV series

const SERIES_START = '2012-12-31';
const SERIES_END = '2027-03-31';
const seriesCache = new Map();

/** Common market factor: GBM with ~12.5%/yr drift and 14% vol, with a deterministic 2020 drawdown. */
function marketSeries() {
  if (seriesCache.has('__MARKET__')) return seriesCache.get('__MARKET__');
  const rng = makeRng(hashSeed('LENS-MARKET-3'));
  const map = new Map();
  let level = 1;
  let prevIso = null;
  for (let n = dayNumber(SERIES_START); n <= dayNumber(SERIES_END); n++) {
    const iso = isoFromDayNumber(n);
    if (!isBusinessDay(iso)) continue;
    if (prevIso) {
      let mu = 0.125, sigma = 0.14;
      if (iso >= '2020-02-20' && iso <= '2020-03-24') { mu = -4.0; sigma = 0.45; }       // crash
      else if (iso > '2020-03-24' && iso <= '2020-11-30') { mu = 0.9; sigma = 0.25; }     // recovery
      else if (iso >= '2022-01-15' && iso <= '2022-06-20') { mu = -0.35; sigma = 0.20; }  // 2022 dip
      const dt = 1 / 250;
      level *= Math.exp((mu - sigma * sigma / 2) * dt + sigma * Math.sqrt(dt) * rng.gauss());
    }
    map.set(iso, level);
    prevIso = iso;
  }
  seriesCache.set('__MARKET__', map);
  return map;
}

/** Business-day NAV series for a scheme key: Map<iso, nav4dp>. Deterministic. */
export function navSeries(key) {
  if (seriesCache.has(key)) return seriesCache.get(key);
  const s = SCHEMES[key];
  if (!s) throw new Error(`unknown scheme ${key}`);
  const market = marketSeries();
  const rng = makeRng(hashSeed('LENS-' + key));
  const map = new Map();
  let idio = 1;
  let marketAtStart = null;
  for (const [iso, m] of market) {
    if (iso < s.inception) continue;
    if (marketAtStart === null) marketAtStart = m;
    else {
      const dt = 1 / 250;
      idio *= Math.exp((s.drift - s.idioVol * s.idioVol / 2) * dt + s.idioVol * Math.sqrt(dt) * rng.gauss());
    }
    const nav = s.nav0 * Math.pow(m / marketAtStart, s.beta) * idio;
    map.set(iso, round(nav, 4));
  }
  seriesCache.set(key, map);
  return map;
}

/** NAV on `iso`, or the previous business day's NAV when `iso` is not a business day. */
export function navOn(key, iso) {
  const series = navSeries(key);
  const d = rollBack(iso);
  const v = series.get(d);
  if (v === undefined) throw new Error(`no NAV for ${key} on ${iso} (series starts ${SCHEMES[key].inception})`);
  return v;
}

/** The benchmark fixture series (tests/fixtures/benchmarkNav.fixture.json) is the INDEX scheme's series. */
export const BENCHMARK_FIXTURE_KEY = 'INDEX';

// ---------------------------------------------------------------- investors, folios, PANs

/** Synthetic PANs: 4th letter P (individual). Clearly fictitious prefixes. */
export const INVESTORS = {
  primary:  { name: 'LENS SAMPLE INVESTOR',  pan: 'LENSP0001A', email: 'sample.investor@example.invalid', mobile: '+91 90000 00001', address: ['Flat 4B, Sample Residency', 'Fictional Road, Koramangala', 'Bengaluru 560034', 'Karnataka, India'] },
  spouse:   { name: 'SAMPLE INVESTOR SECOND', pan: 'LENSP0002B', email: 'second.investor@example.invalid', mobile: '+91 90000 00002', address: ['Flat 4B, Sample Residency', 'Fictional Road, Koramangala', 'Bengaluru 560034', 'Karnataka, India'] },
};

export function maskedPan(pan) {
  return 'XXXXX' + pan.slice(5);
}

/** Folio numbers in RTA-looking shapes. CAMS: 8-11 digits "/ 0"; KFintech: 10 digits "/ 12". Deterministic per label. */
export function folioNumber(rta, label) {
  const rng = makeRng(hashSeed('FOLIO-' + rta + '-' + label));
  if (rta === 'CAMS') return `${rng.int(10000000, 99999999)}${rng.int(10, 99)} / 0`;
  return `${rng.int(1000000000, 1999999999)} / ${rng.int(10, 99)}`;
}

// ---------------------------------------------------------------- tiny PNG (for the not-a-pdf fixture)

/** Minimal valid 8-bit grayscale PNG, w×h, uniform `fill` (0..255). */
export function makePng(w, h, fill) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable.push(c >>> 0); }
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rawRows = Buffer.alloc((w + 1) * h, fill);
  for (let y = 0; y < h; y++) rawRows[y * (w + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rawRows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
