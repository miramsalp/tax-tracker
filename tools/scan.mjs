/**
 * Runs the real parser over a folder of PDFs and reports what passed, what
 * failed, and why. This is the gate for the parser: it has to reproduce every
 * number the documents print before any of it is worth showing in a UI.
 *
 *   npm run scan -- [folder] [--json out.json] [--csv]
 *
 * The password is read from .password.local (gitignored) or DIME_PDF_PASSWORD.
 * Nothing here prints names, addresses or full tax IDs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPdf } from './pdfjs-node.mjs';
import { parsePdf } from '../src/parser/pdf.ts';
import { isRejected } from '../src/core/types.ts';
import { runFifo } from '../src/engine/fifo.ts';
import { summarise, completeness } from '../src/engine/summary.ts';

const root = process.cwd();
const args = process.argv.slice(2);
const folder = path.resolve(root, args.find((a) => !a.startsWith('--')) ?? 'dime_pdf');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const wantCsv = args.includes('--csv');

const password =
  process.env.DIME_PDF_PASSWORD ??
  (fs.existsSync(path.join(root, '.password.local'))
    ? fs.readFileSync(path.join(root, '.password.local'), 'utf8').trim()
    : undefined);

if (!fs.existsSync(folder)) {
  console.error(`folder not found: ${folder}`);
  process.exit(1);
}

const files = fs
  .readdirSync(folder)
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .map((f) => path.join(folder, f));

if (files.length === 0) {
  console.error(`no PDFs in ${folder}`);
  process.exit(1);
}

const CONCURRENCY = 4;
const results = new Array(files.length);
let cursor = 0;

async function worker() {
  while (cursor < files.length) {
    const i = cursor++;
    const file = files[i];
    try {
      const data = new Uint8Array(fs.readFileSync(file));
      results[i] = await parsePdf(loadPdf, path.basename(file), data, password);
    } catch (err) {
      results[i] = { file: path.basename(file), error: `${err.name}: ${err.message}` };
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// ---------------------------------------------------------------- reporting

const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const units = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 7 });
const mask = (id) => (id ? `${id.slice(0, 1)}-xxxx-xxxxx-xx-${id.slice(-1)}` : '(none)');
const bump = (o, k) => (o[k] = (o[k] ?? 0) + 1);

const parsed = [];
const rejected = [];
const errored = [];
const docWarnings = [];
const byCategory = {};
const bySide = {};
const checksumFailures = {};
const accounts = {};
const taxIds = {};
let rowCount = 0;
let lowConfidence = 0;

for (const r of results) {
  if (r.error) { errored.push(`${r.file} :: ${r.error}`); continue; }
  if (isRejected(r)) { rejected.push(`${r.file} :: ${r.reject}`); continue; }
  parsed.push(r);
  bump(byCategory, r.category);
  bump(accounts, `${r.category}:${r.header.accountNo}`);
  bump(taxIds, mask(r.header.taxId));
  for (const w of r.warnings) docWarnings.push(`${r.file} :: ${w}`);
  for (const tx of r.transactions) {
    rowCount++;
    bump(bySide, `${r.category}:${tx.side}`);
    if (tx.confidence === 'low') {
      lowConfidence++;
      for (const w of tx.warnings) bump(checksumFailures, `${r.category}: ${w}`);
    }
  }
}

const clean = rowCount - lowConfidence;
const rate = rowCount > 0 ? (clean / rowCount) * 100 : 0;

console.log(`\nscanned ${files.length} files in ${path.relative(root, folder) || '.'}`);
console.log(`  parsed        ${parsed.length}`);
console.log(`  rejected      ${rejected.length}`);
console.log(`  errored       ${errored.length}`);
console.log(`  rows          ${rowCount}`);
console.log(`  checksum pass ${clean}/${rowCount} (${rate.toFixed(2)}%)`);

const table = (title, obj) => {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return;
  console.log(`\n${title}`);
  for (const [k, v] of entries) console.log(`  ${String(v).padStart(5)}  ${k}`);
};

table('by category', byCategory);
table('by side', bySide);
table('checksum failures', checksumFailures);
table('accounts', accounts);
table('account holders (masked)', taxIds);

const list = (title, arr, limit = 20) => {
  console.log(`\n${title} (${arr.length})`);
  for (const x of arr.slice(0, limit)) console.log(`  ${x}`);
  if (arr.length > limit) console.log(`  ... and ${arr.length - limit} more`);
};
list('rejected', rejected);
if (errored.length) list('errors', errored);
list('document warnings', docWarnings);

// ------------------------------------------------------------------- engine

const transactions = parsed.flatMap((r) => r.transactions);
const { realized, open, orphans } = runFifo(transactions);
const periods = summarise(realized);
const gaps = completeness(orphans);

const dates = transactions.map((t) => t.tradeDate).filter(Boolean).sort();
console.log(`\ntrade dates ${dates[0]} .. ${dates[dates.length - 1]}`);
console.log(`realized lots ${realized.length}  open lots ${open.length}  orphan sells ${orphans.length}`);

console.log('\nrealized P/L by year and category (THB)');
console.log('  year  category    lots           net         gains        losses');
for (const p of periods) {
  console.log(
    `  ${p.year}  ${p.category.padEnd(10)} ${String(p.lots).padStart(4)}  ` +
      `${money(p.netPnL).padStart(12)}  ${money(p.sumOfGains).padStart(12)}  ${money(p.sumOfLosses).padStart(12)}`,
  );
}

if (gaps.length > 0) {
  console.log('\nsales with no cost basis (excluded from gains above)');
  for (const g of gaps) {
    console.log(`  ${g.year}  ${g.category.padEnd(10)} ${String(g.orphanCount).padStart(3)} sales  ` +
      `THB ${money(g.unaccountedProceedsTHB).padStart(14)} of proceeds unaccounted`);
  }
}

const positions = new Map();
for (const lot of open) {
  const key = `${lot.accountNo}|${lot.symbol}`;
  const p = positions.get(key) ?? { symbol: lot.symbol, units: 0, cost: 0, lots: 0, since: lot.tradeDate };
  p.units += lot.remainingUnits;
  p.cost += lot.costTHB;
  p.lots += 1;
  if (lot.tradeDate < p.since) p.since = lot.tradeDate;
  positions.set(key, p);
}
const held = [...positions.values()].sort((a, b) => b.cost - a.cost);
console.log(`\nopen positions: ${held.length}, cost basis THB ${money(held.reduce((a, p) => a + p.cost, 0))}`);
for (const p of held.slice(0, 10)) {
  console.log(`  ${p.symbol.padEnd(22)} ${units(p.units).padStart(14)} units  THB ${money(p.cost).padStart(13)}  ${p.lots} lots  since ${p.since}`);
}
if (held.length > 10) console.log(`  ... and ${held.length - 10} more`);

if (wantCsv) {
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const rows = [
    'sell_date,symbol,category,instrument,account_no,units_sold,units_matched,units_missing,missing_proceeds_thb,first_buy_in_data,source_file',
    ...orphans.map((o) =>
      [o.tradeDate, o.symbol, o.category, o.instrument, o.accountNo, o.unitsSold, o.unitsMatched,
       o.unitsMissing, o.missingProceedsTHB, o.firstBuyInData ?? '', o.sellFile ?? ''].join(','),
    ),
  ];
  fs.writeFileSync(path.join(dir, 'orphans.csv'), rows.join('\n'), 'utf8');
  console.log(`\nwrote data/orphans.csv (${orphans.length} rows)`);
}

if (jsonOut) {
  fs.writeFileSync(path.resolve(root, jsonOut), JSON.stringify({ periods, gaps, orphans }, null, 2), 'utf8');
  console.log(`wrote ${jsonOut}`);
}

const failed = errored.length > 0 || rate < 95;
if (failed) {
  console.log(`\nFAIL: checksum pass rate ${rate.toFixed(2)}% (gate is 95%), ${errored.length} errors`);
  process.exit(1);
}
console.log(`\nOK: checksum pass rate ${rate.toFixed(2)}%`);
