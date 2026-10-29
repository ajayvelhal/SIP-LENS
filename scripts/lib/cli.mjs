// scripts/lib/cli.mjs
// Shared helpers for the SIP Lens data scripts. Node >= 20, no dependencies.
//
// Safety rules every script in scripts/ follows (CLAUDE.md, dba.md):
//   * dry-run by default; nothing is written unless --apply is passed;
//   * every path read or written is inside the repository root (assertInsideRepo);
//   * the only network hosts ever contacted are the AMFI hosts listed in amfi.mjs;
//   * no script ever opens, copies or reads a statement PDF: the fixture generator
//     has no PDF inputs at all, and the refresh scripts only read AMFI text files.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

/** Absolute path of the repository root (the parent of scripts/). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Resolves `p` against the repo root and throws if the result escapes it.
 * Symlinks are resolved too, so a link inside the repo pointing outside is refused.
 */
export function assertInsideRepo(p) {
  const abs = path.resolve(REPO_ROOT, p);
  const real = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
  const root = fs.realpathSync(REPO_ROOT);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error(`Refusing to touch a path outside the repository: ${p}`);
  }
  return abs;
}

/** Minimal argv parser: --flag, --key=value, --key value. Unknown flags are reported by the caller. */
export function parseArgs(argv, spec) {
  const out = { _: [] };
  for (const [k, v] of Object.entries(spec)) out[k] = v.default;
  const known = new Set(Object.keys(spec));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    let [key, val] = a.slice(2).split(/=(.*)/s);
    if (!known.has(key)) throw new Error(`Unknown flag --${key}. Run with --help.`);
    const s = spec[key];
    if (s.type === 'boolean') { out[key] = val === undefined ? true : val !== 'false'; continue; }
    if (val === undefined) { val = argv[++i]; if (val === undefined) throw new Error(`--${key} needs a value`); }
    out[key] = s.type === 'number' ? Number(val) : val;
    if (s.type === 'number' && !Number.isFinite(out[key])) throw new Error(`--${key} must be a number`);
  }
  return out;
}

export function printHelp(name, summary, spec) {
  const lines = [`${name} — ${summary}`, '', 'Flags:'];
  for (const [k, v] of Object.entries(spec)) {
    const def = v.default === undefined ? '' : `  (default: ${JSON.stringify(v.default)})`;
    lines.push(`  --${k}${v.type === 'boolean' ? '' : ' <' + v.type + '>'}  ${v.help}${def}`);
  }
  lines.push('', 'Dry-run by default: prints what it would write and exits 0. Pass --apply to write.');
  console.log(lines.join('\n'));
}

export const log = {
  info: (...a) => console.log('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[FAIL]', ...a),
  plan: (...a) => console.log('[dry-run]', ...a),
};

export function gzipSize(buf) {
  return zlib.gzipSync(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), { level: 9 }).length;
}

export function fmtBytes(n) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Writes atomically (tmp + rename) inside the repo. Caller has already checked --apply. */
export function writeFileInRepo(relPath, data) {
  const abs = assertInsideRepo(relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, abs);
  return abs;
}

export function readJsonInRepoIfExists(relPath) {
  const abs = assertInsideRepo(relPath);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

/**
 * Stable JSON: 2-space indent, but arrays whose elements are all numbers (or all short strings) are
 * written on one line. Keeps dataset files diff-friendly without doubling their size.
 */
export function stableJson(value) {
  const compactArray = (a) => a.length > 0 && a.every((x) => typeof x === 'number' || (typeof x === 'string' && x.length <= 16));
  const ser = (v, indent) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    const pad = ' '.repeat(indent + 2);
    const padEnd = ' '.repeat(indent);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      if (compactArray(v)) return '[' + v.map((x) => JSON.stringify(x)).join(',') + ']';
      return '[\n' + v.map((x) => pad + ser(x, indent + 2)).join(',\n') + '\n' + padEnd + ']';
    }
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (keys.length === 0) return '{}';
    return '{\n' + keys.map((k) => pad + JSON.stringify(k) + ': ' + ser(v[k], indent + 2)).join(',\n') + '\n' + padEnd + '}';
  };
  return ser(value, 0) + '\n';
}

/** Today's ISO date (UTC). The only wall-clock read in the scripts; used for AMFI date ranges and generatedAt. */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function isoToAmfi(iso) {
  const [y, m, d] = iso.split('-');
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d}-${MON[Number(m) - 1]}-${y}`;
}

export function amfiToIso(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const MON = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  const mon = MON[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Days since 1970-01-01 for an ISO date (pure integer arithmetic, no Date timezone surprises). */
export function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function isoFromDayNumber(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
