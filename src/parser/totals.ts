import type { DocumentTotals } from '../core/types.ts';
import { looksNumeric, parseAmount } from '../core/num.ts';
import type { Page } from './layout.ts';

/**
 * The summary block on the last page, keyed off its English labels. Like the
 * header, each value sits on the line above its label, in the right-hand column.
 */
const TOTAL_LABELS: Record<string, keyof DocumentTotals> = {
  'Total Buy': 'buy',
  'Total Sell': 'sell',
  'Total Subscription': 'buy',
  'Total Redemption': 'sell',
  'Total Fee (Exclude VAT)': 'fee',
  'Total Vat': 'vat',
  'Total Switch in': 'switchIn',
  'Total Switch out': 'switchOut',
};

const VALUE_COLUMN_X = 450;

export function extractTotals(pages: Page[]): DocumentTotals {
  const lines = pages.flat();
  const out: DocumentTotals = {};

  for (let i = 1; i < lines.length; i++) {
    for (const [label, key] of Object.entries(TOTAL_LABELS)) {
      if (!lines[i].items.some((it) => it.s === label)) continue;
      // The Thai caption sometimes wraps, pushing the value two lines up.
      for (const candidate of [lines[i - 1], lines[i - 2]]) {
        if (!candidate) continue;
        const values = candidate.items.filter(
          (it) => it.x > VALUE_COLUMN_X && looksNumeric(it.s),
        );
        if (values.length > 0) {
          out[key] = parseAmount(values[values.length - 1].s);
          break;
        }
      }
    }
  }
  return out;
}
