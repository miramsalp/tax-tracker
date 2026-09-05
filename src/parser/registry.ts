import type { Category, DocumentHeader, Transaction } from '../core/types.ts';
import { pageText, type Page } from './layout.ts';
import { parseOffshore } from './parsers/offshore.ts';
import { parseThEquity } from './parsers/thEquity.ts';
import { parseThFund } from './parsers/thFund.ts';

export type FormatId = Category | 'monthly_statement' | 'unknown';

export interface FormatEntry {
  id: FormatId;
  /** Cheap structural markers, matched against the document's flattened text. */
  matches: (text: string) => boolean;
  parse?: (pages: Page[], header: DocumentHeader) => Transaction[];
}

/**
 * Every confirmation note carries this title; no statement does. Requiring it
 * keeps a statement from being parsed as a confirmation note when the two share
 * column headings — a monthly mutual fund statement also prints "Fund Name" and
 * "NAV/Unit", and without this guard it parses as a fund confirmation whose
 * account number and tax ID come out empty.
 */
const CONFIRMATION_TITLE = /Confirmation Note/;

/**
 * Statement detection runs first and on its own marker, so a new statement
 * layout is rejected rather than silently parsed by the closest-looking parser.
 */
export const FORMATS: FormatEntry[] = [
  {
    id: 'monthly_statement',
    // Reports month-end holdings, not individual fills, so it carries no
    // transaction-level data for FIFO. Both the mutual fund and offshore
    // variants share this title.
    matches: (t) => /Monthly Statement/i.test(t),
  },
  {
    id: 'th_fund',
    matches: (t) => CONFIRMATION_TITLE.test(t) && /NAV\/Unit/.test(t) && /Fund Name/.test(t),
    parse: parseThFund,
  },
  {
    id: 'offshore',
    matches: (t) => CONFIRMATION_TITLE.test(t) && /Withholding Tax/.test(t) && /\[Exchange\]/.test(t),
    parse: parseOffshore,
  },
  {
    id: 'th_equity',
    matches: (t) => CONFIRMATION_TITLE.test(t) && /Price\/Share/.test(t) && /Gross Amount/.test(t),
    parse: parseThEquity,
  },
];

export function detectFormat(pages: Page[]): FormatEntry {
  const text = pageText(pages);
  return FORMATS.find((f) => f.matches(text)) ?? { id: 'unknown', matches: () => false };
}
