/**
 * Compares the position our transactions produce at each month end against the
 * holdings the monthly statement reports for that month.
 *
 * A symbol that matches every month up to March and then differs from April
 * onward tells you the missing confirmation note is dated April — which beats
 * searching a whole symbol's history.
 *
 *   node tools/reconcile.mjs [folder]
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPdf } from './pdfjs-node.mjs';
import { extractPages } from '../src/parser/pdf.ts';
import { parsePages } from '../src/parser/index.ts';
import { parseStatements } from '../src/parser/statement.ts';
import { isRejected } from '../src/core/types.ts';
import { runFifo } from '../src/engine/fifo.ts';

const root = process.cwd();
const folder = path.resolve(root, process.argv[2] ?? 'dime_pdf');
const password =
  process.env.DIME_PDF_PASSWORD ??
  (fs.existsSync(path.join(root, '.password.local'))
    ? fs.readFileSync(path.join(root, '.password.local'), 'utf8').trim()
    : undefined);

const files = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf'));

const transactions = [];
const statements = [];
let cursor = 0;

async function worker() {
  while (cursor < files.length) {
    const name = files[cursor++];
    const data = new Uint8Array(fs.readFileSync(path.join(folder, name)));
    // pdf.js detaches the buffer it is handed, so the pages are extracted once
    // and both the confirmation path and the statement path read from them.
    const pages = await extractPages(loadPdf, data, password);
    const result = parsePages(name, pages);
    if (!isRejected(result)) {
      transactions.push(...result.transactions);
      continue;
    }
    if (result.reject !== 'monthly_statement') continue;
    statements.push(...parseStatements(name, pages));
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

statements.sort((a, b) => (a.asOf ?? '').localeCompare(b.asOf ?? ''));
console.log(`transactions ${transactions.length}   statements ${statements.length}`);

const withHoldings = statements.filter((s) => s.holdings.length > 0);
if (withHoldings.length === 0) {
  console.log('no statement holdings could be read');
  process.exit(0);
}
console.log(
  `statement months ${withHoldings[0].asOf} .. ${withHoldings[withHoldings.length - 1].asOf}\n`,
);

const units = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 7 });
const TOLERANCE = 1e-4;

let firstGapPerSymbol = new Map();
let totalMismatches = 0;

for (const statement of withHoldings) {
  if (!statement.asOf || !statement.accountNo) continue;

  // Replay only what had traded by the statement date.
  const upTo = transactions.filter(
    (t) => t.accountNo === statement.accountNo && t.tradeDate <= statement.asOf,
  );
  if (upTo.length === 0) continue;

  const { open } = runFifo(upTo);
  const computed = new Map();
  for (const lot of open) {
    computed.set(lot.symbol, (computed.get(lot.symbol) ?? 0) + lot.remainingUnits);
  }

  const symbols = new Set([...computed.keys(), ...statement.holdings.map((h) => h.symbol)]);
  const rows = [];
  for (const symbol of symbols) {
    const ours = computed.get(symbol) ?? 0;
    const theirs = statement.holdings.find((h) => h.symbol === symbol)?.units ?? 0;
    const diff = ours - theirs;
    if (Math.abs(diff) < TOLERANCE) continue;
    rows.push({ symbol, ours, theirs, diff });
    if (!firstGapPerSymbol.has(symbol)) {
      firstGapPerSymbol.set(symbol, { month: statement.period, asOf: statement.asOf, diff });
    }
  }

  totalMismatches += rows.length;
  if (rows.length === 0) {
    console.log(`${statement.asOf}  ${String(statement.period).padEnd(16)} all ${symbols.size} symbols match`);
    continue;
  }
  console.log(`${statement.asOf}  ${String(statement.period).padEnd(16)} ${rows.length} mismatch(es)`);
  for (const r of rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))) {
    const verdict = r.diff < 0 ? 'we are short — a BUY is missing' : 'we hold too many — a SELL is missing';
    console.log(
      `    ${r.symbol.padEnd(22)} ours ${units(r.ours).padStart(14)}   statement ${units(r.theirs).padStart(14)}   ${verdict}`,
    );
  }
}

if (firstGapPerSymbol.size > 0) {
  console.log(`\nfirst month each symbol goes out of step — look for paperwork dated that month:`);
  const sorted = [...firstGapPerSymbol.entries()].sort((a, b) => a[1].asOf.localeCompare(b[1].asOf));
  for (const [symbol, gap] of sorted) {
    console.log(`  ${symbol.padEnd(22)} ${gap.month}  (off by ${units(gap.diff)} units)`);
  }
}
console.log(`\n${totalMismatches} mismatched symbol-months across ${withHoldings.length} statements`);
