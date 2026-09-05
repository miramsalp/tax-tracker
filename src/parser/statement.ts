import { parseAmount } from '../core/num.ts';
import { cells, type Line, type Page } from './layout.ts';

/**
 * Monthly statements are rejected as a transaction source — they report
 * month-end balances, not the individual fills FIFO needs. They are still worth
 * reading for one thing: the holdings table says how many units the broker
 * thought you held at the end of each month.
 *
 * Diffing that against the position our own transactions produce pins a gap in
 * the paperwork down to a single month, which is far less work than hunting for
 * a missing confirmation note symbol by symbol.
 *
 * One PDF can hold more than one statement: Dime concatenates the mutual fund
 * report and the offshore report into a single monthly file, each with its own
 * account number and its own holdings table. Reading the file as one statement
 * pairs the first account number with everybody's holdings, so the file is split
 * into sections first.
 */

export interface StatementHolding {
  symbol: string;
  units: number;
  /** Weighted average in the trade currency, as printed. */
  averageCost: number;
  price: number;
  marketValue: number;
}

export interface ParsedStatement {
  file: string;
  accountNo: string | null;
  accountKind: 'mutual_fund' | 'offshore' | 'th_equity' | 'unknown';
  /** ISO date of the last day of the reported month. */
  asOf: string | null;
  /** e.g. "October 2024" */
  period: string | null;
  holdings: StatementHolding[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SECTION_TITLE = /(Mutual Fund|Offshore Securities|Thai Securities) Account Monthly Statement/;

const SECTION_KIND: Record<string, ParsedStatement['accountKind']> = {
  'Mutual Fund': 'mutual_fund',
  'Offshore Securities': 'offshore',
  'Thai Securities': 'th_equity',
};

/**
 * Holdings rows carry eight cells:
 *   symbol | % of port | shares | average cost | price | return % | return | market value
 */
const HOLDING_CELL_COUNT = 8;
// Thai depositary receipts carry a numeric suffix, e.g. BIDU80, ASML01.
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;
const PERCENT = /%$/;

const COLUMN_TOLERANCE = 30;
const LOOKAHEAD_LINES = 4;

export function parseStatements(file: string, pages: Page[]): ParsedStatement[] {
  const sections: { kind: ParsedStatement['accountKind']; lines: Line[] }[] = [];

  for (const page of pages) {
    const text = page.map((l) => l.text).join('\n');
    const title = text.match(SECTION_TITLE);
    // The title repeats as a running header on every page of a section, so on
    // its own it would start a new section per page. The account block appears
    // only on a section's first page, which is what marks the real boundary.
    if (title && /Account No\./i.test(text)) {
      sections.push({
        kind: SECTION_KIND[title[1]] ?? 'unknown',
        lines: [],
      });
    }
    if (sections.length === 0) continue;
    sections[sections.length - 1].lines.push(...page);
  }

  return sections.map((section) => ({
    file,
    accountKind: section.kind,
    accountNo: findAccountNo(section.lines),
    ...findPeriod(section.lines.map((l) => l.text).join('\n')),
    holdings: readHoldings(section.lines),
  }));
}

function readHoldings(lines: Line[]): StatementHolding[] {
  const holdings: StatementHolding[] = [];
  for (const line of lines) {
    const c = cells(line);
    if (c.length !== HOLDING_CELL_COUNT) continue;
    if (!TICKER.test(c[0]) || !PERCENT.test(c[1])) continue;
    const units = parseAmount(c[2]);
    if (!Number.isFinite(units)) continue;
    holdings.push({
      symbol: c[0],
      units,
      averageCost: parseAmount(c[3]),
      price: parseAmount(c[4]),
      marketValue: parseAmount(c[7]),
    });
  }
  return holdings;
}

function findPeriod(text: string): { period: string | null; asOf: string | null } {
  const m = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{4})\\b`).exec(text);
  if (!m) return { period: null, asOf: null };
  const month = MONTHS.indexOf(m[1]) + 1;
  const year = Number.parseInt(m[2], 10);
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    period: `${m[1]} ${m[2]}`,
    asOf: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * A statement prints the account number *below* its label rather than above it.
 * The line immediately below carries the holder's name and the one after that
 * the tax ID, which is also a run of digits — so the value is picked by sharing
 * the label's column, not by being the next number to appear.
 */
function findAccountNo(lines: Line[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].items.find((it) => /Account No\./i.test(it.s));
    if (!label) continue;
    for (let k = 1; k <= LOOKAHEAD_LINES; k++) {
      const hit = lines[i + k]?.items.find(
        (it) => /^\d{8,15}$/.test(it.s) && Math.abs(it.x - label.x) <= COLUMN_TOLERANCE,
      );
      if (hit) return hit.s;
    }
  }
  return null;
}
