// Source grep gate (design §8.3 item 1; CLAUDE.md "local-first is non-negotiable"): fails on any network, storage,
// DOM or clock API in the engine folders, with an allow-list whose every entry must be justified and used.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_TOKENS, ENGINE_DIRS, ENGINE_TOKENS, listSources, scanSource, type Finding } from './scan';
import { REPO_ROOT } from '../helpers/pdfjsNode';

interface AllowEntry { file: string; token: string; reason: string }
const allow = (JSON.parse(fs.readFileSync(path.join(__dirname, 'allowlist.json'), 'utf8')) as { entries: AllowEntry[] }).entries;

describe('no network, storage, DOM or clock APIs in src/parser, src/calculations, src/data, src/workers', () => {
  const files = listSources(REPO_ROOT, ENGINE_DIRS);
  it('scans a non-trivial set of engine files', () => {
    expect(files.length).toBeGreaterThan(15);
  });
  const allFindings: Finding[] = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    it(rel, () => {
      const findings = scanSource(fs.readFileSync(file, 'utf8'), rel, ENGINE_TOKENS)
        .filter((f) => !allow.some((a) => a.file === rel && a.token === f.token));
      allFindings.push(...findings);
      expect(findings).toEqual([]);
    });
  }
  it('every allow-list entry carries a justification and is actually used', () => {
    for (const a of allow) {
      expect(a.reason.length, `${a.file}:${a.token}`).toBeGreaterThan(20);
      const file = path.join(REPO_ROOT, a.file);
      expect(fs.existsSync(file), a.file).toBe(true);
      const hits = scanSource(fs.readFileSync(file, 'utf8'), a.file, [a.token]);
      expect(hits.length, `unused allow-list entry ${a.file}:${a.token}`).toBeGreaterThan(0);
    }
  });
});

describe('the rest of src/ (smaller list)', () => {
  const engine = new Set(listSources(REPO_ROOT, ENGINE_DIRS));
  const files = listSources(REPO_ROOT, ['src']).filter((f) => !engine.has(f));
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    it(rel, () => {
      const findings = scanSource(fs.readFileSync(file, 'utf8'), rel, APP_TOKENS)
        .filter((f) => !allow.some((a) => a.file === rel && a.token === f.token));
      expect(findings).toEqual([]);
    });
  }
});

describe('the gate itself fails on an offending file (negative test, E7 work package)', () => {
  it('flags fetch, storage, beacon, websocket, cookie and clock tokens', () => {
    const snippet = [
      "const r = await fetch('https://evil.example');",
      'localStorage.setItem("pan", pan);',
      'navigator.sendBeacon(url, body);',
      'new WebSocket(url);',
      'document.cookie = "x";',
      'const t = Date.now();',
      'console.log(statement);',
    ].join('\n');
    const tokens = scanSource(snippet, 'src/parser/evil.ts', ENGINE_TOKENS).map((f) => f.token);
    expect(tokens).toEqual(expect.arrayContaining(['fetch(', 'localStorage', 'navigator.', 'sendBeacon', 'WebSocket', 'document.cookie', 'Date.now(', 'console.']));
  });
  it('ignores tokens inside line comments', () => {
    expect(scanSource('// never fetch( anything', 'x.ts', ENGINE_TOKENS)).toEqual([]);
  });
});
