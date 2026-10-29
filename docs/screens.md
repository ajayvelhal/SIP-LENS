# SIP Lens screens and states (stage 5)

Source of truth for design: `docs/features/sip-lens-v1/03-ui-design.md`. This file records what was built.

## Screen and state inventory

| Id | Screen | AppState / route | Component |
|---|---|---|---|
| S1 | Landing (and engine-loading sub-state) | `landing`, `loading-engine` | `pages/LandingPage`, `landing/DropZone`, `landing/PrivacyLine` |
| S2 | Password prompt | `needs-password` | `parse/PasswordPrompt` |
| S3 | Parse progress | `parsing` | `parse/ParseProgress` |
| S4 | Error panels (one per code, incl. NO_TEXT scan wording) | `rejected` | `errors/ErrorPanel` |
| S4b | How to get your CAS (drawer and page) | drawer over any state; `#/how-to-get-your-cas` | `help/HowToGetCas`, `pages/HowToGetCasPage` |
| S5 | Dashboard (+ S5a empty state) | `dashboard` | `pages/DashboardPage`, `dashboard/*` |
| S6 | XIRR explainer (auto-opens once per session, module-level flag) | dashboard | `dashboard/XirrExplainer` |
| S7 | Cash-flow drawer, portfolio or per fund | dashboard | `dashboard/CashflowDrawer` |
| S8 | SIP discipline and its sheets | dashboard | `discipline/*` |
| S9 | vs Nifty 50 index fund | dashboard | `comparison/*` |
| S10 | Tax preview | dashboard | `tax/TaxSection` |
| S11 | Report a parsing issue | `#/report` | `pages/ReportPage` |
| S12 | Privacy | `#/privacy` | `pages/PrivacyPage` |
| S13 | Unsupported browser | `unsupported-browser` | `pages/UnsupportedBrowserPage` |
| S14 | Share card | NOT BUILT | n/a |

Shared primitives live in `src/components/ui/` (AppBar, Button, Dialog/Drawer/BottomSheet, DataTable, Tile, Money, Percent, Banner, Disclosure, SegmentedControl, LiveRegion, Footer and others). Routing is `App.tsx` + `hooks/useHashRoute`; parser state is `hooks/useCasParser` + `app/state.ts`.

## Accessibility notes

- Every full-page screen has one `<h1>` that receives focus on mount (landing, error panels, privacy, report, unsupported browser, and since this stage the How-to page).
- Dialogs, drawers and sheets trap focus, close on Escape and return focus to their opener (verified for the fund cash-flow drawer: focus returns to "How we computed this").
- The auto-opened XIRR explainer does not steal focus (per design); Escape closes it.
- Wide tables in the Discipline and Comparison sections have sr-only table equivalents so the phone layout has no horizontal page scroll.
- A `LiveRegion` announces progress and state changes. Theme control is a labelled radio group (System, Light, Dark).
- Colour is never the only carrier of gain/loss (glyph and words accompany it).

## Deviations from the design

1. Share card (S14, Could priority) is not built.
2. Summary tile numbers are smaller on phone than design 4.5.4 (which specifies 32 px at 360 px) because the larger size overflowed the tile with lakh-crore amounts. Changed in `ui/Money.tsx` and `dashboard/SummaryTiles.tsx`.
3. The How-to page heading is an `<h1>` (design table leaves the level to the page); the drawer variant keeps `<h2>`/title.

## Assumptions

- Verification used the production build served by `npm run preview` (http://localhost:4173/sip-lens/), not the dev server.
- Browser: headless system Chrome via the repo's `playwright-core`. Safari and Firefox were not exercised.
- The favicon is an inline `data:` SVG in `index.html` so no extra request is made and no binary asset is needed.
- Unsupported-browser state was triggered by deleting `Array.prototype.at` before load; real old browsers were not tested.
- Only `sip-lens.theme` is written to localStorage (the one permitted preference); choosing "System" removes it.
