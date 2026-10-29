# SIP Lens engine

The engine is everything under `src/parser/`, `src/workers/`, `src/calculations/` and `src/data/`. It turns the bytes of a CAMS or KFintech detailed CAS into a validated `Portfolio` and computes every number the dashboard shows. It has no React, no network, no storage and no clock (the single wall-clock read, `Portfolio.parsedAt`, is injected by the worker). Design sources: `docs/features/sip-lens-v1/01-system-design.md` (contracts) and `02-database-design.md` (types, invariants, fixtures). `src/engine.ts` re-exports the public surface for the main thread.

## 1. Pipeline

```
main thread                      worker (src/parser/pdfWorker.ts)
-----------                      --------------------------------
preflight()  -> NOT_PDF /        hello -> import('pdfjs-dist') + import('pdfjs-dist/build/pdf.worker.mjs')
MULTIPLE_FILES / FILE_TOO_LARGE        registered as globalThis.pdfjsWorker so pdfjs runs in THIS thread (A24)
createClient().open(bytes)  ---> openAndParse() (src/parser/pipeline.ts)
                                   1 getDocument({data, isEvalSupported:false})  password? -> needs-password loop
                                   2 numPages > 400 -> TOO_MANY_PAGES
                                   3 per page: getTextContent -> items -> rows (textExtract.ts); page.cleanup(); progress
                                   4 after page 3: detectDocumentType() -> NO_TEXT | DEPOSITORY_CAS | NOT_CAS | continue
                                   5 dropPageFurniture() -> parseRows() (casParser.ts): typed rows -> state machine
                                        -> sections -> buildFolio() (reconcile.ts) -> Funds -> Portfolio
                                   6 zero sections -> NOT_CAS; sections but no dated rows -> SUMMARY_CAS; else result
```

`tests/helpers/pdfjsNode.ts` drives the identical `openAndParse` with pdfjs's legacy build in Node, so the golden tests exercise the same code path as the app, except the pdfjs build itself (modern in the worker, legacy in Node).

### 1.1 Text extraction (`textExtract.ts`)

- Each pdfjs text item becomes `{str, x, y, w, h}` with `y` flipped to top-down and rounded to 0.5 pt. Empty strings and the zero-height spacer items pdfjs emits are dropped.
- Rows: items sorted by `y`, clustered when `|Δy| ≤ 0.45 × median item height`; inside a row items are sorted by `x` and merged into one cell when the gap is below `0.6 × average character width` (a space is inserted when the gap exceeds a quarter of a character).
- A cell is **numeric** when it is entirely one printed number: Indian grouping, optional decimals, a leading minus or parentheses for negatives (E50).
- Page furniture (E52): any row with a `Page N of M` cell, and on multi-page documents any row whose digit-masked text sits at the same `y` on every page.
- Dates: `dd-Mon-yyyy` and `dd/mm/yyyy`, calendar-validated, years 1990–2199 (V-8).

### 1.2 Detection (`detect.ts`)

On the upper-cased text of pages 1–3, in order: fewer than 200 non-space characters → `NO_TEXT`; NSDL markers (`NSDL`, `NATIONAL SECURITIES DEPOSITORY`, `CAS ID`, or `DP ID` with `CLIENT ID`) → `DEPOSITORY_CAS/NSDL`; CDSL markers (`CDSL`, `CENTRAL DEPOSITORY SERVICES`, `BO ID`, `MYEASI`) → `DEPOSITORY_CAS/CDSL`; otherwise both an RTA marker (CAMS, Computer Age Management Services, CAMSOnline, myCAMS, KFintech, KFin Technologies, Karvy, MF Central) and a CAS marker (`CONSOLIDATED ACCOUNT STATEMENT`, or `FOLIO NO` and `PAN` on one page) are required, else `NOT_CAS`. The issuer is the RTA whose marker appears first in reading order on page 1 (Karvy → `KFINTECH`).

### 1.3 Row typing and the state machine (`casParser.ts`)

Every row is typed first: `dated` (first cell is a date), `folio` (`Folio No: …`), `opening`, `closing` (`Closing Unit Balance … NAV on <date>`), `valuation` (`Market Value on <date>`, `Cost Value`), `columns` (the `Date / Transaction / Amount / Units / NAV / Unit Balance` header, which calibrates the numeric column anchors), scheme headers (`scheme-cams`: a name with `(Advisor: …)` / `Registrar : …` on the same line; `scheme-meta`: the KFintech second line carrying ISIN, advisor and registrar; `isin-only`), `period`, and `text`. A pre-pass marks the text row before a scheme header as `amc` and, for the KFintech layout, the text row before the meta line as `scheme-name`.

The walk then follows design §3.4: `doc → folio → scheme → txn → closed`. Inside `txn`, a dated row drafts a transaction (numeric cells assigned to the nearest calibrated anchor by their right edge; a cell farther than 30 pt or two cells on one anchor raise `COLUMN_DRIFT`), an undated row continues the previous description and, when the previous row has no numbers yet, supplies them (KFintech prints numbers on the last wrapped line; page breaks split rows the same way, E51). A section without a closing row ends when the next header appears (`NO_CLOSING_BALANCE`).

Scheme names lose the RTA code prefix (`LCG-`, `128TSDGG-`), the advisor and the registrar; plan and option are kept. Fund identity is the ISIN, else `name:<normalised name>|<folio>` (A22, P1). The same folio + scheme header seen twice contributes one folio and a `DUPLICATE_SECTION` warning (E53). The statement date is the period line's end date; without a period line it is the latest transaction date with `MISSING_STATEMENT_DATE`, and the period collapses to that date (E54, D7); a folio whose printed valuation date differs from the statement date carries `valuationDate`. The investor name is the first all-caps text row before the first folio; `investorCount` is the number of distinct PANs seen in folio headers (PANs themselves are discarded; `MULTI_PAN` when more than one).

### 1.4 Classification (`classify.ts`)

An ordered table on the upper-cased description; first match wins: stamp duty → STT/TDS → reversal/reject → segregated → switch in → switch out → dividend reinvest → dividend payout → SIP → redemption/SWP → purchase/NFO → bonus/merger/transfer/transmission (`unit_adjustment`) → `unknown`. A bare `IDCW`/`Dividend` row is a reinvestment when it carries units and `amount ≈ units × NAV`, otherwise a payout (E17).

### 1.5 Reconciliation (`reconcile.ts`)

Per folio, in this order:

1. **Reversal pairing**: a `reversal` row pairs with the nearest earlier row of the same |amount| (±0.005) and |units| (±0.0005) and opposite sign; both become `excludedFromCashflows`. No match → `ORPHAN_REVERSAL` (flag). A negative stamp-duty row reverses an earlier equal levy (AD5), else `ORPHAN_LEVY`.
2. **Levy attachment**: `stamp_duty` attaches to the nearest earlier same-day purchase-like row (purchase, SIP, switch-in, reinvestment); `stt_tds` to the nearest earlier same-day redemption-like row. No parent → `ORPHAN_LEVY` (info); the levy then counts as its own outflow.
3. **Row checks**: `unknown` → `UNCLASSIFIED_ROW`; date after the statement date → `FUTURE_DATED_ROW` (levies too, P13); arithmetic (V-3): purchase-like `|amount − units × NAV| ≤ NAV × 0.5 × 10⁻ᵈᵖ + 0.011`, redemption-like `−0.011 ≤ |units| × NAV − |amount| ≤ 3% + 0.011` (exit load), and sign conventions → otherwise `COLUMN_DRIFT`.
4. **Running balance** (V-1): at the printed precision (3 or 4 dp, taken from the first units cell), `|balanceᵢ − (previous balance + unitsᵢ)| ≤ 2 × 10⁻ᵈᵖ` (A2); the first violation is `firstMismatchRow`.
5. **Closing balance** (V-2): `|opening + Σ units − printed closing| ≤ 2 × 10⁻ᵈᵖ`, else `UNIT_MISMATCH`.

`Fund.mayBeIncomplete` is true when any folio reconciliation is not `ok` or any `flag` warning references the fund. Flag codes: `UNCLASSIFIED_ROW`, `UNIT_MISMATCH`, `NO_CLOSING_BALANCE`, `ORPHAN_REVERSAL`, `FUTURE_DATED_ROW`, `COLUMN_DRIFT`, `PAGE_EXTRACT_FAILED`. Info codes: `ORPHAN_LEVY`, `MISSING_ISIN`, `MISSING_STATEMENT_DATE`, `DUPLICATE_SECTION`, `MULTI_PAN`.

### 1.6 Worker protocol (`protocol.ts`, `pdfWorker.ts`, `workers/client.ts`)

Requests: `hello`, `open` (bytes transferred, optional first password), `password`, `cancel`, `reset`. Events: `ready`, `needs-password` (reason `required`/`incorrect`, attempt counter, no limit), `opened`, `progress` (per page; a final `parse` event at `pageCount`), `detected`, `partial-warning`, `result`, `error`, `cancelled`, `reset-done`. The worker holds one document; a second `open` cancels the first. The password string is held only until pdfjs is called. The client drops events whose `requestId` is not the active one, surfaces `worker.onerror` as `WORKER_CRASH` and terminates, and `reset()` sends `cancel` + `reset` and resolves on `reset-done`.

## 2. Calculations

All functions are pure, take the statement date (`asOf`) explicitly and never read the clock. Rounding is round-half-away-from-zero at the stated precision, once, at the boundary; long sums use Neumaier compensation (`money.ts`). Calendar arithmetic (`dates.ts`) works on `YYYY-MM-DD` strings with month-end clamping.

### 2.1 Cashflows (`cashflows.ts`)

Investor perspective: negative = money left the investor. Per transaction, with `amt = |amount|`:

| Kind | Cashflow |
|---|---|
| purchase, sip, switch_in | `−(amt + Σ attached stamp duty)` on the row date |
| redemption, switch_out | `+(amt − Σ attached STT/TDS)`; `fractionOfHolding = |units| / units held before the row` |
| dividend_payout | `+amt` |
| dividend_reinvest | none (ignored: `dividend_reinvest`); the lot still exists for FIFO |
| orphan stamp_duty / stt_tds | `−amt` on its own date |
| reversed pairs, segregated, unit_adjustment, unknown, rows after `asOf` | none; listed in `ignored` with a reason |
| terminal | `+ round2(closingUnits × closingNav)` on `asOf`, omitted when units are 0 or the NAV is unknown |

Sorted by date, outflows before inflows on the same day, then document order. `totals.invested` is Σ outflows (positive), `redeemed` Σ inflows. For the pooled series, funds flagged `mayBeIncomplete` and funds holding units without history (any `openingUnits > 0`, E43/D5) are skipped and listed in `skippedFundIds`; `fundSeries()` passes `includeIncomplete` and `includeOpeningBalance` so a fund's own card and drawer always show its flows.

### 2.2 XIRR (`xirr.ts`)

Spreadsheet `XIRR()` semantics: `t_i = days(d_min → d_i) / 365`, `f(r) = Σ a_i (1+r)^(−t_i)` evaluated as `exp(−t·log1p(r))`. Steps: drop zero flows; fewer than two → `insufficient/fewer-than-two`; one date → `same-day`; no sign change → `same-sign`. Evaluate `f` on `BRACKET_GRID = [−0.9999 … 100]`, collect adjacent sign changes; none → `no-convergence/no-bracket`. In each bracket, Newton from the midpoint (max 50 iterations, tolerance 1e-10) falls back to bisection when an iterate leaves the bracket or `f'` vanishes; several roots → the one nearest zero with `warning: 'multiple-roots'`. `rate` is a decimal per year, unrounded. A fund with an opening balance and no history returns `insufficient/opening-balance-without-history` from `fundXirr()`.

### 2.3 Discipline (`discipline.ts`)

Per fund-folio, instalments are rows of kind `sip` (evidence `description`), or runs of ≥ 3 `purchase` rows of equal amount (±1%) at weekly (6–8 days), monthly (28–35) or quarterly (85–95) spacing allowing one skipped slot (evidence `pattern`). The instalment amount is the bank debit: printed amount plus attached stamp duty. Frequency is the modal spacing bucket. Expected dates run from the first instalment's month to `asOf` on the modal day-of-month (clamped to month end; weekly on the modal weekday). Each expected date greedily matches the nearest unmatched instalment within 7 days. Step-ups (A18): a new amount recurring for 3 consecutive instalments becomes a new `amounts` entry from that date; one-off amounts keep the amount in force. The SIP is `stopped` when the last instalment is more than two periods before `asOf`; unmatched expected dates after it are `stopped`, earlier ones `missed`. `percent = round(100 × Σ amount(made) / Σ amount(made + missed))`; the portfolio score is the same ratio over all SIPs (amount-weighted, A19), `null` when no SIP exists. `missedSipCost()` values each missed amount at a NAV interpolated linearly in time between the fund's neighbouring transaction NAVs (closing NAV after the last one), grown to the closing NAV.

### 2.4 Index comparison (`indexCompare.ts`)

The investor's own flows are shadow-invested in the benchmark: an outflow buys `|amount| / NAV` benchmark units at the NAV on or before that date (previous business day on holidays); an inflow with `fractionOfHolding = p` sells `p` of the shadow units **of that fund** (sub-accounts per fund, so a pooled comparison stays proportional, A6); a dividend payout sells the same rupees, clamped at what the shadow holds (E60, marks `partial`). Flows before the series start or more than 45 days after its end are excluded and summed in `excludedAmount` (`partial`). Between the series end and 45 days after it, the last NAV is carried forward and `carriedForwardDays` reported; a statement date beyond that → `unavailable/series-too-old`. `valueDifference = (shadow terminal + shadow cash received) − (actual terminal + actual cash received)`, rounded to the rupee; `gapPoints = benchmark XIRR − your XIRR`.

### 2.5 FIFO and tax (`fifo.ts`, `tax.ts`, `taxRules.ts`)

Lots: purchase, SIP, switch-in and reinvestment rows (not reversed, on or before `asOf`) with `costPerUnit = (amount + attached stamp duty) / units` (6 dp); bonus/merger units at the printed NAV or a zero-cost lot; an opening balance becomes a synthetic lot dated at the statement period start. Redemptions and switch-outs consume units oldest first (same day by row order), remainders kept at 4 dp.

Per lot, `gain = round2((closingNav − costPerUnit) × units)`; term `long` iff `asOf > acquiredOn + 12 months` (exactly 12 months is short), ELSS lots `locked` while `asOf < acquiredOn + 36 months` with `unlockOn`, synthetic/zero-cost lots `unknown-holding` (excluded with a note). Equity (taxClass `equity`, which includes aggressive hybrid and arbitrage per A15): short-term and long-term gains netted separately across the portfolio; `exemptionApplied = min(₹1.25L, max(0, LT net))`; `LT tax = (LT net − exemption) × 12.5%`, `ST tax = max(0, ST net) × 20%`, each rounded to the rupee; `estimatedTaxIfRedeemed` is their sum. Debt (incl. overseas FoF and gold) reports the gain with "taxed at your income-tax slab" and no rupee tax; `hybrid-other` reports the gain as "not computed". Funds with an unknown ISIN, `mayBeIncomplete`, or no closing NAV are excluded with a reason. Every rate, threshold and period comes from `TAX_RULES` (FY2026-27, `status: 'to-verify'`, `verifiedBy` empty); `rulesForDate(asOf)` selects by the statement date's FY and falls back to the latest entry with `exactFy: false`.

### 2.6 Allocation (`allocation.ts`)

Σ printed `closingValue` per category from `categoryOf(isin)`; buckets Equity, Hybrid, Debt, Other, Unclassified; percent to 1 dp.

## 3. Data (`src/data/`)

`benchmarkNav.json` (UTI Nifty 50 Index Fund – Direct Plan – Growth, AMFI code 120716, ISIN INF789F01XA0; columnar `dayOffsets`/`nav` since `epoch`) and `isinCategory.json` (ISIN groups by `[category, subCategory, taxClass, isElss]` tuple, 24 synthetic fixture ISINs listed under `synthetic`) are imported lazily in their own chunks. Loaders check `schemaVersion === 1` and treat a mismatch as "dataset absent". The AMFI history endpoint only serves data from 9 May 2023, so the bundled benchmark starts there; earlier cashflows are excluded from the comparison and the excluded amount is stated (US-28).

## 4. Error codes

| Code | Raised by | Meaning |
|---|---|---|
| `NOT_PDF`, `MULTIPLE_FILES`, `FILE_TOO_LARGE` | `preflight()` (main thread) | no `%PDF-` in the first 1 KB; more than one file; > 50 MB |
| `PDF_CORRUPT` | pipeline/open | pdfjs could not open the file (not a password problem) |
| `TOO_MANY_PAGES` | pipeline/open | more than 400 pages |
| `NO_TEXT` | detect | fewer than 200 characters on pages 1–3 (scan) |
| `DEPOSITORY_CAS` | detect | NSDL / CDSL statement (`depository`) |
| `NOT_CAS` | detect / walk | no RTA + CAS markers, or no folio sections |
| `SUMMARY_CAS` | walk | scheme sections with valuation rows and no transactions (`issuer`, `schemeNames`, `statementDate`) |
| `CANCELLED` | pipeline | cancelled at the password prompt or between pages |
| `WORKER_CRASH` | client / worker | uncaught worker error, ready timeout, pdfjs failed to load |
| `INTERNAL` | pipeline | caught exception; `stage` and the error class name only |
| `NO_FOLIOS_PARSED`, `UNSUPPORTED_BROWSER` | reserved for the UI | not produced by the engine today |

`ParseError.message` is always the UI key `ui.error.<CODE>`; the UI maps it to the spec's wording.

## 5. Tests

`npm test` runs: golden-output comparison for all 22 parsed and 7 pdfjs-rejected fixtures (`tests/parser/golden.test.ts`; the not-a-PDF fixture goes through `preflight`), structural invariants V-9 to V-12 and the manifest fence V-17, detection / classification / lexer units, password, cancel, corrupt, page-limit and page-failure flows, client protocol behaviour, determinism (parse twice, byte-identical JSON) and performance (103-page fixture under 8 s), calculation tests against every golden's pinned cashflows, XIRR, discipline and tax lots plus the register's edge cases, the source-grep and runtime-stub privacy gates over `src/parser`, `src/calculations`, `src/data` and `src/workers`, and dataset validation (V-15, V-16, size budgets, tax-rules config).
