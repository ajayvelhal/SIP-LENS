// Source scanner shared by the privacy gate tests (design §8.3 item 1).
import fs from 'node:fs';
import path from 'node:path';

export const ENGINE_DIRS = ['src/parser', 'src/calculations', 'src/data', 'src/workers'];

/** Tokens no engine module may contain. `console.` covers the "no console.log in src" rule. */
export const ENGINE_TOKENS = [
  'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'navigator.', 'localStorage', 'sessionStorage',
  'indexedDB', 'openDatabase', 'document.cookie', 'caches.', 'importScripts(', 'new Image(', 'location.', 'window.',
  'document.', 'postMessage(', 'console.', 'Date.now(', 'new Date()',
];

/** Tokens the rest of src/ may not contain. */
export const APP_TOKENS = [
  'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'indexedDB',
  'document.cookie', 'caches.', '<script src', 'console.',
];

export interface Finding { file: string; token: string; line: number }

/** Blanks block comments (keeping line breaks so line numbers stay right) and line comments. */
export function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');
}

export function scanSource(content: string, file: string, tokens: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  const lines = stripComments(content).split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/(^|[^:'"`])\/\/.*$/, '$1');
    for (const token of tokens) if (line.includes(token)) findings.push({ file, token, line: i + 1 });
  });
  return findings;
}

export function listSources(root: string, dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(p);
    }
  };
  for (const d of dirs) walk(path.join(root, d));
  return out.sort();
}
