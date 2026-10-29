/// <reference types="vitest/config" />
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')) as { version: string };

/**
 * Dev-only CSP relaxation (design §8.1 "Dev server"): Vite's HMR client and the React refresh preamble are inline
 * scripts over a websocket, which the production policy forbids. Production HTML is served exactly as written.
 */
function devCsp(): Plugin {
  return {
    name: 'sip-lens-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
        .replace("connect-src 'self';", "connect-src 'self' ws: wss:;");
    },
  };
}

/**
 * Self-hosts pdfjs's CMaps and standard fonts under /pdfjs/ (design A24, §8.1 connect-src 'self'): served from
 * node_modules in dev, copied into dist/pdfjs at build. pdfjs only requests them on demand for CID / non-embedded fonts.
 */
function pdfjsAssets(): Plugin {
  const src = path.join(here, 'node_modules', 'pdfjs-dist');
  const folders = ['cmaps', 'standard_fonts'];
  return {
    name: 'sip-lens-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/(?:[^/]+\/)?pdfjs\/(cmaps|standard_fonts)\/([^/?#]+)/.exec(req.url ?? '');
        if (!m) return next();
        const file = path.join(src, m[1] as string, m[2] as string);
        if (!fs.existsSync(file)) return next();
        res.setHeader('content-type', 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const outDir = path.join(here, 'dist', 'pdfjs');
      for (const f of folders) {
        const from = path.join(src, f);
        if (!fs.existsSync(from)) continue;
        fs.cpSync(from, path.join(outDir, f), { recursive: true });
      }
    },
  };
}

// GitHub Pages serves the site under /<repo>/; override with VITE_BASE for a custom domain or local preview.
const base = process.env.VITE_BASE ?? '/sip-lens/';

export default defineConfig({
  base,
  plugins: [react(), pdfjsAssets(), devCsp()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  worker: {
    // ES format is required so the worker can code-split pdfjs into its own lazy chunk (design §3.3).
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-vendor')) return 'charts';
          if (id.includes('/src/calculations/')) return 'calculations';
          if (id.includes('/src/data/benchmarkNav.json')) return 'benchmarkNav';
          if (id.includes('/src/data/isinCategory.json')) return 'isinCategory';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: process.env.CI ? ['default'] : ['default'],
  },
});
