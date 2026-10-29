// scripts/lib/amfi.mjs
// AMFI access shared by refresh-benchmark.mjs and refresh-isin-map.mjs.
//
// Only these hosts are ever contacted. A redirect to any other host aborts the run.
// No third-party mirror (mfapi.in etc.) is used: AMFI itself exposes a NAV history
// endpoint, so the mirror is unnecessary (see 02-database-design.md, "Bundled datasets").

export const AMFI_HOSTS = new Set(['www.amfiindia.com', 'portal.amfiindia.com', 'amfiindia.com']);

/** Daily NAV file with the full scheme master (SEBI category in section headers, ISINs per plan). */
export const NAVALL_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';

/** NAV history report behind https://www.amfiindia.com/net-asset-value/nav-history (HTML form). */
export const NAV_HISTORY_URL = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx';

export const AMFI_TERMS_URL = 'https://www.amfiindia.com/terms-and-conditions'; // to verify at first --apply run

/**
 * fetch() restricted to the AMFI allow-list, with manual redirect handling so a redirect
 * off-host is refused rather than followed. Retries transient failures.
 */
export async function amfiFetchText(url, { retries = 3, timeoutMs = 60000 } = {}) {
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    if (!AMFI_HOSTS.has(current.hostname)) throw new Error(`Refusing non-AMFI host: ${current.hostname}`);
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetch(current, {
          redirect: 'manual',
          signal: ctl.signal,
          headers: { 'user-agent': 'sip-lens-data-refresh (+https://github.com/ajvelhal/sip-lens)', accept: 'text/plain,*/*' },
        });
        clearTimeout(t);
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) throw new Error(`Redirect without Location from ${current}`);
          current = new URL(loc, current);
          lastErr = null;
          break; // next hop
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${current}`);
        return await res.text();
      } catch (e) {
        clearTimeout(t);
        lastErr = e;
        if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (lastErr) throw lastErr;
  }
  throw new Error('Too many redirects');
}

/**
 * Parses AMFI's semicolon-separated text files (NAVAll.txt and the history report).
 * Both carry a header row naming the columns; the column order differs between the two
 * files, so columns are mapped by name, never by position.
 *
 * Returns { header: string[], rows: object[], sections: string[] } where each row has the
 * header fields plus `_section` (the nearest preceding "Open Ended Schemes(...)"-style line)
 * and `_amc` (the nearest preceding line with no semicolons that is not a section header).
 */
export function parseAmfiTable(text) {
  const lines = text.split(/\r?\n/);
  let header = null;
  let headerIdx = {};
  let section = null;
  let amc = null;
  const rows = [];
  const sections = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!header && /scheme code/i.test(line) && line.includes(';')) {
      header = line.split(';').map((h) => normaliseHeader(h));
      header.forEach((h, i) => { headerIdx[h] = i; });
      continue;
    }
    if (!line.includes(';')) {
      if (/schemes?\s*\(/i.test(line) || /^(open|close|interval)/i.test(line)) { section = line; sections.add(line); }
      else amc = line;
      continue;
    }
    if (!header) continue;
    const cells = line.split(';');
    if (!/^\d+$/.test(cells[0].trim())) continue; // not a scheme row
    const row = { _section: section, _amc: amc };
    for (const [name, i] of Object.entries(headerIdx)) row[name] = (cells[i] ?? '').trim();
    rows.push(row);
  }
  if (!header) throw new AmfiFormatError('AMFI file has no recognisable header row (expected a line containing "Scheme Code")');
  return { header, rows, sections: [...sections] };
}

function normaliseHeader(h) {
  const s = h.trim().toLowerCase();
  if (s.startsWith('scheme code')) return 'schemeCode';
  if (s.startsWith('scheme name') || s.startsWith('nav name')) return 'schemeName'; // the history report says "NAV Name"
  if (s.startsWith('isin div payout') || s.startsWith('isin growth')) return 'isinGrowthOrPayout';
  if (s.startsWith('isin div reinvestment')) return 'isinReinvest';
  if (s.startsWith('net asset value')) return 'nav';
  if (s.startsWith('repurchase')) return 'repurchase';
  if (s.startsWith('sale price')) return 'sale';
  if (s === 'date') return 'date';
  return s.replace(/[^a-z0-9]+/g, '_');
}

/** Thrown when an AMFI response is not the expected semicolon table (e.g. an HTML redirect page). */
export class AmfiFormatError extends Error {}

/**
 * "Open Ended Schemes(Equity Scheme - ELSS)" -> { structure: 'Open Ended', sebiClass: 'Equity Scheme', subCategory: 'ELSS' }.
 * The inner text may itself contain parentheses ("Exchange Traded Funds (ETFs) - Equity ETF",
 * "Fund of Funds Scheme (Domestic) - Fund of Funds Scheme (Domestic)"), so the class and sub-category are split on
 * the first " - " (or "- " when AMFI omits the leading space, as in "ELSS- Tax Saver Fund") rather than on any hyphen.
 */
export function parseSectionHeader(section) {
  if (!section) return null;
  const m = /^(Open Ended|Close Ended|Interval Fund)\s*Schemes?\s*\((.*)\)\s*$/i.exec(section.trim());
  if (!m) return { structure: 'Unknown', sebiClass: section, subCategory: '' };
  const inner = m[2].trim();
  const split = /\s+-\s+|(?<=\S)-\s+/.exec(inner);
  const sebiClass = (split ? inner.slice(0, split.index) : inner).trim();
  const subCategory = split ? inner.slice(split.index + split[0].length).trim() : '';
  return { structure: m[1].replace(/\s+/g, ' '), sebiClass, subCategory };
}

export function isIsin(s) {
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s);
}
