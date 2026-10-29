# SIP Lens

Open-source, local-first analyser for Indian mutual fund CAS PDFs. Drop your statement, see your real returns. No server, no signup, no analytics.

## Why

Platform apps show "absolute returns", which is misleading for a SIP: 20% over five years of monthly investing is very different from 20% on one lump sum. SIP Lens reads your CAS and computes what the apps don't:

- **XIRR** per fund and for the whole portfolio, based on your actual cash flows
- **Index comparison**: what the same investments on the same dates would have returned in a Nifty 50 index fund
- **SIP discipline**: how consistently you invested
- **Allocation** across funds
- **Tax preview**: FIFO unit matching with short-term and long-term gains, using a versioned rules file

SIP Lens computes and explains. It never recommends funds or forecasts returns.

## Privacy

Everything runs in your browser tab.

- The PDF, its password, your PAN, folio numbers and all derived numbers never leave your device.
- The only network traffic is loading the static app files. A strict Content Security Policy (`connect-src 'self'`) makes any accidental network call fail loudly.
- Nothing parsed from a CAS is stored in `localStorage`, `sessionStorage`, IndexedDB or cookies. Only the theme preference is stored.

You can check this yourself: open DevTools, drop the sample PDF, and watch the Network tab.

## Which statement do I need?

SIP Lens parses the **CAMS or KFintech detailed CAS** (request type "Detailed", period "since inception"). This is not the monthly NSDL/CDSL depository statement that usually arrives by email, and it is not the RTA summary CAS, which has holdings but no transactions. The app detects both of those and explains how to request the right one. See the in-app "How to get your CAS" page.

A sample statement is in [`public/sample-cas.pdf`](public/sample-cas.pdf) so you can try the app without your own data.

## Development

Requires Node 20 or later.

```bash
npm install
npm run dev        # Vite dev server
npm test           # Vitest
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production bundle to dist/
npm run preview    # serve dist/ locally
```

Other scripts:

```bash
npm run fixtures       # regenerate synthetic fixture PDFs and golden outputs
npm run data:refresh   # refresh the bundled benchmark NAV series and ISIN map
```

The production build is static and is deployed to GitHub Pages. The base path defaults to `/sip-lens/` and can be overridden with `VITE_BASE`.

## Project layout

```
src/
  parser/         CAS text parsing (CAMS and KFintech)
  workers/        WebWorker that runs parsing and calculation off the main thread
  calculations/   XIRR, FIFO, tax, allocation, discipline, index comparison
  data/           bundled datasets (benchmark NAV, ISIN map)
  pages/          Landing, Dashboard, Report, How-to-get-CAS, Privacy
  components/     UI components
tests/
  fixtures/       synthetic CAS PDFs with golden JSON outputs
  calculations/   money-math tests
  privacy/        tests guarding the local-first rules
docs/             spec, system design, data design and UI design
scripts/          fixture generation and data refresh
```

Design documents live in [`docs/features/sip-lens-v1/`](docs/features/sip-lens-v1/): the product spec, system design, data design and UI design. [`docs/engine.md`](docs/engine.md) describes the parser and calculation engine.

## Testing and data rules

- Every function in `src/calculations/` is covered by Vitest against values cross-checked with a spreadsheet XIRR.
- Parser changes run against every fixture and are compared with golden JSON outputs.
- **Real statements never go in this repo.** Only synthetic or fully anonymised PDFs belong under `tests/fixtures/` and `public/`. `.gitignore` blocks other `*.pdf` files. Never paste the contents of a real CAS into an issue, a test or a document.

## Contributing

Issues and pull requests are welcome. Please keep to the local-first rule: a change that adds a `fetch`, `XMLHttpRequest`, `sendBeacon`, third-party script, font CDN or analytics tag will not be accepted.

## Disclaimer

SIP Lens is an analysis tool, not financial, investment or tax advice. Tax figures are a preview based on the rules in `src/calculations/taxRules.ts` (with the financial year and last-verified date shown in the app). Verify them with a qualified professional before filing. Values are as of the statement date printed in your CAS, not live prices.

## License

MIT, as declared in `package.json`.
