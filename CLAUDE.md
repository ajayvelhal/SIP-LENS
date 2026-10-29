# CLAUDE.md — SIP Lens

Open-source, local-first analyser for Indian mutual fund CAS PDFs. Single Vite + React 18 + TypeScript app, deployed as static files to GitHub Pages. There is no backend, no database and no analytics, and that is a product rule, not a current limitation.

## Rules
- **Local-first is non-negotiable.** No code path may send PDF bytes, parsed transactions, PAN, folio numbers, email addresses or derived portfolio numbers over the network. The only network traffic is the static asset load. Any PR that adds a `fetch`, `XMLHttpRequest`, `sendBeacon`, third-party script, font CDN or analytics tag must say so and be rejected unless the user approves it explicitly.
- **No persistence of financial data.** No `localStorage`, `sessionStorage`, IndexedDB or cookies holding anything parsed from a CAS. UI preferences (theme) are the only allowed stored values.
- **Real statements never enter the repo.** Only synthetic or fully anonymised CAS PDFs go under `tests/fixtures/` and `public/`. `.gitignore` blocks `*.pdf` outside those folders. Never paste a real CAS's contents into a chat, a test or a document.
- **Money math is tested, not eyeballed.** Every function in `src/calculations/` has Vitest coverage against values cross-checked with a spreadsheet XIRR. Parser changes run against every fixture with golden JSON outputs.
- **No financial advice.** The product computes and explains; it never recommends funds or forecasts returns. Tax output carries the disclaimer from the spec.
- **Verify in the browser.** Frontend work is reported as verified only after exercising the flow with the sample PDFs at phone and desktop widths, in light and dark mode, with the console and network panel open and empty of errors and of any non-static request.
- Commit only when the user asks.

## Commands
```bash
npm install
npm run dev        # Vite dev server
npm test           # Vitest
npm run build      # production bundle to dist/
npm run preview    # serve dist/ locally
```

## Agents and the feature pipeline
Six project agents live in `.claude/agents/`: `product-manager`, `system-design`, `dba` (data design: domain types, bundled datasets, fixtures), `ui-design`, `backend-engineer` (the parser and calculation engine), `ui-developer`. Run them in that order with `/feature-pipeline`; each stage writes to `docs/features/<slug>/` and the next stage reads it. Stage 0 ends in an explicit user approval and nothing runs past it without the `Approved by:` line in `00-spec.md`.
