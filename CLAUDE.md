# CLAUDE.md

Static web app that reads KKP Dime confirmation notes and computes FIFO realized
P/L plus the offshore tax figures. No backend, no database, no network.

## Commands

```bash
npm run dev          # vite dev server on 5173
npm run build        # tsc -b && vite build (injects the CSP meta tag)
npm test             # vitest, synthetic fixtures only
npm run typecheck
npm run scan -- dime_pdf --csv   # run the real parser over a folder, exits 1 below a 95% checksum rate
npm run reconcile                # diff computed positions against statement holdings
```

The CLI tools read the password from `.password.local` (gitignored) or
`DIME_PDF_PASSWORD`. They import the same `src/` modules the browser uses, so
what the CLI reports is what the app produces — reach for `npm run scan` to
verify a parser change against real documents before touching the UI.

## Rules that override convenience

These come from the spec and are not negotiable without asking:

1. **Never guess a number.** A row whose arithmetic does not reproduce gets
   `confidence: 'low'` and a warning. It is never dropped, never corrected.
2. **Never hide a loss.** Filtering to what needs review is fine; a filter that
   removes losing rows is not. The monthly chart is a diverging bar.
3. **No outbound requests, ever.** No `fetch`, no CDN fonts, no analytics. The
   CSP (`vite.config.ts` and `vercel.json`) enforces `connect-src 'self'`.
4. **Never log personal data**, including in dev. There are currently zero
   `console.*` calls in `src/`; keep it that way. Mask tax IDs when printing.
5. **Every figure traces to a source.** PDF rows carry `sourceFile`,
   `taxInvoiceNo`, `orderNo`. Hand-entered rows carry `source: 'manual'`, and
   that provenance must survive into the tax totals — see `costSource` on
   `RealizedLot`.
6. **Never commit a real document.** `.gitignore` covers `*.pdf`, `dime_pdf/`,
   `samples/`, `data/`, `.password.local`. Test fixtures are synthetic
   (`tests/fixtures.ts`) and reproduce the layout, not the content.

## Architecture

```
src/core/      types, rounding, ids — no I/O
src/parser/    layout.ts (positioned text -> rows) -> registry -> parsers/*
               pdf.ts is the ONLY module that touches pdf.js
src/engine/    fifo.ts, summary.ts — pure functions over Transaction[]
src/worker/    parse.worker.ts — all PDF work happens here
src/app/       importer (worker pool), store (Dexie), manual entry
src/ui/        React screens
tools/         Node CLIs sharing the same src/ modules
```

`parsePages(file, pages)` is pure and takes already-extracted lines, which is
why the parser tests need no PDF. `pdf.ts` takes its loader by injection so Node
and the browser can supply different pdf.js builds.

## Document facts that drive the parser

Learned from 250 real documents; changing any of these breaks silently.

- **Cluster rows on y with a tolerance of 2, then sort by x *within* the
  cluster.** Items on one row differ in y by 1–2 units. A global sort leaves a
  jittered cell at the end of the row and shifts every column after it.
- **Zip columns by position, never by x range.** Numbers are right-aligned while
  headers are left-aligned, so a value's x falls outside its own header's span.
  The same trick is what makes the header block parse (`header.ts`).
- **The trade date is the header's Effective Date**, not the row's settlement
  date. FIFO and FX both need the trade date.
- **Two tax IDs appear on every document.** The broker's registration number is
  top-right; the account holder's sits next to the `TAX I.D.` label. Taking the
  first 13-digit number matches every file to the broker and makes the
  same-person check useless.
- **An offshore trade spans three visual lines** — symbol and USD amounts above,
  the anchor line (order/date/side/units/price/currency), THB amounts below.
  Both legs are printed, so **the FX rate is observed per row; there is no rate
  table and nothing is fetched.**
- **Options use a second layout.** The long OCC symbol does not fit the
  securities column, so it moves onto the anchor line and the `[EXCH]` line
  disappears. Handling only the equity layout loses those rows silently.
- **`REW` (reward shares) is a third side.** Dime excludes it from its own Total
  Buy and Total Sell, so the document-totals cross-check must too.
- **Mutual funds print no settlement date and no gross column**; sides are
  SUB/RED/SWI/SWO, and a switch is a disposal and an acquisition at once.
- **The `units x price` tolerance must scale with size** (`units * 0.005 +
  0.011`). Price is printed to 2dp while units carry 7, so a flat ±0.01 falsely
  flags about a third of real fractional-share rows.
- **One statement PDF holds up to three statements** concatenated — Mutual Fund,
  Offshore Securities, Thai Securities — each with its own account number and
  holdings table. The running-header title repeats on every page, so a section
  starts only where the account block also appears.

## Gotchas

- **Relative imports need the `.ts` extension.** Node's ESM loader requires it
  and `allowImportingTsExtensions` is on so the CLI and Vite share one path.
- **pdf.js detaches the buffer it is handed.** Extract pages once and branch
  afterwards; a second `getDocument` on the same bytes throws `DataCloneError`.
- **Same-day ordering matters.** `orderTransactions` puts acquisitions before
  disposals within a date; without it a third of the orphans are phantom.
- Editing files with heredocs or Python `str.replace` has bitten this repo
  twice (mangled imports, silent no-op replaces). Prefer the Edit tool.
