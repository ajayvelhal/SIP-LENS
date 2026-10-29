# SIP Lens v1.0 — Data design

Input: `docs/features/sip-lens-v1/00-spec.md` (approved) and `docs/features/sip-lens-v1/01-system-design.md` (authoritative for type names, module contracts, the edge-case register and assumptions A1 to A28).
Downstream readers: `backend-engineer` (work packages E1 to E6), `ui-developer` (F2 sample and fixtures), `ui-design` (what each flag means on screen).
Work packages covered: D1 (domain model and fixture corpus), D2 (bundled datasets; tax-rules content handed to E6), D3 (sample CAS).

There is no database. The classic concerns translate as follows and each has its own section: **normalisation** is the shape of the parsed `Portfolio` (§1); **integrity** is the set of invariants the parser must prove and the validators that check them (§2); **reference data** is the bundled benchmark series and ISIN map with their refresh scripts (§3); **test data** is the synthetic fixture corpus with golden outputs (§4); **migration** is schema versioning of every persisted-shaped object (§5); **capacity** is the growth scenario (§6).

Conventions: dates are `ISODate` strings (`YYYY-MM-DD`); money is rupees to 2 dp; units are at the statement's printed precision (3 or 4 dp); "dp" is decimal places; "asOf" is the statement date. Nothing in this document, in `scripts/` or in `tests/fixtures/` is derived from a real statement.

---

## 0. Deltas to the system design and pinned conventions

The §4.1 types are lifted unchanged (§7 of this document is the literal file). Everything below is **additive**; nothing is renamed or removed.

### 0.1 Deltas (type or shape changes)

| # | Delta | Where | Why |
|---|---|---|---|
| D1 | `Fund.alsoPrintedAs?: string[]` added | `src/parser/types.ts` | E26 says the card lists "also printed as: <old name>" for one ISIN printed under two names; the design had no field to carry it. |
| D2 | The golden file is a wrapper `GoldenFile` around the `ParseResult` (with `parsedAt` removed), not the bare `ParseResult` | §5.5 of the design; §4.6 here | Rejected fixtures need an expected `ParseError`, every fixture needs calculation invariants, and the two very large fixtures need a digest form. One file per fixture keeps `tests/parser/golden.test.ts` to one loop. |
| D3 | `src/data/isinCategory.json` encodes ISINs **grouped by tuple** (`groups: [{ t, isins }]`) plus `isinCount`, `synthetic[]` and `source.structures`, instead of a per-ISIN map | §5.2 of the design; §3.2 here | Measured on a 13,000-ISIN synthetic master: per-ISIN map 337 KB raw / 57 KB gz (over the 320 KB raw budget); grouped 203 KB raw / 49 KB gz (within both budgets). The loader decodes to the same `categoryOf(isin)`. |
| D4 | `src/data/benchmarkNav.json` gains `schemeNameOnAmfi`, `amcCode`, `points`, `validation{}` and `source.endpoint` | §5.1 of the design; §3.1 here | UTI renamed the fund in 2022; the AMFI name must be recorded verbatim for the identity check. `validation` makes the monthly PR reviewable without re-running the script. |
| D5 | Funds with an opening balance and no history (E43) are excluded from the **portfolio** XIRR and total-invested tile, not only from their own XIRR; `buildCashflows` lists them in `skippedFundIds` | §4.3/§4.4 of the design | Pooling a fund whose opening units have no cost would understate invested and overstate the pooled XIRR. The reason is derivable (`fund.mayBeIncomplete` vs. any `folio.openingUnits > 0`), so the signature is unchanged. |
| D6 | The synthetic scheme ISINs of the fixtures and sample (namespace `INF000S01xx`) are merged into the production `isinCategory.json` and listed under `synthetic[]` | §3.2 here | The bundled sample must classify (allocation, ELSS, tax) through the identical code path (US-11), and the fixtures must not depend on real funds (no-advice rule: a demo must not appear to rate a real fund). The loader may drop `synthetic[]` in production builds if the owner prefers; the sample would then show "Unclassified". |
| D7 | `statementPeriod` when the period line is missing (E54) is `{ from: latest, to: latest }` where `latest` is the latest transaction date | §2.1 of the design | The field is required; collapsing the period to the fallback date is the only value that is not invented. |
| D8 | `Transaction.excludedFromCashflows` is also `true` for an **orphan** reversal row | §3.4 of the design | The design says both rows of a reversed pair are excluded; an unmatched reversal has no pair but equally must not become a cashflow. |
| D9 | The amount/units/NAV arithmetic check (V-3 below) raises `COLUMN_DRIFT` when it fails | §3.4 of the design | A violated `amount ≈ units × NAV` relation means the numeric cells were assigned to the wrong columns, which is what `COLUMN_DRIFT` already denotes; no new `ParseWarningCode` is needed. |

### 0.2 Pinned conventions (choices the design left open)

| # | Convention |
|---|---|
| P1 | `normalisedSchemeName` (for fund identity without ISIN, A22) = `schemeName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()`. |
| P2 | `Fund.schemeName` is the name printed on the **first** section seen for that ISIN; later distinct names go to `alsoPrintedAs`. `Transaction.schemeName` is the name printed on **its own** section header. |
| P3 | `rowIndex` in `Transaction.id` and in warnings is the 0-based index into `folio.transactions` (printed rows only; a hidden row has no index, which is why a missing row shows up as a jump at the next index). |
| P4 | `FolioReconciliation.diff = computedClosingUnits − printedClosingUnits`, rounded to `decimals`. `computedClosingUnits = openingUnits + Σ units` over every row with a units cell (reversals, segregated and bonus rows included; levy rows have no units). |
| P5 | `ParseResult.reconciliation[fundId]` takes the worst folio status in the order `mismatch > no-closing-balance > ok`. |
| P6 | `warnings` are ordered by `page`, then `rowIndex`, then `id`; the golden comparison treats them as a set keyed by `id`. |
| P7 | `Portfolio.investorName` is the first investor's name line exactly as printed and trimmed (`LENS SAMPLE INVESTOR` in every fixture); no case folding. |
| P8 | `amfiCode` is never printed by either RTA, so it is `undefined` on every `Transaction` and `Fund` in v1. The field stays for a future statement format. |
| P9 | `ParseError.message` is the UI key `ui.error.<CODE>` (e.g. `ui.error.SUMMARY_CAS`); the UI maps keys to the spec's strings. Goldens carry the key; the comparison ignores it. |
| P10 | `Folio.valuationDate` is `undefined` when the valuation row's date equals the statement date (the normal case). |
| P11 | Levy rows (`stamp_duty`, `stt_tds`) carry `amount` only: no `units`, `nav` or `unitBalance`. Dividend-payout rows carry `amount`, `nav` and the unchanged `unitBalance` but no `units`. Segregated and bonus rows carry `units` and `unitBalance` but no `amount`. |
| P12 | `unitDecimals` is the decimal count of the first units cell in the document; a document that mixes precisions sets `FolioReconciliation.decimals` per folio and `Portfolio.unitDecimals` from the first. |
| P13 | `FUTURE_DATED_ROW` is raised per row dated after `asOf`, including a levy row attached to a future-dated purchase (two warnings for one purchase with stamp duty). |
| P14 | A duplicated section (E53) contributes **one** `Folio`; the second copy contributes only the `DUPLICATE_SECTION` warning with the page of the second header. |
| P15 | Discipline counts in goldens: `counts.expected` counts every expected date up to `asOf` including stopped ones; `percent` and the score use only non-stopped expected dates (`made + missed`), amount-weighted (A19). `stoppedSince` is the first expected date after `lastObserved`. A reversed instalment is not "made" (its pair is excluded) and therefore counts as missed. |
| P16 | Statement dates of fixtures are business days; where a fixture's as-of is a Sunday the period `to` is still printed as that date and NAVs are the previous business day's (E59 for the fund NAV printed on the closing row). |

### 0.3 Assumptions added by this document

| # | Assumption | Impact if wrong |
|---|---|---|
| AD1 | AMFI scheme code **120716** = UTI Nifty 50 Index Fund – Direct Plan – Growth and ISIN **INF789F01XA0**; AMFI AMC code (`mf` parameter) for UTI = **28**. Both are "to verify at first `--apply` run": the script refuses to write unless the AMFI scheme name contains "Nifty 50", "Direct" and "Growth", and the ISIN map script fails if the benchmark ISIN is absent from the master. | A wrong code fails loudly; the fix is a flag (`--scheme-code`, `--amc-code`). Nothing else changes. |
| AD2 | AMFI's history endpoint accepts at most ~90 days per request; the script requests 90-day windows with a 400 ms pause (about 56 requests for 2013 to date). | If the cap is larger the run is merely slower; if smaller, `--chunk-days` lowers it. |
| AD3 | AMFI terms URL is `https://www.amfiindia.com/terms-and-conditions` (to verify and record the date read at first `--apply`). | Text of the licence note changes; schema does not. |
| AD4 | Stamp duty (0.005%, from 1 Jul 2020) is printed by both RTAs as a separate row on the purchase date with the purchase row showing the **net** amount; STT (0.001% on equity redemptions and switch-outs) is a separate row with the redemption row showing the gross amount. | The cashflow builder's folding rule (Q5) is unchanged either way; only fixture row values would move. |
| AD5 | A reversal of a post-2020 purchase would also print a negative stamp-duty row. The classify table (pattern 1 before pattern 3) would label it `stamp_duty` with a negative amount. v1 fixtures keep the reversed instalment before July 2020 so the case does not arise; the engine should treat a negative `stamp_duty` row whose `|amount|` equals an earlier same-folio levy as a reversal of that levy and raise `ORPHAN_LEVY` otherwise. Listed as an open item for E2. | A real statement with a reversed post-2020 SIP would show an `ORPHAN_LEVY` info and an outflow of −0.25 instead of a cancelled pair; the fund is not flagged. |
| AD6 | The RTA CAS does not print AMFI scheme codes (P8). | If a future format prints them, `schemeName.ts` fills `amfiCode` and nothing else changes. |
| AD7 | Synthetic exchange holidays are a fixed list (`SYNTHETIC_HOLIDAYS` in `scripts/lib/synthetic.mjs`) identical every year; the fixture benchmark series omits them, which is what exercises E59 in tests. The production series has the real holidays by construction. | None in production; tests only. |
| AD8 | Tax class for `FoF Overseas` is `debt` (A15) but allocation category is `Equity` (it is equity exposure); gold/silver funds are category `Other`, class `debt`; solution-oriented funds are category `Other`, class `hybrid-other`. | Only the mapping table in `refresh-isin-map.mjs` changes. Budget 2024/2025 nuances for overseas and gold funds are deliberately not modelled in v1 and are listed in `taxRules.simplifications`. |
| AD9 | Closed-ended and interval schemes are excluded from the ISIN map by default (`--include-closed` to add them). A CAS can list a matured FMP; it then shows as Unclassified, which is honest for a fund that cannot be redeemed at will. | Size budget; otherwise none. |
| AD10 | The fixture generator needs one devDependency, `pdfkit`, for the `--apply` path only (text positioning, built-in Helvetica, deflate streams and RC4/AES encryption for the protected variants; `pdf-lib` cannot write encryption). The dry-run path has no dependencies. | None for the app bundle; `pdfkit` is never imported by `src/`. |

---

## 1. Domain model

### 1.1 Shape and the normalisation decision

The parsed statement is a tree, `Portfolio → Fund[] → Folio[] → Transaction[]`, which mirrors the printed document (folio header, scheme section, rows) and the product's unit of display (the fund card). A flat `Transaction[]` with `fundId`/`folioNumber` columns was the alternative; it was rejected because every consumer (cards, drawer, FIFO, discipline) groups by fund first, and the grouping would be recomputed on every render.

Inside that tree, four columns are **deliberately denormalised** onto each `Transaction`: `rta`, `folioNumber`, `schemeName`, `isin` (and `amfiCode`). Reasons: the cashflow drawer and the CSV copy show rows without their parents; `Cashflow.transactionIds` point at rows, not funds; and the cost is about 110 bytes per row, 215 KB on the 2,000-row growth scenario (§6). The price of denormalisation is an integrity rule: V-10 requires each copied field to equal the parent's value.

No PAN, email or postal address exists anywhere in the model (US-10): the parser reads them to detect sections and discards them; `investorCount` is the only trace.

### 1.2 Types, field by field

Required unless marked optional. Signs and units are stated on every numeric field. Each type has a JSON example taken from the generated goldens.

#### `ISODate`, `Rta`, `TransactionKind`

- `ISODate`: `'YYYY-MM-DD'`, branded string, no time, no zone.
- `Rta`: `'CAMS' | 'KFINTECH'` ("Karvy" headers map to `KFINTECH`, A21).
- `TransactionKind`: closed enum of 13 members (see §7). Adding a member is a `schemaVersion` bump (§5).

#### `Transaction`

| Field | Type | Req | Meaning, units, sign |
|---|---|---|---|
| `id` | string | yes | `${fundId}:${folioNumber}:${rowIndex}` (P3). Unique within a `ParseResult`. |
| `rta` | `Rta` | yes | Copy of the folio's RTA (V-10). |
| `folioNumber` | string | yes | As printed, e.g. `4755251488 / 0`. |
| `schemeName` | string | yes | As printed on this row's section header, boilerplate removed, plan and option kept (P2). |
| `isin` | string | opt | 12 chars, when the section header printed one. |
| `amfiCode` | string | opt | Never printed by RTAs in v1 (P8). |
| `date` | `ISODate` | yes | Transaction date as printed. |
| `description` | string | yes | Exactly as printed; continuation lines joined with one space. |
| `kind` | `TransactionKind` | yes | From `classify.ts`. |
| `amount` | number | opt | Rupees, 2 dp, **signed as printed** (scheme perspective): positive for purchase, SIP, switch-in, reinvestment, levies, dividend payout; negative for redemption, switch-out; reversal carries the opposite sign of the reversed row. `undefined` when the row prints no amount (segregated, bonus, unknown). |
| `units` | number | opt | Units at printed precision, signed as printed (negative for redemption, switch-out, reversal of a purchase). `undefined` on levy, payout and unknown rows (P11). |
| `nav` | number | opt | Rupees per unit, 4 dp as printed. |
| `unitBalance` | number | opt | Running balance after the row, as printed. `undefined` on levy rows. |
| `page` | number | yes | 1-based page of the row's first line. |
| `attachedTo` | string | opt | Levy rows: id of the parent purchase-like or redemption-like row on the same date. |
| `levies` | string[] | opt | Parent rows: ids of attached levies. |
| `reverses` / `reversedBy` | string | opt | Reversal pairing. |
| `excludedFromCashflows` | boolean | yes | `true` for both rows of a reversed pair, orphan reversals (D8), `segregated`, `unit_adjustment`, `unknown`. `false` for everything else including levies (folded into parents) and `dividend_reinvest` (ignored by the builder by kind, not by this flag). |

```json
{ "id": "INF000S01FL9:1782297592 / 0:28", "rta": "CAMS", "folioNumber": "1782297592 / 0",
  "schemeName": "Lens Sample Flexi Cap Fund - Direct Plan - Growth", "isin": "INF000S01FL9",
  "date": "2021-02-10", "description": "Systematic Investment (22)", "kind": "sip",
  "amount": 9999.5, "units": 55.92, "nav": 178.8187, "unitBalance": 2109.439, "page": 1,
  "levies": ["INF000S01FL9:1782297592 / 0:29"], "excludedFromCashflows": false }
```
```json
{ "id": "INF000S01FL9:1782297592 / 0:29", "rta": "CAMS", "folioNumber": "1782297592 / 0",
  "schemeName": "Lens Sample Flexi Cap Fund - Direct Plan - Growth", "isin": "INF000S01FL9",
  "date": "2021-02-10", "description": "*** Stamp Duty ***", "kind": "stamp_duty", "amount": 0.5, "page": 1,
  "attachedTo": "INF000S01FL9:1782297592 / 0:28", "excludedFromCashflows": false }
```
```json
{ "id": "INF000S01EL2:3317842826 / 0:7", "rta": "CAMS", "folioNumber": "3317842826 / 0",
  "schemeName": "Lens Sample ELSS Tax Saver Fund - Direct Plan - Growth", "isin": "INF000S01EL2",
  "date": "2019-08-16", "description": "Systematic Investment (7) - Reversal", "kind": "reversal",
  "amount": -5000, "units": -69.57, "nav": 71.87, "unitBalance": 412.335, "page": 1,
  "reverses": "INF000S01EL2:3317842826 / 0:6", "excludedFromCashflows": true }
```

#### `Folio`

| Field | Type | Req | Meaning |
|---|---|---|---|
| `folioNumber` | string | yes | As printed. The same folio number can appear in several `Fund`s (one per scheme). |
| `rta` | `Rta` | yes | From the section's "Registrar : X" (A20). |
| `openingUnits` | number | yes | Printed "Opening Unit Balance"; `0` for folios opened in the period. `> 0` means units without history (E43). |
| `closingUnits` | number | opt | Printed "Closing Unit Balance"; `undefined` when the section has no closing row. |
| `closingNav` | number | opt | Printed "NAV on <date>". |
| `closingValue` | number | opt | Printed "Market Value"; rupees 2 dp. |
| `valuationDate` | `ISODate` | opt | Only when different from the statement date (P10). |
| `transactions` | `Transaction[]` | yes | Document order. |
| `reconciliation` | `FolioReconciliation` | yes | §2 V-1/V-2. |

```json
{ "folioNumber": "4755251488 / 0", "rta": "CAMS", "openingUnits": 0, "closingUnits": 5775.794,
  "closingNav": 40.0449, "closingValue": 231291.09, "transactions": ["… 38 rows …"],
  "reconciliation": { "status": "ok", "computedClosingUnits": 5775.794, "printedClosingUnits": 5775.794,
                      "diff": 0, "toleranceUnits": 0.002, "decimals": 3 } }
```

#### `FolioReconciliation`

| Field | Type | Req | Meaning |
|---|---|---|---|
| `status` | `'ok' \| 'mismatch' \| 'no-closing-balance'` | yes | |
| `computedClosingUnits` | number | yes | P4. |
| `printedClosingUnits` | number | opt | Absent for `no-closing-balance`. |
| `diff` | number | opt | computed − printed, at printed precision (P4). |
| `firstMismatchRow` | number | opt | Index of the first running-balance violation; absent when only the closing check fails. |
| `toleranceUnits` | number | yes | `2 × 10^-decimals` (A2). |
| `decimals` | `3 \| 4` | yes | |

```json
{ "status": "mismatch", "computedClosingUnits": 2504.567, "printedClosingUnits": 2781.858,
  "diff": -277.291, "firstMismatchRow": 32, "toleranceUnits": 0.002, "decimals": 3 }
```

#### `Fund`

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | ISIN, else `name:${normalisedSchemeName}\|${folioNumber}` (A22, P1). |
| `isin`, `amfiCode` | string | opt | |
| `schemeName` | string | yes | First printed name (P2). |
| `amc` | string | opt | AMC line above the scheme header. |
| `folios` | `Folio[]` | yes | Order of first appearance. |
| `closingUnits` | number | yes | Σ folio `closingUnits` (folios without a closing row contribute 0). |
| `closingNav` | number | opt | The common printed NAV. |
| `closingValue` | number | opt | Σ folio `closingValue`; `undefined` if no folio printed one. |
| `mayBeIncomplete` | boolean | yes | Any folio status ≠ `ok`, or any `severity: 'flag'` warning referencing the fund. |
| `alsoPrintedAs` | string[] | opt | D1. |

```json
{ "id": "INF000S01RN0", "isin": "INF000S01RN0", "schemeName": "Lens Sample Bluechip Fund - Direct Plan - Growth",
  "amc": "Orbit Sample Asset Managers", "folios": ["… folio 4759050787 / 0 …", "… folio 9448019374 / 0 …"],
  "closingUnits": 870.289, "closingNav": 199.5961, "closingValue": 173706.29, "mayBeIncomplete": false,
  "alsoPrintedAs": ["Lens Sample Large & Mid Cap Fund - Direct Plan - Growth"] }
```

#### `Portfolio`

| Field | Type | Req | Meaning |
|---|---|---|---|
| `schemaVersion` | `1` | yes | §5. |
| `issuer` | `Rta` | yes | Who generated the file (page-1 marker order). |
| `statementDate` | `ISODate` | yes | Period end, or valuation "as on" date (A10), or latest transaction date with `MISSING_STATEMENT_DATE` (E54). |
| `statementPeriod` | `{from,to}` | yes | D7 for the missing case. |
| `casGeneratedOn` | `ISODate` | opt | When printed. |
| `parsedAt` | string | yes | ISO 8601 datetime injected by the worker; **stripped from goldens**. |
| `investorName` | string | opt | P7. Never on the share card. |
| `investorCount` | number | yes | Distinct investor blocks (A3). |
| `funds` | `Fund[]` | yes | Order of first appearance. |
| `pageCount` | number | yes | |
| `unitDecimals` | `3 \| 4` | yes | P12. |

```json
{ "schemaVersion": 1, "issuer": "CAMS", "statementDate": "2019-03-29",
  "statementPeriod": { "from": "2016-01-01", "to": "2019-03-29" }, "parsedAt": "2026-10-26T09:12:44.120Z",
  "investorName": "LENS SAMPLE INVESTOR", "investorCount": 1, "funds": ["… 1 fund …"], "pageCount": 1, "unitDecimals": 3 }
```

#### `ParseWarning`, `ParseResult`, `ParseError`

`ParseWarning.id` is `${code}:${fundId ?? '-'}:${page ?? '-'}:${rowIndex ?? '-'}`. `severity: 'flag'` codes: `UNCLASSIFIED_ROW`, `UNIT_MISMATCH`, `NO_CLOSING_BALANCE`, `ORPHAN_REVERSAL`, `FUTURE_DATED_ROW`, `COLUMN_DRIFT`, `PAGE_EXTRACT_FAILED`. `severity: 'info'`: `ORPHAN_LEVY`, `MISSING_ISIN`, `MISSING_STATEMENT_DATE`, `DUPLICATE_SECTION`, `MULTI_PAN`. `folioNumber` and `schemeName` are present for the banner and stripped by `lib/report.ts`; `maskedRowText` has every digit replaced by `#`.

```json
{ "id": "UNCLASSIFIED_ROW:INF000S01FL9:2:2", "code": "UNCLASSIFIED_ROW", "fundId": "INF000S01FL9",
  "folioNumber": "7871506340 / 0", "schemeName": "Lens Sample Flexi Cap Fund - Direct Plan - Growth",
  "page": 2, "rowIndex": 2, "maskedRowText": "Lien Marked - Loan Against Units", "severity": "flag" }
```

`ParseResult.stats.rows` is the extractor's row count (informational; not compared). `extractMs`/`parseMs` are measured (not compared).

```json
{ "portfolio": "…", "warnings": ["…"], "reconciliation": { "INF000S01LC6": "mismatch", "INF000S01GL7": "no-closing-balance", "INF000S01SM0": "ok" },
  "stats": { "pages": 5, "rows": 367, "transactions": 219, "unclassified": 1, "folios": 6, "funds": 6, "extractMs": 0, "parseMs": 0 } }
```
```json
{ "code": "SUMMARY_CAS", "message": "ui.error.SUMMARY_CAS", "issuer": "CAMS",
  "schemeNames": ["Lens Sample Large Cap Fund - Direct Plan - Growth", "Lens Sample ELSS Tax Saver Fund - Direct Plan - Growth"],
  "statementDate": "2025-03-31" }
```

#### Dataset file types (`src/data/types.ts`, new)

`BenchmarkNavFile` (§3.1) and `IsinCategoryFile` (§3.2) are the on-disk shapes; `BenchmarkSeries` (design §4.7) and `CategoryInfo` (design §4.8) are the loaded shapes. Both files carry `schemaVersion: 1`.

#### Golden types (`tests/parser/goldenTypes.ts`, new; also in §7)

`GoldenFile`, `FixtureMeta`, `FixtureInvariants` and `FixtureManifest`: §4.6.

---

## 2. Invariants and validators

Each invariant names what must hold after parsing, how it is checked (in the worker by `reconcile.ts`, in tests by `tests/parser/invariants.test.ts` over every golden, or in the generator), and what the user sees when it fails. "Flag" means the fund gets `mayBeIncomplete`, the banner appears and the fund leaves the XIRR tile (US-08).

| # | Invariant | Check | On failure |
|---|---|---|---|
| V-1 | **Running balance.** For every row `i` with a printed `unitBalance`: `\|unitBalance_i − (unitBalance_prev + (units_i ?? 0))\| ≤ 2 × 10^-dp`, where `unitBalance_prev` is the last printed balance before `i` (levy rows have none) or `openingUnits`. | `reconcile.ts` step 4, per folio; tests re-run it over every golden. | `UNIT_MISMATCH` (flag) with `firstMismatchRow`; banner; card "may be incomplete"; report payload says "gap after row k". |
| V-2 | **Closing balance.** `\|openingUnits + Σ units − closingUnits\| ≤ 2 × 10^-dp` (P4). Missing closing row → `no-closing-balance`. | `reconcile.ts` step 5. | `UNIT_MISMATCH` (flag) with the closing row's page and no `rowIndex`; or `NO_CLOSING_BALANCE` (flag): value unknown, fund excluded from the value tile with the footnote "N funds without a printed value excluded". |
| V-3 | **Amount equals units × NAV within rounding.** Purchase-like rows (`purchase`, `sip`, `switch_in`, `dividend_reinvest`): `\|amount − units × nav\| ≤ nav × 0.5 × 10^-dp + 0.01` (units were rounded to dp from amount/nav; amount to the paisa). Redemption-like rows (`redemption`, `switch_out`): `0 ≤ \|units\| × nav − \|amount\| ≤ 0.03 × \|units\| × nav + 0.01` (the shortfall is the exit load, at most 3%). The design's "within 0.5%" is the outer bound for purchase-like rows; the strict form above is what the fixtures satisfy exactly. | `reconcile.ts` after classification (cheap); tests over goldens. | `COLUMN_DRIFT` (flag, D9): the row's amount is not trusted; the fund is incomplete. |
| V-4 | **Levy attachment.** Every `stamp_duty` has a same-date purchase-like parent in the same folio, every `stt_tds` a same-date redemption-like parent; `attachedTo` and `levies` are mutually consistent. | `reconcile.ts` steps 2–3; tests check both directions. | `ORPHAN_LEVY` (info): the levy becomes its own outflow on its date (cash did leave); fund not flagged (E21). |
| V-5 | **Sign conventions.** Parser (as printed): purchase-like `amount > 0`, `units > 0`; redemption-like `amount < 0`, `units < 0`; `dividend_payout` `amount > 0`, no `units`; levies `amount > 0`; a reversal row has the opposite signs of the row it reverses and `\|amount\|`, `\|units\|` equal within 0.005 / 0.0005. Calculations (investor perspective, `cashflows.ts`): outflows negative, inflows positive, terminal positive; `Σ outflows` of the series equals the "Total invested" tile. | Parser asserts after classification; `tests/calculations/cashflows.test.ts` compares the builder's series to `invariants.funds[id].cashflows` in each golden. | A sign violation in the parser is `COLUMN_DRIFT` (the amount landed in the wrong column or a parenthesised negative was missed, E50). A builder mismatch is a failing test, never a UI state. |
| V-6 | **No row after the statement period end unless flagged.** `transaction.date ≤ statementDate` or the row carries `FUTURE_DATED_ROW`. | `reconcile.ts`; tests. | `FUTURE_DATED_ROW` (flag): row ignored with reason `future_dated`, fund XIRR suppressed (A27). |
| V-7 | **Schema version present.** `portfolio.schemaVersion === 1`; every bundled dataset and golden carries its own `schemaVersion`/`goldenVersion`. | Worker sets it; `tests/parser/golden.test.ts` and the data loaders assert it (§5). | Worker: `INTERNAL` error with `stage: 'parse'`. Loader: dataset treated as absent (benchmark "unavailable", categories all Unclassified) with a console-free, UI-visible note "bundled data could not be read". |
| V-8 | **Dates are real and plausible.** Every `ISODate` parses, is ≥ `1990-01-01` and ≤ `statementDate + 366 days`; `statementPeriod.from ≤ to`. | `casParser.ts` date parser; tests. | Unparseable date → row is `unknown` (`UNCLASSIFIED_ROW`). Implausible → `FUTURE_DATED_ROW` or `MISSING_STATEMENT_DATE` path. |
| V-9 | **Referential integrity.** `Transaction.id` unique; `attachedTo`, `levies[]`, `reverses`, `reversedBy` resolve to rows of the same folio; `reverses`/`reversedBy` are symmetric; every `ParseWarning.fundId` is a fund id; `reconciliation` has exactly the fund ids. | Tests over goldens and over live parses in the privacy runtime gate. | Failing test (a parser bug). |
| V-10 | **Denormalised fields agree.** `tx.rta === folio.rta`, `tx.folioNumber === folio.folioNumber`, `tx.isin === fund.isin`, `tx.schemeName ∈ {fund.schemeName, …fund.alsoPrintedAs}`. | Tests. | Failing test. |
| V-11 | **Aggregates.** `fund.closingUnits = round(Σ folio.closingUnits, dp)`; `fund.closingValue = round(Σ folio.closingValue, 2)`; `fund.mayBeIncomplete` matches the rule in §1.2; `reconciliation[fundId]` is the worst folio status (P5). | Tests. | Failing test. |
| V-12 | **Stats agree.** `stats.transactions = Σ rows`, `stats.unclassified = count(kind === 'unknown')`, `stats.folios`, `stats.funds`, `stats.pages = portfolio.pageCount`. | Tests. | Failing test. |
| V-13 | **Kinds and cash.** Rows of kind `segregated`, `unit_adjustment`, `unknown` never produce a cashflow; `dividend_reinvest` never produces cash but always produces a lot; a reversed pair produces neither. | `cashflows.ts` mapping table; tests against `invariants.funds[id].ignored`. | Failing test. |
| V-14 | **Printed value is what the tile shows.** "Value as of statement date" is `Σ fund.closingValue` (printed), never recomputed from units × NAV. | `useAnalysis`; tests. | Failing test. |
| V-15 | **Benchmark series.** Dates strictly increasing; NAV > 0 with 4 dp; no day-on-day change > 20%; no gap > 7 days; `lastDate` within 7 days of generation; `points === nav.length === dayOffsets.length`; `isin` matches `^INF`. | `scripts/refresh-benchmark.mjs` (refuses to write); `tests/data/benchmark.test.ts` on the bundled file. | Script exits 2, CI job opens no PR. Loader: V-7 path. |
| V-16 | **ISIN map.** Every ISIN matches `^[A-Z]{2}[A-Z0-9]{9}\d$`; tuples index into the four arrays; no ISIN in two groups; the benchmark ISIN is present; ≤ 5% of previously bundled ISINs disappear. | `scripts/refresh-isin-map.mjs`; `tests/data/categories.test.ts`. | Script exits 2. |
| V-17 | **Golden freshness.** `MANIFEST.json` sha256 of every fixture file matches; no `*.pdf` under `tests/fixtures/` is missing from the manifest. | `tests/parser/manifest.test.ts`. | Failing test: either regenerate (`gen-fixtures.mjs --apply`) or remove the stray file. This is the guard against a real statement ever sitting in the fixtures folder. |

What the user sees is always one of the design's existing states; no invariant introduces a new screen.

---

## 3. Bundled datasets

Both datasets are static JSON under `src/data/`, loaded with the dashboard chunk, never fetched at runtime, regenerated by `.github/workflows/refresh-data.yml` through a pull request. Both scripts are dry-run by default, print what they would write, and require `--apply`. Neither reads anything outside the repository or contacts any host other than `www.amfiindia.com` / `portal.amfiindia.com` (redirects to any other host abort the run).

### 3.1 Benchmark NAV series — `src/data/benchmarkNav.json`

| Item | Value |
|---|---|
| Fund | UTI Nifty 50 Index Fund – Direct Plan – Growth (A1). AMFI scheme code **120716**, ISIN **INF789F01XA0**, AMC `mf` code **28**: all **to verify at first `--apply` run** (AD1). The script writes whatever name and ISIN AMFI returns for the code and refuses to write unless that name contains "Nifty 50", "Direct" and "Growth" (case-insensitive; `--skip-name-check` exists for a documented emergency only). |
| Source | AMFI NAV history, the form at `https://www.amfiindia.com/net-asset-value/nav-history`, backed by `https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?mf=28&tp=1&frmdt=DD-MMM-YYYY&todt=DD-MMM-YYYY`. AMFI **does** expose a history endpoint, so the mfapi.in mirror is not used anywhere, including CI. Requested in 90-day windows (AD2). |
| Licence | Embedded `source.licenceNote`: "NAV data published by AMFI (amfiindia.com) for public information. Not NSE index data. Redistributed here as a derived, bundled series with attribution; see AMFI terms at the termsUrl. This file is regenerated monthly by CI; no runtime request is made." `termsUrl` per AD3. |
| Schema | Design §5.1 plus D4. `dayOffsets[i]` = days since `epoch` (the first NAV date) for business day `i`; `nav[i]` 4 dp. Columnar so the two arrays compress independently. |
| Size | Measured on the same schema with the fixture series: 3,507 points → **47 KB raw, 22 KB gzipped** (budget 70 / 35). The real series from 1 Jan 2013 has about 3,400 points at the time of writing and grows ~250 points (≈ 3.5 KB raw) per year; the budget holds until roughly 2033. |
| Refresh | `refresh-data.yml`: cron `0 3 1 * *` (1st of each month, 03:00 UTC) and `workflow_dispatch`; runs `node scripts/refresh-benchmark.mjs --apply` then `node scripts/refresh-isin-map.mjs --apply`, runs `npm test -- tests/data`, and opens a PR with the script output in the body. Never pushes to `main`. |
| Validation | V-15; exit code 2 and no file on any failure; `--allow-gaps`, `--allow-stale` downgrade to warnings for a reviewed emergency. |
| Older than the statement | A5: ≤ 45 days after `lastDate` the last NAV is carried forward with the label "benchmark NAV carried forward N days (data ends DD Mon YYYY)"; beyond, the comparison is "unavailable" with the last bundled date and a link to the repository. Cashflows before `firstDate` are excluded and stated (US-28). |
| Loader | `src/data/benchmark.ts`: lazy `import()`, asserts `schemaVersion === 1`, builds `BenchmarkSeries.navOnOrBefore` by binary search over `dayOffsets`. |

Example head of the file:

```json
{ "schemaVersion": 1, "fundName": "UTI Nifty 50 Index Fund - Direct Plan - Growth",
  "schemeNameOnAmfi": "<verbatim AMFI name at generation>", "amfiCode": "120716", "amcCode": "28", "isin": "INF789F01XA0",
  "source": { "name": "AMFI NAV history", "url": "https://www.amfiindia.com/net-asset-value/nav-history",
              "endpoint": "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx", "termsUrl": "…", "licenceNote": "…" },
  "generatedAt": "2026-11-01T03:04:12.000Z", "firstDate": "2013-01-01", "lastDate": "2026-10-31", "epoch": "2013-01-01", "points": 3412,
  "validation": { "maxDayChangePct": 8.3, "maxGapDays": 5, "maxGapAfter": "2024-11-14", "staleDaysAtGeneration": 1 },
  "dayOffsets": [0, 1, 2, 6, 7], "nav": [10.1234, 10.1567, 10.2001, 10.1877, 10.2210] }
```

### 3.2 ISIN → category map — `src/data/isinCategory.json`

| Item | Value |
|---|---|
| Source | `https://www.amfiindia.com/spages/NAVAll.txt`, the daily file that doubles as the scheme master: section headers `Open Ended Schemes(Equity Scheme - ELSS)` carry the SEBI category, rows carry the growth/payout ISIN and the reinvestment ISIN of each plan. Columns are mapped by header name, not position (the history report orders them differently). There is no separate "scheme master" dataset: this map is the scheme master reduced to what the app needs. |
| Licence | As 3.1, with "scheme master" wording. |
| Classification | `TAX_TABLE` in `scripts/refresh-isin-map.mjs` maps every SEBI sub-category to `[category, taxClass]` per A15 and AD8; Other-scheme rows (index funds, ETFs, FoFs) are split by `INDEX_RULES` on the scheme name (gold/silver → Other/debt; G-Sec, SDL, target-maturity, bond, liquid → Debt/debt; overseas index names → Equity/debt; equity index names → Equity/equity). `isElss` = sub-category `ELSS` or name contains "ELSS"/"Tax Saver"/"Tax Saving" within Equity. Unknown sub-categories **fail the run** (so a new SEBI category is reviewed, not silently bucketed). |
| Schema (D3) | `{ schemaVersion, generatedAt, source{…, structures}, categories[4], subCategories[], taxClasses[4], isinCount, groups: [{ t: [categoryIdx, subCategoryIdx, taxClassIdx, isElss], isins: [...] }], synthetic: [...] }`. `data/categories.ts` expands `groups` into a `Map<isin, CategoryInfo>` once on load (13,000 entries, < 5 ms). |
| Size | Measured on a 13,000-ISIN synthetic master: **203 KB raw, 49 KB gzipped** (budget 320 / 80). Open-ended only (AD9). |
| Refresh | Same monthly job, same PR. Diff guard: fails if > 5% of previously bundled ISINs vanish (`--allow-shrink` to override after review). `--expect-isin` (default: the benchmark ISIN) must be present. |
| Synthetic overlay (D6) | `syntheticCategoryOverlay()` from `scripts/lib/synthetic.mjs`: 24 ISINs in `INF000S01xx` for the fixture and sample funds, listed in `synthetic[]`. `MYSTERY` (the "unknown ISIN" fund) is deliberately absent. |
| Unknown ISIN | `Unclassified` bucket with "N funds unclassified; tell us the ISIN on GitHub" (US-18); excluded from tax with reason `unclassified` (Q6). A community-reported ISIN is added by fixing `TAX_TABLE`/`INDEX_RULES`, never by hand-editing the JSON. |

Example:

```json
{ "schemaVersion": 1, "generatedAt": "2026-11-01T03:05:40.000Z",
  "source": { "name": "AMFI scheme master (NAVAll.txt)", "url": "https://www.amfiindia.com/spages/NAVAll.txt", "termsUrl": "…", "licenceNote": "…", "structures": ["Open Ended"] },
  "categories": ["Equity", "Debt", "Hybrid", "Other"],
  "subCategories": ["Aggressive Hybrid Fund", "Arbitrage Fund", "Balanced Advantage Fund", "ELSS", "Flexi Cap Fund", "Large Cap Fund", "Liquid Fund", "…"],
  "taxClasses": ["equity", "debt", "hybrid-other", "unknown"], "isinCount": 13025,
  "groups": [ { "t": [0, 3, 0, 1], "isins": ["INF000S01EL2", "INF846K01EW2", "…"] }, { "t": [0, 5, 0, 0], "isins": ["INF000S01LC6", "INF000S01LD4", "…"] } ],
  "synthetic": ["INF000S01AG0", "INF000S01AR7", "…"] }
```

### 3.3 Tax rules — `src/calculations/taxRules.ts` (content for E6)

TypeScript, not JSON (design §5.3). Initial entry `FY2026-27`, `status: 'to-verify'`, `financeActReference: 'Finance (No. 2) Act 2024, s. 111A/112A as amended; verify for FY 2026-27'`, `lastVerified` = date of the owner's verification, `verifiedBy` the owner's handle. `displayTable` = the five rows of Appendix F verbatim. `simplifications`: "Hybrid funds with 35–65% equity are shown but not computed", "Debt units bought before 1 Apr 2023 are treated at slab (no indexation)", "Overseas FoF and gold/silver funds are treated as debt (slab); later Finance Act changes for these categories are not modelled", "Solution-oriented funds are shown but not computed", "Units held before the statement period have an unknown holding period and are excluded". Refresh: manual PR; the data job posts a reminder issue on 1 February and 1 April.

### 3.4 Sample CAS — `public/sample-cas.pdf`

Generated by `scripts/gen-fixtures.mjs` as fixture `sample-cas` (golden at `tests/fixtures/sample-cas.golden.json`): CAMS-issued, unprotected, 11 pages, 10 funds across one CAMS and one KFintech folio, statement date 30 Sep 2026, 650 rows; contains SIP, step-up, missed instalments, purchase, redemption (partial and full), switch pair, IDCW payout and reinvestment, stamp duty, STT, a reversal pair, an ELSS, a debt fund, and one hidden row in the Balanced Advantage fund so the partial banner is demonstrable ("We couldn't read 1 line in 1 folio"). `segregated`, `unit_adjustment` and `unknown` kinds are kept out of the demo on purpose; they are covered by fixtures. Expected: ≤ 100 KB (11 text pages, deflated); budget 300 KB.

---

## 4. Fixture corpus

### 4.1 Files and layout

Everything lives under `tests/fixtures/` (the sample PDF under `public/`): `<name>.pdf`, `<name>.golden.json`, `<name>.meta.json`, plus `benchmarkNav.fixture.json`, `isinCategory.fixture.json` and `MANIFEST.json`. Regenerate with `node scripts/gen-fixtures.mjs --apply` (dry-run without the flag prints the table below). The generator is deterministic: same seed, same bytes, same goldens.

Synthetic universe (`scripts/lib/synthetic.mjs`): 26 fictitious schemes ("Lens Sample …" from three fictitious AMCs) with ISINs in `INF000S01xx` (valid check digits), a seeded geometric market with a 2020 drawdown and a 2022 dip (realised index path 14.0%/yr over 2013–2026, large cap lagging, mid/small ahead), fixed synthetic holidays, two fictitious investors with PANs `LENSP0001A` / `LENSP0002B`, and RTA-shaped folio numbers. Stamp duty 0.005% from 1 Jul 2020 and STT 0.001% on equity redemptions are modelled exactly as AD4 describes.

Layouts: **CAMS style** prints the scheme header as `<code>-<name> (Advisor: DIRECT) Registrar : CAMS` with `ISIN:` on the next line, negatives with a leading minus, numbers on the first line of a wrapped description; **KFintech style** prints `<name>` then `ISIN: … (Advisor: …) Registrar : KFINTECH`, negatives in parentheses (E50), numbers on the **last** line of a wrapped description, different column anchors, masked PAN. Both repeat a page header and two footer lines on every page (E52) and a column header at the top of a continued table. Every page carries the footer "SYNTHETIC STATEMENT generated by sip-lens scripts/gen-fixtures.mjs…".

### 4.2 The corpus

30 files. "Edge rows" refer to the design's §6 register.

| # | File | Layout, period, dp | Exercises (edge rows; stories) | Expected |
|---|---|---|---|---|
| 1 | `cams-2019-plain-sip.pdf` | CAMS, 2016-01-01 → 2019-03-29, 3 dp | Baseline single folio, single fund, 38 monthly SIPs, no levies (E48 ok path, E52, E59; US-07, 09, 10, 12–17, 23–25, 27) | `result`, no warnings |
| 2 | `cams-2022-stamp-duty-stt.pdf` | CAMS, 2019-04-01 → 2022-09-30 | SIP across the 1 Jul 2020 stamp-duty start; lump-sum top-up; partial redemption with STT; orphan stamp duty (E20, E21, E22, E32; US-09, 14, 17, 23) | `result`, `ORPHAN_LEVY` (info) |
| 3 | `cams-2025-switch-pair.pdf` | CAMS, 2021-01-01 → 2025-06-30 | Full switch with 1% exit load (amounts differ), 6-leg STP, wrapped switch descriptions, one row split across a page break (E14, E15, E51; US-09, 14, 17, 27, 30) | `result`, no warnings |
| 4 | `cams-2025-idcw.pdf` | CAMS, 2019-01-01 → 2025-03-31 | IDCW payout plan and IDCW reinvestment plan, "Dividend Paid/Reinvested" (2019) and "IDCW" wording, bare `IDCW` rows with and without units, stamp duty on reinvestment (E16, E17, E20, E42; US-09, 14, 17, 30) | `result`, no warnings |
| 5 | `cams-2025-reversal.pdf` | CAMS, 2019-01-01 → 2025-03-31 | One SIP instalment reversed three days later (pair excluded, counts as missed); folio B has a reversal without an original (E18, E19, E30; US-09, 14, 17, 24) | `result`, `ORPHAN_REVERSAL` (flag on Flexi Cap) |
| 6 | `cams-2025-segregated.pdf` | CAMS, 2018-01-01 → 2025-03-31 | Credit-risk fund with a segregated-portfolio section (units, no cash, own value) and a bonus unit-adjustment row (E23, E24; US-09, 14, 17) | `result`, no warnings |
| 7 | `cams-2025-fully-redeemed.pdf` | CAMS, 2017-01-01 → 2025-03-31 | Small cap fully redeemed (zero balance, XIRR without terminal); index fund in two folios → one Fund (E25, E27, E37; US-13, 14, 17, 27) | `result`, no warnings |
| 8 | `cams-2025-sip-patterns.pdf` | CAMS, 2020-01-01 → 2025-09-30 | Step-up (5,000 → 7,500 → 10,000), paused (3 missed), stopped (last Mar 2023), top-ups, SIP on the 31st, quarterly SIP (E29–E33; US-23–26) | `result`, no warnings |
| 9 | `cams-2025-elss-tax.pdf` | CAMS, 2021-04-01 → 2025-09-30 | ELSS lots on both sides of the 36-month lock; LC lots exactly 12 months (short) and 12 months + 3 days (long) before as-of; 31 Mar / 1 Apr lots; switch-in lot into ELSS; purchase one day before as-of; debt, hybrid-other, aggressive hybrid, overseas FoF (E38, E40, E41, E42; US-18, 30–34) | `result`, no warnings; `invariants.taxLots` present |
| 10 | `cams-2025-unknown-isin.pdf` | CAMS, 2019-01-01 → 2025-03-31 | ISIN not in map; header without ISIN (name+folio identity); one ISIN under two names in two folios (E26, E28, E61; US-13, 18, 30) | `result`, `MISSING_ISIN` (info) |
| 11 | `cams-2025-parse-warnings.pdf` | CAMS, 2022-04-01 → 2025-03-31 | Hidden row → running-balance jump and closing mismatch; unknown description; future-dated purchase (+ its levy); section without closing row; opening balance without history; duplicated section; one clean fund (E39, E43, E48, E53; US-08, 10, 14) | `result`; `UNIT_MISMATCH`, `UNCLASSIFIED_ROW`, `FUTURE_DATED_ROW` ×2, `NO_CLOSING_BALANCE` (flags), `DUPLICATE_SECTION` (info) |
| 12 | `cams-2025-missing-period.pdf` | CAMS, period line omitted | Statement date falls back to the latest transaction date (E54; US-15) | `result`, `MISSING_STATEMENT_DATE` (info) |
| 13 | `kfin-2020-plain.pdf` | KFintech, 2017-01-01 → 2020-12-31 | KFintech anchors, parenthesised negatives, numbers on the last wrapped line (E50, E51, E64; US-07, 09, 10, 14) | `result`, no warnings |
| 14 | `kfin-2023-4dp.pdf` | KFintech, 2020-01-01 → 2023-09-29, **4 dp** | Four-decimal units (tolerance 0.0002), switch pair, forced page-split row with date on page N and numbers on page N+1 (E49, E14, E51; US-09, 10) | `result`, no warnings |
| 15 | `kfin-2026-weekly-sip.pdf` | KFintech, 2024-04-01 → 2026-03-31 | Weekly SIP (104 instalments), SWP rows, statement on an FY end (E33, E40, E15; US-23–25, 30) | `result`, no warnings |
| 16 | `joint-cams-kfin-2025.pdf` | CAMS-issued, 2020-01-01 → 2025-03-31 | KFintech-serviced folio inside a CAMS CAS: `issuer: 'CAMS'`, `rta` per folio (E64; US-10) | `result`, no warnings |
| 17 | `multi-pan-2025.pdf` | CAMS, 2020-01-01 → 2025-03-31 | Two investor blocks, two PANs, `investorCount: 2` (E63; US-10) | `result`, `MULTI_PAN` (info) |
| 18 | `cams-2025-growth-15f-2000t.pdf` | CAMS, 2015-10-01 → 2025-09-30 | The growth scenario (§6): 15 funds, 1,961 rows, 29 pages (E44; US-07, 12, 13, 17) | `result`, no warnings; **digest golden** |
| 19 | `stress-cams-2025-100p.pdf` | CAMS, 2015-10-01 → 2025-09-30 | 103 pages, 20 funds, 7,398 rows, weekly and monthly SIPs; parse ≤ 8 s, worker ≤ 250 MB (E44, E51, E52; US-07) | `result`, no warnings; **digest golden** |
| 20 | `cams-2024-protected.pdf` | CAMS, 2022-01-01 → 2024-12-31, AES-128 | User password = synthetic PAN `LENSP0001A` (in `.meta.json`); wrong-password and cancel flows reuse this file (E4, E5, E6, E65; US-03) | `result` after password |
| 21 | `cams-2024-owner-locked.pdf` | CAMS, same content | Owner password only: opens without a prompt (E4 note) | `result`, no prompt |
| 22 | `cams-2025-summary.pdf` | CAMS summary | Scheme sections with closing/cost/market value, zero transaction rows (E10; US-05) | `SUMMARY_CAS` with `issuer: 'CAMS'`, 2 scheme names, `statementDate: '2025-03-31'` |
| 23 | `kfin-2025-summary.pdf` | KFintech summary | Same, KFintech request steps (E10; US-05) | `SUMMARY_CAS`, `issuer: 'KFINTECH'`, 1 scheme name |
| 24 | `nsdl-2025-depository.pdf` | NSDL e-CAS | Prints "Consolidated Account Statement", CAS ID, DP ID/Client ID, and MF folios "serviced by CAMS / KFINTECH" so precedence is tested (E11; US-06) | `DEPOSITORY_CAS`, `depository: 'NSDL'` |
| 25 | `cdsl-2025-depository.pdf` | CDSL e-CAS | BO ID, "Central Depository Services", myeasi (E11; US-06) | `DEPOSITORY_CAS`, `depository: 'CDSL'` |
| 26 | `scanned-2025.pdf` | 2 pages of vector blocks | No text objects at all (E8; US-04) | `NO_TEXT` |
| 27 | `not-cas-bank-statement.pdf` | text PDF | No RTA + CAS markers (E9; US-04) | `NOT_CAS` |
| 28 | `not-cas-cams-letter.pdf` | text PDF | CAMS marker, "Folio No" and "PAN" on page 1, zero folio sections in the walk (E9; US-04) | `NOT_CAS` |
| 29 | `not-a-pdf.pdf` | 64×64 PNG bytes | Rejected on the main thread (E1, E46; US-02) | `NOT_PDF` |
| 30 | `sample-cas.pdf` (→ `public/`) | CAMS-issued, 2019-04-01 → 2026-09-30 | §3.4; both RTA styles, 10 funds, every demo-safe kind, one hidden row (US-11) | `result`, `UNIT_MISMATCH` (flag on Balanced Advantage) |

Coverage of the required list: CAMS detailed single folio plain SIP (1); KFintech detailed (13, 14, 15); switch-in/out pair (3, 14, 30); dividend payout and reinvestment (4, 30); stamp duty and STT rows (2 and every post-2020 fixture); reversal (5, 30); segregated portfolio (6); zero-balance folio (3 LC, 7, 30); SIP step-up (8, 30); SIP missed instalments (5, 8, 30); SIP stopped (7, 8, 30); one-off top-up (2, 8); fully redeemed fund (7, 30); ELSS (5, 8, 9, 17, 30); unknown ISIN (10); multi-PAN (17); 100+ page statement (19); CAMS summary (22); depository CAS (24, 25); password-protected (20). Design §5.5: CAMS 2019/2022/2025 (1, 2, 3–12), KFintech 2020/2023/2026 (13, 14, 15), joint (16), summaries (22, 23), NSDL/CDSL (24, 25), protected (20), scanned (26), multi-PAN (17), 100+ pages (19), 4-decimal units (14). Every P-layer row of §6 except E7 (corrupt PDF: a truncated copy of fixture 1 is produced in the test itself by slicing the bytes), E12 (> 400 pages: tested with a stubbed `numPages`), E13 and E45 (pdfjs failure and OOM: stubbed).

### 4.3 Pinned invariants per fixture

Values below are what each golden pins under `invariants`. Units are closing units at the printed precision, money in rupees, XIRR in percent to 4 dp computed by the reference implementation in `scripts/lib/golden.mjs` (spreadsheet `XIRR()` semantics: actual/365 from the earliest flow, bracketed Newton with bisection fallback, root nearest zero). Each golden with ≤ 80 flows per fund also carries the dated cashflow list so the same number can be reproduced with `=XIRR(amounts, dates)` in a spreadsheet; the test tolerance is 0.0001 (0.01 pp, US-14). "Invested" is Σ outflows (SIP and purchase amounts **plus** stamp duty), "Redeemed" Σ inflows excluding the terminal value.

**cams-2019-plain-sip** — 1 page, 38 transactions; portfolio invested ₹1,90,000.00, value ₹2,31,291.09, XIRR **12.7427%**. Cashflows: −5,000 on 2016-02-10, 2016-03-10, 2016-04-11 … 2019-03-11 (38 flows), +2,31,291.09 on 2019-03-29.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Large Cap Fund (`INF000S01LC6`) | 5775.794 | 40.0449 | 231291.09 | 190000 | 0 | 12.7427% | — |

**cams-2022-stamp-duty-stt** — 2 pages, 73 transactions; invested ₹4,60,000.50, value ₹5,04,911.21, XIRR **13.8618%**; `ORPHAN_LEVY` (the 0.50 of 2022-05-20 is its own outflow, hence the ₹0.50 in "invested").

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Flexi Cap Fund (`INF000S01FL9`) | 3090.465 | 163.3771 | 504911.21 | 460000.5 | 67450.13 | 13.8618% | — |

**cams-2025-switch-pair** — 3 pages, 94 transactions; invested ₹8,88,794.73, value ₹5,51,709.04, XIRR **13.3551%**.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Large Cap Fund (`INF000S01LC6`) | 0 | 94.041 | 0 | 280000 | 368791.3 | 18.9868% | — |
| Liquid Fund (`INF000S01LQ6`) | 0.605 | 4574.0589 | 2767.31 | 120000 | 119999.7 | 7.2154% | — |
| Midcap Opportunities Fund (`INF000S01MD2`) | 1573.375 | 348.8944 | 548941.73 | 488794.73 | 0 | 8.8822% | — |

**cams-2025-idcw** — 1 page, 13 transactions; invested ₹3,50,000.00, value ₹6,87,481.81, XIRR **12.9539%**. Payout fund cashflows: −2,00,000 (2019-02-11), +7,548.53, +9,225.98, +8,387.26, +10,064.71, terminal +2,66,095.76. Reinvestment fund: −1,50,000 and the terminal only; four `dividend_reinvest` rows ignored (zero cash, four lots).

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Large Cap Fund - IDCW Payout (`INF000S01LD4`) | 8387.256 | 31.7262 | 266095.76 | 200000 | 35226.48 | 7.4002% | — |
| Flexi Cap Fund - IDCW Reinvestment (`INF000S01FR6`) | 4711.098 | 89.4454 | 421386.05 | 150000 | 0 | 18.3303% | — |

**cams-2025-reversal** — 3 pages, 135 transactions; invested ₹3,65,000.00 (73 instalments; the reversed one is excluded), value ₹7,09,040.60, portfolio XIRR **20.3797%** excluding Flexi Cap (may be incomplete). Discipline: 74 expected, 73 made, 1 missed (the reversed instalment), score 99.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| ELSS Tax Saver Fund (`INF000S01EL2`) | 3860.5 | 176.0215 | 679531 | 365000 | 0 | 20.3797% | — |
| Flexi Cap Fund (`INF000S01FL9`) | 97.348 | 303.1351 | 29509.6 | 25000 | 0 | 4.4641% | may be incomplete |

**cams-2025-segregated** — 1 page, 5 transactions; invested ₹4,00,000.00, value ₹6,52,397.70, XIRR **11.9149%**. The segregated portfolio has one zero-cash row and a printed value; its own XIRR is `insufficient (fewer-than-two)`; it is still counted in the value tile.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Credit Risk Fund (`INF000S01CR3`) | 8527.407 | 39.2761 | 334923.29 | 300000 | 148157.5 | 8.6968% | — |
| Credit Risk Fund - Segregated Portfolio 1 (`INF000S01CS1`) | 21345.678 | 1.6771 | 35798.84 | 0 | 0 | — (fewer-than-two) | — |
| Aggressive Hybrid Fund (`INF000S01AG0`) | 500.643 | 562.6276 | 281675.57 | 100000 | 0 | 15.9983% | — |

**cams-2025-fully-redeemed** — 3 pages, 174 transactions, 3 folios, 2 funds; invested ₹8,41,000.00, value ₹12,48,362.81, XIRR **25.2633%**. Small Cap: no terminal, realised XIRR; discipline marks it stopped since 2021-01-10 (47 made, 51 stopped, 0 missed).

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Small Cap Fund (`INF000S01SM0`) | 0 | 173.3802 | 0 | 141000 | 299533.86 | 28.2634% | — |
| Nifty 50 Index Fund (`INF000S01IX8`) | 4049.249 | 308.2949 | 1248362.81 | 700000 | 0 | 23.7151% | — |

**cams-2025-sip-patterns** — 8 pages, 507 transactions; invested ₹22,95,500.00, value ₹36,47,713.88, XIRR **16.2500%**. Discipline score **99**. Per SIP: LC monthly 68/68 made, amounts [{2020-02-10: 5000}, {2022-02-10: 7500}, {2024-02-12: 10000}], 100%; Flexi 68 expected, 65 made, 3 missed, 96%; Midcap 38 made, 30 stopped, `stoppedSince: 2023-04-10`, 100%; ELSS (day 31) 69/69 from 2020-01-31, 100%; Gilt quarterly 23/23 from 2020-03-05, 100%.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Large Cap Fund (`INF000S01LC6`) | 8023.715 | 89.1108 | 714999.66 | 500000 | 0 | 14.7118% | — |
| Flexi Cap Fund (`INF000S01FL9`) | 1535.991 | 297.2218 | 456530.01 | 260000 | 0 | 20.1379% | — |
| Midcap Opportunities Fund (`INF000S01MD2`) | 1690.123 | 315.8339 | 533798.14 | 228000 | 0 | 22.5452% | — |
| ELSS Tax Saver Fund (`INF000S01EL2`) | 9216.431 | 165.6155 | 1526383.83 | 962500 | 0 | 16.2901% | — |
| Gilt Fund (`INF000S01GL7`) | 5416.04 | 76.8093 | 416002.24 | 345000 | 0 | 6.6446% | — |

**cams-2025-elss-tax** — 3 pages, 98 transactions; invested ₹9,31,980.62, value ₹11,67,632.76, XIRR **12.4103%**. Tax lots (as of 2025-09-30): ELSS 41 lots: 2 long (1055.582 units, gain ₹74,820.74; the 31-Mar-2022 and 1-Apr-2022 lots, unlocked Mar/Apr 2025), 39 locked (1633.024 units, gain ₹38,473.48; first unlock 2025-10-10); LC 3 lots: 2024-03-28 and 2024-09-27 long, **2024-09-30 short** (exactly 12 months: not strictly later); Liquid, FoF overseas: debt class (slab); BAF: hybrid-other; Aggressive hybrid: equity, long.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| ELSS Tax Saver Fund (`INF000S01EL2`) | 2688.606 | 165.6155 | 445274.83 | 331980.62 | 0 | 14.9734% | — |
| Large Cap Fund (`INF000S01LC6`) | 1442.677 | 89.1108 | 128558.1 | 140000 | 16980.45 | 3.1576% | — |
| Liquid Fund (`INF000S01LQ6`) | 50.095 | 4641.4219 | 232512.03 | 200000 | 0 | 6.6980% | — |
| Balanced Advantage Fund (`INF000S01BA1`) | 2011.094 | 65.2028 | 131128.96 | 100000 | 0 | 12.3726% | — |
| Aggressive Hybrid Fund (`INF000S01AG0`) | 209.725 | 594.4574 | 124672.58 | 100000 | 0 | 18.3815% | — |
| US Equity Fund of Fund (`INF000S01IN9`) | 696.244 | 151.5076 | 105486.26 | 60000 | 0 | 18.5880% | — |

**cams-2025-unknown-isin** — 4 pages, 210 transactions, 4 folios, 3 funds; invested ₹2,94,000.00, value ₹5,74,638.63, XIRR **21.0720%**; `MISSING_ISIN` on the Value Discovery fund.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Thematic Opportunities Fund (`INF000S01MY8`, not in map) | 2372.822 | 128.7304 | 305454.33 | 148000 | 0 | 23.5321% | — |
| Value Discovery Fund - Regular Plan (`name:lens sample value discovery fund regular plan growth\|4759050787 / 0`) | 408.643 | 233.6465 | 95478.01 | 40000 | 0 | 21.4947% | — |
| Bluechip Fund, also printed as Large & Mid Cap Fund (`INF000S01RN0`, 2 folios) | 870.289 | 199.5961 | 173706.29 | 106000 | 0 | 16.8912% | — |

**cams-2025-parse-warnings** — 5 pages, 219 transactions, 6 folios, 6 funds; portfolio XIRR **23.1363%** from the one clean fund (Small Cap); invested ₹1,05,000.00; value ₹12,69,736.73 across the five funds with a printed value (Gilt has none). Reconciliation: LC `mismatch` (computed 2504.567, printed 2781.858, diff −277.291, `firstMismatchRow: 32`), Gilt `no-closing-balance`, others `ok`. Excluded from the pooled XIRR: LC, Flexi, Midcap, Gilt (may be incomplete), Index (opening balance 1234.567 without history, D5).

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Large Cap Fund (`INF000S01LC6`) | 2781.858 | 101.0929 | 281226.09 | 175000 | 0 | 35.0703% | may be incomplete |
| Flexi Cap Fund (`INF000S01FL9`) | 407.85 | 303.1351 | 123633.65 | 60000 | 0 | 29.4606% | may be incomplete |
| Midcap Opportunities Fund (`INF000S01MD2`) | 234.257 | 368.0271 | 86212.92 | 30000 | 0 | 45.7916% | may be incomplete |
| Gilt Fund (`INF000S01GL7`) | 0 | — | — | 80000 | 0 | — (fewer-than-two) | may be incomplete |
| Small Cap Fund (`INF000S01SM0`) | 835.384 | 173.3802 | 144839.04 | 105000 | 0 | 23.1363% | — |
| Nifty 50 Index Fund (`INF000S01IX8`) | 2055.905 | 308.2949 | 633825.03 | 175000 | 0 | — (opening-balance-without-history) | opening balance |

**cams-2025-missing-period** — 1 page, 52 transactions; `statementDate` = 2025-03-10 (latest row); invested ₹1,30,000.00, value ₹1,68,849.91, XIRR **27.2165%**.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Large Cap Fund (`INF000S01LC6`) | 1670.245 | 101.0929 | 168849.91 | 130000 | 0 | 27.2165% | — |

**kfin-2020-plain** — 2 pages, 55 transactions; invested ₹3,80,000.00, value ₹5,47,824.74, XIRR **21.7472%**.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Small Cap Fund (`INF000S01SM0`) | 3832.811 | 96.0724 | 368227.35 | 230000 | 31717.48 | 32.0494% | — |
| Corporate Bond Fund (`INF000S01CB7`) | 4791.781 | 37.4803 | 179597.39 | 150000 | 0 | 7.5854% | — |

**kfin-2023-4dp** — 2 pages, 87 transactions, `unitDecimals: 4`; invested ₹3,23,414.44, value ₹5,75,566.17, XIRR **36.3635%** (the 2020–2023 window starts in the drawdown).

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Midcap Opportunities Fund (`INF000S01MD2`) | 2043.0231 | 273.5129 | 558793.17 | 308000 | 15414.29 | 37.1194% | — |
| Arbitrage Fund (`INF000S01AR7`) | 766.5099 | 21.8823 | 16773 | 15414.44 | 0 | 6.3470% | — |

**kfin-2026-weekly-sip** — 4 pages, 213 transactions; invested ₹2,04,000.00, value ₹2,29,180.66, XIRR **14.6481%**. Discipline: weekly, 104/104, score 100.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Focused Equity Fund (`INF000S01FO3`) | 1513.742 | 88.6174 | 134143.88 | 104000 | 0 | 27.5989% | — |
| Short Duration Fund (`INF000S01SD9`) | 1421.908 | 66.8375 | 95036.78 | 100000 | 18436.8 | 7.3294% | — |

**joint-cams-kfin-2025** — 4 pages, 238 transactions; invested ₹6,20,000.00, value ₹11,33,127.97, XIRR **23.7283%**; folio A `rta: 'CAMS'`, folio B `rta: 'KFINTECH'`, `issuer: 'CAMS'`.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Large Cap Fund (`INF000S01LC6`) | 5602.825 | 101.0929 | 566405.83 | 310000 | 0 | 23.7170% | — |
| Small Cap Fund (`INF000S01SM0`) | 3268.667 | 173.3802 | 566722.14 | 310000 | 0 | 23.7395% | — |

**multi-pan-2025** — 4 pages, 238 transactions, `investorCount: 2`; invested ₹5,58,000.00, value ₹10,14,131.97, XIRR **23.5025%**.

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Flexi Cap Fund (`INF000S01FL9`) | 1900.406 | 303.1351 | 576079.76 | 310000 | 0 | 24.4018% | — |
| ELSS Tax Saver Fund (`INF000S01EL2`) | 2488.629 | 176.0215 | 438052.21 | 248000 | 0 | 22.3525% | — |

**cams-2025-growth-15f-2000t** — 29 pages, 1,961 transactions, 15 funds; invested ₹59,25,000.00, value ₹1,10,16,170.82, XIRR **13.9388%** (digest golden: per-folio transaction count and SHA-256; totals and XIRR pinned).

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR |
|---|---|---|---|---|---|---|
| Large Cap (`…LC6`) | 13313.364 | 89.1108 | 1186364.52 | 595000 | 0 | 13.4077% |
| Flexi Cap (`…FL9`) | 5604.791 | 297.2218 | 1665866.07 | 585000 | 0 | 20.5000% |
| Midcap (`…MD2`) | 2601.252 | 315.8339 | 821563.56 | 357000 | 0 | 16.1183% |
| ELSS (`…EL2`) | 7613.465 | 165.6155 | 1260907.81 | 595000 | 0 | 14.5264% |
| Nifty 50 Index (`…IX8`) | 7174.103 | 277.2115 | 1988743.85 | 1050000 | 0 | 14.1980% |
| Balanced Advantage (`…BA1`) | 10480.557 | 65.2028 | 683361.66 | 408000 | 0 | 11.8601% |
| Aggressive Hybrid (`…AG0`) | 1818.616 | 594.4574 | 1081089.74 | 386000 | 0 | 14.7976% |
| Liquid (`…LQ6`) | 4.535 | 4641.4219 | 21048.85 | 500000 | 543247.59 | 6.8463% |
| Small Cap (`…SM0`) | 4129.804 | 132.684 | 547958.91 | 315000 | 0 | 12.3346% |
| Focused Equity (`…FO3`) | 5958.279 | 67.3428 | 401247.19 | 250000 | 0 | 11.1213% |
| Dividend Yield (`…DY7`) | 1616.94 | 89.8901 | 145346.9 | 75000 | 0 | 10.4805% |
| Corporate Bond (`…CB7`) | 9583.562 | 54.5829 | 523098.61 | 300000 | 0 | 8.0122% |
| US Equity FoF (`…IN9`) | 1515.782 | 151.5076 | 229652.49 | 138000 | 0 | 17.7674% |
| Gold FoF (`…GD4`) | 4757.299 | 55.079 | 262027.27 | 200000 | 0 | 6.3886% |
| Multi Asset (`…MA8`) | 5175.632 | 38.2356 | 197893.39 | 171000 | 0 | 6.1530% |

**stress-cams-2025-100p** — 103 pages, 7,398 transactions, 20 funds, 3 folios; invested ₹58,79,000.00, value ₹1,03,71,603.96, XIRR **12.6952%** (digest golden). Per-fund rows are in the golden; the first three: Large Cap 9733.354 units, 14.3290%; Flexi Cap 3915.327, 20.7681%; Midcap 2593.152, 17.9182%.

**cams-2024-protected** and **cams-2024-owner-locked** — identical content: 2 pages, 70 transactions; invested ₹1,75,000.00, value ₹2,33,733.67, XIRR **20.6440%**; Large Cap 2599.097 units at 89.9288.

**sample-cas** — 11 pages, 650 transactions, 10 folios/funds; invested ₹23,63,109.92, value ₹31,07,863.42, XIRR **13.8816%** excluding Balanced Advantage (hidden row: `UNIT_MISMATCH:INF000S01BA1:9:-`). Discipline score 99 (LC 89/89 with step-up at 2023-05-10; ELSS 87/89, 2 missed; Index 57/57; Small Cap stopped since 2023-01-10; Midcap 59 made, 1 missed (the reversed March 2020 instalment), stopped since 2025-02-10).

| Fund (id) | Closing units | Closing NAV | Value | Invested | Redeemed | XIRR | Flags |
|---|---|---|---|---|---|---|---|
| Large Cap Fund (`INF000S01LC6`) | 8820.778 | 93.8094 | 827471.89 | 547500 | 0 | 12.1148% | — |
| ELSS Tax Saver Fund (`INF000S01EL2`) | 3224.738 | 161.6729 | 521352.74 | 348000 | 0 | 10.9266% | — |
| Flexi Cap Fund (`INF000S01FL9`) | 0 | 311.1599 | 0 | 100000 | 405605.86 | 39.5683% | — |
| Nifty 50 Index Fund (`INF000S01IX8`) | 2711.226 | 294.0913 | 797347.98 | 690609.92 | 0 | 6.2964% | — |
| Flexi Cap Fund - IDCW Reinvestment (`INF000S01FR6`) | 1370.284 | 80.2132 | 109914.86 | 50000 | 0 | 11.3736% | — |
| Large Cap Fund - IDCW Payout (`INF000S01LD4`) | 1968.148 | 26.854 | 52852.65 | 50000 | 4526.74 | 1.9903% | — |
| Small Cap Fund (`INF000S01SM0`, KFintech folio) | 0 | 110.123 | 0 | 132000 | 221056.28 | 21.2826% | — |
| Liquid Fund (`INF000S01LQ6`, KFintech) | 26.076 | 4948.5486 | 129038.35 | 150000 | 44626.49 | 6.6005% | — |
| Balanced Advantage Fund (`INF000S01BA1`, KFintech) | 2241.759 | 65.573 | 146998.86 | 80000 | 0 | 12.5521% | may be incomplete |
| Midcap Opportunities Fund (`INF000S01MD2`, KFintech) | 1702.877 | 307.0604 | 522886.09 | 295000 | 0 | 14.3204% | — |

Rejected fixtures pin the `ParseError` shown in §4.2. The benchmark fixture (`benchmarkNav.fixture.json`, the synthetic index fund's series, 3,507 points, 2013-01-03 → 2026-09-30) makes the Nifty 50 Index Fund in fixtures 7, 11 and 30 track the benchmark exactly: `indexComparison` on those funds must return `gapPoints` within ±0.0002 of 0 and `valueDifference` within ±₹2 of 0 (rounding of units to 3 dp); that is the E5 sanity test.

### 4.4 How each fixture reaches the parser in tests

`tests/parser/golden.test.ts` iterates `MANIFEST.json`: for each `*.pdf` it reads the sibling `.meta.json`, opens the file through the same `pdfWorker` code path under a Node pdfjs shim (password from `meta.password` when present), and compares the outcome with the golden under the rules in §4.6. `tests/parser/detect.test.ts` asserts the `ParseErrorCode` of every rejected fixture and the `DocumentType` of every parsed one. `tests/calculations/*.test.ts` load `*.golden.json` directly (no PDF) and compare `buildCashflows`, `xirr`, `disciplineScore`, `buildFifoLots` and `indexComparison` (with `benchmarkNav.fixture.json`) against `invariants`. `tests/privacy/runtime.test.ts` runs every fixture under throwing network/storage stubs.

### 4.5 `.meta.json` and `MANIFEST.json`

```json
{ "fixture": "cams-2024-protected.pdf", "kind": "detailed", "expect": "result", "password": "LENSP0001A", "encryption": "AES-128",
  "pageCount": 2, "bytes": 18231, "sha256": "…", "generator": { "script": "scripts/gen-fixtures.mjs", "version": "1.0.0" } }
```
```json
{ "generator": { "script": "scripts/gen-fixtures.mjs", "version": "1.0.0" },
  "files": { "tests/fixtures/cams-2019-plain-sip.pdf": { "bytes": 9876, "sha256": "…" }, "tests/fixtures/cams-2019-plain-sip.golden.json": { "bytes": 17412, "sha256": "…" }, "…": {} } }
```

The manifest is the fence of CLAUDE.md's "real statements never enter the repo": V-17 fails CI on any PDF under `tests/fixtures/` that the generator did not write.

### 4.6 Golden format and comparison rules

```json
{ "goldenVersion": 1, "fixture": "cams-2019-plain-sip.pdf",
  "generator": { "script": "scripts/gen-fixtures.mjs", "version": "1.0.0" },
  "stories": ["US-07", "…"], "edges": ["E48 (ok path)", "…"], "notes": "…",
  "expect": "result",
  "result": { "portfolio": { "schemaVersion": 1, "…": "ParseResult without parsedAt" }, "warnings": [], "reconciliation": {}, "stats": {} },
  "invariants": {
    "portfolio": { "asOf": "2019-03-29", "totalInvested": 190000, "totalRedeemed": 0, "valueAsOfStatementDate": 231291.09, "fundsWithoutPrintedValue": 0,
                   "terminalValue": 231291.09, "skippedFunds": [], "xirr": { "status": "ok", "ratePct4dp": 12.7427, "method": "newton" } },
    "funds": { "INF000S01LC6": { "schemeName": "…", "closingUnits": 5775.794, "closingNav": 40.0449, "closingValue": 231291.09, "mayBeIncomplete": false,
                                 "openingWithoutHistory": false, "invested": 190000, "redeemed": 0, "netInvested": 190000, "terminalValue": 231291.09,
                                 "cashflowCount": 38, "ignoredCount": 0, "cashflows": [{ "date": "2016-02-10", "amount": -5000, "label": "SIP" }, "…"],
                                 "ignored": [], "xirr": { "status": "ok", "ratePct4dp": 12.7427, "method": "newton" } } },
    "discipline": { "score": 100, "sips": [{ "fundId": "INF000S01LC6", "folioNumber": "4755251488 / 0", "frequency": "monthly",
                    "amounts": [{ "from": "2016-02-10", "amount": 5000 }], "firstDate": "2016-02-10", "lastObserved": "2019-03-11",
                    "counts": { "expected": 38, "made": 38, "missed": 0, "stopped": 0 }, "percent": 100 }] },
    "taxLots": { "…": "only when the fixture sets pinTax" } } }
```

For rejected fixtures: `"expect": "error", "error": { "code": "…", "message": "ui.error.<CODE>", "…": "code-specific fields" }` and no `result`. For digest fixtures: `"digest": true` and each `folio.transactions` is `{ "count": n, "sha256": "…" }` computed by `digestResult()` in `scripts/lib/golden.mjs` (canonical line per transaction: `date, kind, amount, units, nav, unitBalance, description, page, attachedTo, reverses` joined by U+001F); the test applies the same function to the parser's result.

Comparison rules (`tests/parser/golden.test.ts`):

| Field | Rule |
|---|---|
| `portfolio.parsedAt`, `stats.rows`, `stats.extractMs`, `stats.parseMs` | Not compared. |
| `ParseError.message` | Not compared (UI key). |
| Numbers printed in the CAS (`amount`, `units`, `nav`, `unitBalance`, `openingUnits`, `closingUnits`, `closingNav`, `closingValue`) | Exact equality after parsing: these are printed strings and must round-trip exactly. |
| `reconciliation.diff`, `computedClosingUnits`, `fund.closingUnits`, `fund.closingValue` | Equal after rounding to `decimals` (units) or 2 dp (money). |
| `description` | Equal after collapsing runs of whitespace to one space and trimming. |
| `warnings` | Compared as sets keyed by `id`; each matched warning compared field by field. |
| `funds[]`, `folios[]`, `transactions[]` | Ordered comparison (document order is part of the contract). |
| `invariants.*.xirr.ratePct4dp` | `\|engine − golden\| ≤ 0.01` percentage points (US-14); `status`, `reason`, `warning` exact; `method` not compared. |
| `invariants.funds[id].cashflows` | Same length; per flow: `date` exact, `amount` within ±0.005. |
| `invariants.discipline` | `score`, `counts`, `percent`, `frequency`, `stoppedSince`, `amounts[].amount` exact; `amounts[].from` and `firstDate` within ±7 days (grace, Q4). |
| `invariants.taxLots` | Per lot: `acquiredOn`, `term`, `unlockOn` exact; `units` within 10^-dp; `costPerUnit` within 10^-4; `gain` within ±0.01 × number of lots merged. |
| `invariants.portfolio.valueAsOfStatementDate`, `totalInvested`, `totalRedeemed`, `terminalValue` | ±0.01. |
| Everything else | Deep equality; `undefined` and absent are the same. |

A golden is regenerated only by running the generator; hand-editing a golden is a review-blocking offence, because the invariants are derived from the same model that wrote the PDF.

---

## 5. Lifecycle

### 5.1 Versions

| Object | Field | v1.0 value | Bump rule |
|---|---|---|---|
| `Portfolio` | `schemaVersion` | `1` | Any breaking change to `src/parser/types.ts`: a renamed or removed field, a changed sign or unit convention, a new `TransactionKind` member, a changed `id` format. Adding an optional field is **not** a bump. |
| `benchmarkNav.json` | `schemaVersion` | `1` | Change of the columnar encoding or of `epoch` semantics. Adding fields is not a bump. |
| `isinCategory.json` | `schemaVersion` | `1` | Change of the tuple layout or group encoding; a new `taxClass` or `category` member **is** a bump (consumers switch on them). A new sub-category string is not. |
| Golden files | `goldenVersion` | `1` | Change of the wrapper, the digest canonical form or a comparison rule. A `Portfolio.schemaVersion` bump regenerates every golden and bumps this too. |
| Worker protocol | `PROTOCOL_VERSION` | `1` | Design §3.2. |
| Fixture generator | `GENERATOR_VERSION` | `1.0.0` | Semver; patch for content-preserving changes, minor for new fixtures, major when existing goldens change. Recorded in every golden, meta and the manifest. |

### 5.2 Forward compatibility rules

These matter today for the test corpus and tomorrow for the v1.1 "shareable report" (a serialised `Portfolio` plus `Analysis` that a later build must still read):

1. A reader accepts any `schemaVersion ≤` its own; it refuses a higher one with a specific message ("This report was made by a newer SIP Lens; open it at the current URL") rather than guessing.
2. Readers ignore unknown fields and never fail on them (so optional additions need no bump).
3. An unknown `TransactionKind` string from a newer writer maps to `'unknown'` with `excludedFromCashflows: true`, and the fund is flagged; the number shown is then conservative rather than wrong.
4. The migration path for a bump is a pure function `migratePortfolio(v: unknown): Portfolio` in `src/parser/migrate.ts`, tested with one golden frozen per historical version under `tests/fixtures/schema/v<N>.json`.
5. Dataset loaders check `schemaVersion` first and treat a mismatch as "dataset absent" (V-7), never as a crash: the Must dashboard does not depend on either dataset.
6. Goldens pin `goldenVersion`; the test refuses to compare a golden of another version so that a stale corpus fails loudly instead of passing vacuously.

### 5.3 Memory clearing on reset (data view of design §8.2)

- The only live copies of financial data are: the PDF bytes and pdfjs document inside the worker; the `ParseResult` in the worker until it is posted; the structured-clone copy in the main thread's `AppState`; the derived `Analysis`; transient strings in the drawer and in the CSV copy. No module-level cache under `src/parser`, `src/calculations` or `src/data` may hold any of them (the privacy source gate greps for module-scope `let`/`Map` holding `Portfolio`-typed values).
- "Analyse another statement" and any crash run `cancel → reset → terminate`, dropping the worker heap; the reducer's `RESET` returns the `landing` state, which drops the main-thread `ParseResult` and `Analysis`; the benchmark and category singletons stay because they contain no user data.
- The clipboard CSV is the one artefact that outlives the session by design; the drawer says so next to the button.
- Datasets never cache per user; `navOnOrBefore` and `categoryOf` are pure lookups.

---

## 6. Growth: 10 years, 15 funds, 2,000 transactions

The scenario is fixture 18 (`cams-2025-growth-15f-2000t`): 1 Oct 2015 → 30 Sep 2025, 15 funds in 2 folios, 1,961 `Transaction` rows (1,105 SIP instalments, 717 stamp-duty rows, 4 lump sums, 2 redemptions, 133 to 236 rows per fund), 29 pages at the fixture's 73 lines per page (a real CAMS statement with its denser headers runs 40 to 50 pages for the same content).

Measured on the generated golden (Node 22, Apple silicon; numbers are for the data shape, not the parser's speed):

| Quantity | Measured | Budget (design §7) |
|---|---|---|
| `ParseResult` as JSON | **741 KB** (378 bytes per transaction, of which about 110 bytes are the denormalised `rta`/`folioNumber`/`schemeName`/`isin` columns); **45 KB gzipped** | main thread holds ≤ 5 MB |
| In-memory size of a parsed `ParseResult` (V8 heap, strings included) | **≈ 1.0 MB** per copy; two copies exist transiently during `postMessage` (worker + main) and one after `terminate()` | ≤ 5 MB |
| `structuredClone` of the result (what `postMessage` costs) | **4.8 ms** | ≤ 100 ms |
| Reference XIRR on the pooled series (1,210 dated flows + terminal) | **2.4 ms**; per fund (80–240 flows) < 0.4 ms; all 15 funds + portfolio ≈ 8 ms | ≤ 30 ms |
| Discipline (15 SIP clusters, 1,105 instalments, expected-date generation) | O(n) over purchase rows: ≈ 3 ms estimated from the pin computation | ≤ 20 ms |
| FIFO lots (1,105 acquisition lots, 2 redemptions) | ≈ 2 ms estimated | ≤ 20 ms |
| Index comparison (1,210 legs, binary search over 3,500 NAV points each) | ≈ 1 ms estimated | ≤ 20 ms |
| Golden file on disk | 19 KB (digest) instead of 741 KB; the invariants still pin every fund's units, totals and XIRR | — |

Dashboard render cost: 4 tiles and 15 cards are trivial (React renders ~60 nodes per card). The costly views are the **cashflow drawers**: the portfolio drawer has 1,210 rows and each fund drawer up to 240; above 200 rows the drawer must be virtualised (a fixed-height list rendering ~40 rows) or paginated by year, and "Copy as CSV" builds a ~90 KB string (fine). The allocation donut has at most 5 buckets. The missed-SIP and tax drawers are per fund and small. Sorting cards by XIRR or name re-sorts 15 objects and recomputes nothing (US-13).

Does the model still work? Yes, with margin: at the design's stress point (fixture 19: 7,398 rows, 103 pages) the `ParseResult` is about 2.8 MB JSON / 3.8 MB heap, still under the 5 MB main-thread budget, XIRR on 4,500 flows is under 10 ms, and the only structural requirement is the virtualised drawer. The tree shape (fund → folio → transaction) stays the right one; what would change at 10× that size is moving `useAnalysis` into the worker behind the reserved `analyse` request (design §7.1), not the types. The PDF size of a 100-page detailed CAS is 0.3 to 2 MB in the wild, far below the 50 MB cap.

---

## 7. Type definitions

### 7.1 `src/parser/types.ts` — lift verbatim

Design §4.1 with the single additive delta D1 (`Fund.alsoPrintedAs`). The engine engineer copies this block unchanged.

```ts
// src/parser/types.ts
// Domain types of the parsed CAS. Source of truth: docs/features/sip-lens-v1/01-system-design.md §4.1,
// with the additive deltas of docs/features/sip-lens-v1/02-database-design.md §0.1.

/** Calendar date with no time or zone: 'YYYY-MM-DD'. Branded to stop accidental Date mixing. */
export type ISODate = string & { readonly __brand: 'ISODate' };

export type Rta = 'CAMS' | 'KFINTECH';

/** Closed enum. Adding a member is a schemaVersion bump. */
export type TransactionKind =
  | 'purchase'            // lump sum incl. "Purchase - via myCAMS", "Purchase-BSE", NFO, additional purchase
  | 'sip'                 // "Systematic Investment (n)", "SIP Purchase", "Purchase - Systematic"
  | 'switch_in'           // incl. STP in, lateral shift in
  | 'switch_out'          // incl. STP out, lateral shift out
  | 'redemption'          // incl. SWP
  | 'dividend_payout'     // IDCW payout; cash to investor, units unchanged
  | 'dividend_reinvest'   // IDCW reinvestment; no cash, units added at NAV
  | 'stamp_duty'          // levy row; attaches to a purchase-like parent
  | 'stt_tds'             // STT / TDS / tax-deducted row; attaches to a redemption-like parent
  | 'reversal'            // cancels an earlier row (pairs via `reverses`)
  | 'segregated'          // segregated-portfolio / side-pocket unit creation; no cash
  | 'unit_adjustment'     // bonus, merger, transfer in/out, transmission, broker change; no cash
  | 'unknown';            // dated row whose description matched nothing; raises UNCLASSIFIED_ROW

export interface Transaction {
  /** Stable within a ParseResult: `${fundId}:${folioNumber}:${rowIndex}` (rowIndex = index into folio.transactions). */
  id: string;
  rta: Rta;
  folioNumber: string;
  /** Scheme name as printed on this row's section header, after boilerplate removal, keeping plan and option. */
  schemeName: string;
  isin?: string;
  amfiCode?: string;
  date: ISODate;
  /** Description exactly as printed (multi-line joined with a single space). */
  description: string;
  kind: TransactionKind;
  /**
   * Rupees, SIGNED AS PRINTED in the CAS (scheme perspective): positive when money enters the scheme
   * (purchase, SIP, switch-in, dividend reinvested, levies), negative when it leaves (redemption,
   * switch-out). Dividend payout is printed positive. Reversal rows carry the opposite sign of the row
   * they reverse. 2 decimals. `undefined` for rows that print no amount (segregated, some adjustments).
   * The investor-perspective sign is applied by calculations/cashflows.ts, never here.
   */
  amount?: number;
  /** Units, SIGNED AS PRINTED (negative for redemption/switch-out). Printed precision (3 or 4 dp). */
  units?: number;
  /** NAV per unit as printed, 4 dp typical. */
  nav?: number;
  /** Running unit balance after this row as printed; used for reconciliation. Absent on levy rows. */
  unitBalance?: number;
  /** Page the row started on (for the redacted report; never shown with content). */
  page: number;
  /** For stamp_duty / stt_tds: id of the parent row. */
  attachedTo?: string;
  /** For purchase-like / redemption-like rows: ids of levies attached to them. */
  levies?: string[];
  /** For reversal rows: id of the reversed row. For reversed rows: id of the reversal. */
  reverses?: string;
  reversedBy?: string;
  /** True for reversed pairs, orphan reversals, segregated, unit_adjustment, unknown: shown as "ignored" in the drawer. */
  excludedFromCashflows: boolean;
}

export interface Folio {
  folioNumber: string;
  rta: Rta;
  /** Printed "Opening Unit Balance" (0 for folios opened in the period). */
  openingUnits: number;
  closingUnits?: number;
  closingNav?: number;
  /** Printed closing value (units x NAV as the RTA computed it). */
  closingValue?: number;
  /** As printed on the valuation row, if different from the statement date (A10). */
  valuationDate?: ISODate;
  transactions: Transaction[];
  reconciliation: FolioReconciliation;
}

export interface FolioReconciliation {
  status: 'ok' | 'mismatch' | 'no-closing-balance';
  computedClosingUnits: number;
  printedClosingUnits?: number;
  /** computed - printed, printed precision. */
  diff?: number;
  /** Index (into folio.transactions) of the first running-balance violation. */
  firstMismatchRow?: number;
  /** Tolerance used (A2): 2 x 10^-decimals. */
  toleranceUnits: number;
  decimals: 3 | 4;
}

export interface Fund {
  /** ISIN when printed; else `name:${normalisedSchemeName}|${folioNumber}` (A22, P1). */
  id: string;
  isin?: string;
  amfiCode?: string;
  /** Name printed on the first section seen for this fund (P2). */
  schemeName: string;
  /** Which AMC, extracted from the scheme header ("Mutual Fund" prefix) when printed. */
  amc?: string;
  folios: Folio[];
  /** Sum over folios of printed closing units / value; NAV is the common printed NAV. */
  closingUnits: number;
  closingNav?: number;
  closingValue?: number;
  /** True when any folio reconciliation is not 'ok' or any UNCLASSIFIED_ROW / ORPHAN_REVERSAL / FUTURE_DATED_ROW /
   *  COLUMN_DRIFT / PAGE_EXTRACT_FAILED warning references this fund. Drives "may be incomplete" everywhere (US-08). */
  mayBeIncomplete: boolean;
  /** Delta D1: other scheme names this ISIN was printed under in the same statement (E26). */
  alsoPrintedAs?: string[];
}

export type DocumentType =
  | 'RTA_DETAILED'
  | 'RTA_SUMMARY'
  | 'DEPOSITORY_NSDL'
  | 'DEPOSITORY_CDSL'
  | 'NOT_CAS'
  | 'NO_TEXT';

export interface Portfolio {
  /** Bump on any breaking change to this file. v1.0 ships 1. */
  schemaVersion: 1;
  /** Which RTA generated the document (the file as a whole). Folios carry their own rta. */
  issuer: Rta;
  statementDate: ISODate;
  statementPeriod: { from: ISODate; to: ISODate };
  /** Printed "generated on" date when the CAS prints one. */
  casGeneratedOn?: ISODate;
  /** When this object was produced (ISO 8601 datetime); the ONLY wall-clock value in the engine,
   *  injected by the worker, never read inside parsing. Stripped from goldens. */
  parsedAt: string;
  /** First investor's name line as printed, for the optional greeting only. Never on share card or in reports (A28). */
  investorName?: string;
  /** Distinct investor blocks seen (A3). PANs are not retained. */
  investorCount: number;
  funds: Fund[];
  pageCount: number;
  /** Decimal places the CAS prints for units (3 or 4); informs tolerances. */
  unitDecimals: 3 | 4;
}

export type ParseWarningCode =
  | 'UNCLASSIFIED_ROW'        // dated row, kind 'unknown'
  | 'UNIT_MISMATCH'           // running or closing balance off by more than tolerance
  | 'NO_CLOSING_BALANCE'      // scheme section ended without a closing/valuation row
  | 'ORPHAN_LEVY'             // stamp duty / STT with no same-day parent
  | 'ORPHAN_REVERSAL'         // reversal with no matching original
  | 'MISSING_ISIN'            // identity fell back to name+folio
  | 'MISSING_STATEMENT_DATE'
  | 'FUTURE_DATED_ROW'        // transaction after statement date (A27)
  | 'COLUMN_DRIFT'            // numeric cell outside calibrated columns, or amount/units/NAV arithmetic violated (D9)
  | 'PAGE_EXTRACT_FAILED'     // pdfjs threw for one page; parsing continued
  | 'DUPLICATE_SECTION'       // same folio+scheme header seen twice (duplicate pages)
  | 'MULTI_PAN';              // informational

export interface ParseWarning {
  id: string;                  // `${code}:${fundId ?? '-'}:${page ?? '-'}:${rowIndex ?? '-'}`
  code: ParseWarningCode;
  fundId?: string;
  folioNumber?: string;        // present in the UI banner; STRIPPED by lib/report.ts
  schemeName?: string;         // present in the UI banner; STRIPPED by lib/report.ts
  page?: number;
  rowIndex?: number;
  /** Description text with every digit replaced by '#'. Safe for the redacted report. */
  maskedRowText?: string;
  /** Severity: 'flag' marks the fund mayBeIncomplete; 'info' does not. */
  severity: 'flag' | 'info';
}

export interface ParseResult {
  portfolio: Portfolio;
  warnings: ParseWarning[];
  /** Per fund id: convenience projection of folio reconciliations (worst status wins: mismatch > no-closing-balance > ok). */
  reconciliation: Record<string, FolioReconciliation['status']>;
  stats: {
    pages: number;
    rows: number;
    transactions: number;
    unclassified: number;
    folios: number;
    funds: number;
    extractMs: number;
    parseMs: number;
  };
}

export type ParseErrorCode =
  | 'NOT_PDF'            // main thread
  | 'MULTIPLE_FILES'     // main thread
  | 'FILE_TOO_LARGE'     // main thread, > 50 MB
  | 'PDF_CORRUPT'        // pdfjs could not open (not a password problem)
  | 'TOO_MANY_PAGES'     // > 400
  | 'NO_TEXT'            // scanned / image-only (A4)
  | 'NOT_CAS'            // US-04
  | 'SUMMARY_CAS'        // US-05
  | 'DEPOSITORY_CAS'     // US-06
  | 'NO_FOLIOS_PARSED'   // detailed markers but the walk produced nothing usable (treated by UI as US-04)
  | 'CANCELLED'
  | 'WORKER_CRASH'
  | 'UNSUPPORTED_BROWSER'
  | 'INTERNAL';          // caught exception with a safe, content-free message

export type ParseError =
  | { code: 'NOT_PDF' | 'MULTIPLE_FILES' | 'TOO_MANY_PAGES' | 'PDF_CORRUPT' | 'NO_TEXT' | 'NOT_CAS'
          | 'NO_FOLIOS_PARSED' | 'CANCELLED' | 'WORKER_CRASH' | 'UNSUPPORTED_BROWSER';
      message: string }                                            // message is a fixed UI key (`ui.error.<CODE>`), not content
  | { code: 'FILE_TOO_LARGE'; message: string; sizeBytes: number; limitBytes: number }
  | { code: 'SUMMARY_CAS'; message: string; issuer: Rta; schemeNames: string[]; statementDate?: ISODate }
  | { code: 'DEPOSITORY_CAS'; message: string; depository: 'NSDL' | 'CDSL' }
  | { code: 'INTERNAL'; message: string; stage: 'open' | 'extract' | 'detect' | 'parse' | 'reconcile';
      /** Error class name only (e.g. 'RangeError'); never the message, which could echo content. */
      errorName: string };
```

### 7.2 `src/data/types.ts` — dataset file shapes (new)

```ts
// src/data/types.ts
import type { ISODate } from '../parser/types';

/** On-disk shape of src/data/benchmarkNav.json (02-database-design.md §3.1). */
export interface BenchmarkNavFile {
  schemaVersion: 1;
  fundName: string;                 // 'UTI Nifty 50 Index Fund - Direct Plan - Growth'
  schemeNameOnAmfi: string;         // verbatim AMFI name at generation (D4)
  amfiCode: string;                 // '120716' (to verify at first --apply)
  amcCode: string;                  // AMFI `mf` code, '28' (to verify)
  isin: string;                     // 'INF789F01XA0' (to verify)
  source: { name: string; url: string; endpoint: string; termsUrl: string; licenceNote: string };
  generatedAt: string;              // ISO 8601 datetime
  firstDate: ISODate;
  lastDate: ISODate;
  epoch: ISODate;                   // dayOffsets are days since this date (equals firstDate)
  points: number;                   // === dayOffsets.length === nav.length
  validation: { maxDayChangePct: number | null; maxGapDays: number | null; maxGapAfter: ISODate | null; staleDaysAtGeneration: number };
  dayOffsets: number[];             // strictly increasing integers
  nav: number[];                    // 4 dp, > 0
}

export type CategoryName = 'Equity' | 'Debt' | 'Hybrid' | 'Other';
export type TaxClass = 'equity' | 'debt' | 'hybrid-other' | 'unknown';

/** On-disk shape of src/data/isinCategory.json (02-database-design.md §3.2, delta D3). */
export interface IsinCategoryFile {
  schemaVersion: 1;
  generatedAt: string;
  source: { name: string; url: string; termsUrl: string; licenceNote: string; structures: string[] };
  categories: readonly CategoryName[];              // index 0..3, fixed order
  subCategories: string[];                          // sorted SEBI sub-category strings
  taxClasses: readonly TaxClass[];                  // index 0..3, fixed order
  isinCount: number;
  /** Each group: t = [categoryIdx, subCategoryIdx, taxClassIdx, isElss (0|1)]; isins sorted. No ISIN appears twice. */
  groups: { t: [number, number, number, 0 | 1]; isins: string[] }[];
  /** ISINs that come from the fixture overlay (namespace INF000S01xx), not from AMFI (D6). */
  synthetic: string[];
}
```

### 7.3 `tests/parser/goldenTypes.ts` — golden and fixture metadata (new)

```ts
// tests/parser/goldenTypes.ts
import type { ISODate, ParseError, ParseResult, Portfolio } from '../../src/parser/types';
import type { XirrResult } from '../../src/calculations/types';

export type GoldenResult = Omit<ParseResult, 'portfolio'> & { portfolio: Omit<Portfolio, 'parsedAt'> };

/** Digest form used by the two large fixtures: folio.transactions replaced by count + sha256 (02-database-design.md §4.6). */
export type DigestedResult = Omit<GoldenResult, 'portfolio'> & {
  portfolio: Omit<GoldenResult['portfolio'], 'funds'> & {
    funds: (Omit<GoldenResult['portfolio']['funds'][number], 'folios'> & {
      folios: (Omit<GoldenResult['portfolio']['funds'][number]['folios'][number], 'transactions'> & { transactions: { count: number; sha256: string } })[];
    })[];
  };
  digest: { algorithm: 'sha256'; canonical: string };
};

export type PinnedXirr =
  | { status: 'ok'; ratePct4dp: number; method?: 'newton' | 'bisection'; warning?: 'multiple-roots' }
  | Exclude<XirrResult, { status: 'ok' }>
  | { status: 'insufficient'; reason: 'opening-balance-without-history' };

export interface FixtureInvariants {
  portfolio: {
    asOf: ISODate;
    totalInvested: number; totalRedeemed: number; valueAsOfStatementDate: number; fundsWithoutPrintedValue: number; terminalValue: number;
    skippedFunds: { fundId: string; reason: 'may-be-incomplete' | 'opening-balance-without-history' }[];
    xirr: PinnedXirr;
  };
  funds: Record<string, {
    schemeName: string; closingUnits: number; closingNav?: number; closingValue?: number; mayBeIncomplete: boolean; openingWithoutHistory: boolean;
    invested: number; redeemed: number; netInvested: number; terminalValue: number; cashflowCount: number; ignoredCount: number;
    cashflows?: { date: ISODate; amount: number; label: string }[];           // present when <= 80 flows
    ignored?: { transactionId: string; reason: string }[];                    // present when <= 40 rows
    xirr: PinnedXirr;
  }>;
  discipline: {
    score: number | null;
    sips: { fundId: string; folioNumber: string; frequency: 'weekly' | 'monthly' | 'quarterly'; amounts: { from: ISODate; amount: number }[];
            firstDate: ISODate; lastObserved?: ISODate; counts: { expected: number; made: number; missed: number; stopped: number };
            percent: number; stoppedSince?: ISODate }[];
  };
  taxLots?: Record<string, { taxClass: 'equity' | 'debt' | 'hybrid-other' | 'unknown'; isElss: boolean;
    lots: { acquiredOn: ISODate; units: number; costPerUnit: number; source: string; term: 'long' | 'short' | 'locked'; unlockOn?: ISODate; gain: number }[] }>;
}

export type GoldenFile = {
  goldenVersion: 1;
  fixture: string;                                   // '<name>.pdf'
  generator: { script: 'scripts/gen-fixtures.mjs'; version: string };
  stories: string[]; edges: string[]; notes: string;
} & (
  | { expect: 'result'; digest?: false; result: GoldenResult; invariants: FixtureInvariants }
  | { expect: 'result'; digest: true; result: DigestedResult; invariants: FixtureInvariants }
  | { expect: 'error'; error: ParseError }
);

export interface FixtureMeta {
  fixture: string;
  kind: 'detailed' | 'summary' | 'depository' | 'not-cas' | 'cams-letter' | 'scanned' | 'not-pdf';
  expect: 'result' | ParseError['code'];
  password?: string;                                 // user password when the PDF is protected
  encryption?: 'RC4-128' | 'AES-128' | 'AES-256';
  ownerPasswordOnly?: true;                          // opens without a prompt
  pageCount: number;
  bytes?: number;
  sha256?: string;
  generator: { script: 'scripts/gen-fixtures.mjs'; version: string };
}

export interface FixtureManifest {
  generator: { script: 'scripts/gen-fixtures.mjs'; version: string };
  files: Record<string, { bytes: number; sha256: string }>;   // repo-relative path -> digest
}
```

---

## 8. Scripts delivered

| Script | Purpose | Network | Writes (with `--apply` only) | Dependencies |
|---|---|---|---|---|
| `scripts/refresh-benchmark.mjs` | AMFI NAV history → `src/data/benchmarkNav.json`; identity check on the scheme name; V-15 validation; prints rows, date range, max change/gap, raw and gzipped size | `portal.amfiindia.com` only | `src/data/benchmarkNav.json` | none (Node ≥ 20) |
| `scripts/refresh-isin-map.mjs` | AMFI `NAVAll.txt` → `src/data/isinCategory.json`; SEBI → class table; V-16; diff guard; synthetic overlay | `www.amfiindia.com` only | `src/data/isinCategory.json` | none |
| `scripts/gen-fixtures.mjs` | Synthetic corpus and goldens (§4); `--list`, `--only`, `--no-pdf`, `--render-check` | none | `tests/fixtures/*`, `public/sample-cas.pdf` | `pdfkit` (devDependency) for PDF output only |
| `scripts/lib/cli.mjs` | Arg parsing, repo-root fence (`assertInsideRepo`), atomic writes, stable JSON, date helpers | — | — | none |
| `scripts/lib/amfi.mjs` | Host allow-list fetch with manual redirects, header-mapped parser for both AMFI text formats | — | — | none |
| `scripts/lib/synthetic.mjs` | Seeded PRNG, synthetic calendar, NAV model, Indian number formatting, synthetic ISINs, scheme registry, investors, tiny PNG | — | — | none |
| `scripts/lib/fixtures-spec.mjs` | The 30 fixture definitions and the event → row expansion engine | — | — | none |
| `scripts/lib/cas-layout.mjs` | Pure page layout (what text goes where, on which page) for both RTA styles and the non-CAS documents | — | — | none |
| `scripts/lib/golden.mjs` | ParseResult projection, reference XIRR, cashflow mapping, discipline and FIFO pins, digest | — | — | none |
| `scripts/lib/cas-pdf.mjs` | pdfkit drawing, encryption variants, scanned pages, not-a-PDF bytes | — | — | `pdfkit` (lazy) |

All three CLIs print help with `--help`, exit 0 on a clean dry-run, 2 on a validation failure (nothing written) and 1 on an unexpected error. None of them reads, lists or opens any PDF; the generator has no inputs at all. The `refresh-data.yml` workflow for F0:

```yaml
name: refresh-data
on:
  schedule: [{ cron: '0 3 1 * *' }]
  workflow_dispatch:
permissions: { contents: write, pull-requests: write }
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: node scripts/refresh-benchmark.mjs --apply | tee benchmark.log
      - run: node scripts/refresh-isin-map.mjs --apply | tee isin.log
      - run: npm ci && npm test -- tests/data
      - uses: peter-evans/create-pull-request@v6
        with:
          branch: data/refresh-${{ github.run_id }}
          title: 'data: monthly AMFI refresh'
          body-path: benchmark.log
          add-paths: src/data/benchmarkNav.json,src/data/isinCategory.json
```

Verification status of this document: the pure path (`expandFixture → layoutCas → buildGolden`) was executed for all 30 fixtures from a scratch runner outside the repository to obtain the numbers in §4.3 and §6; the AMFI scripts and the PDF rendering path were syntax-checked only (no network, no `npm install`, nothing written to the repository by any script).
