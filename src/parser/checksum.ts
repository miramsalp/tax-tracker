import type { Transaction, Category } from '../core/types.ts';
import { grossTolerance, MONEY_TOLERANCE } from '../core/num.ts';

/**
 * Every row is re-derived from its own printed parts. A row that fails is kept
 * and flagged — never dropped, never corrected. These are tax documents; a
 * number we cannot reproduce is a number the user has to look at.
 */

/** Sides that add to a position. REW is deliberately absent — see isAcquisition. */
const BUY_SIDES = new Set(['BUY', 'SUB', 'SWI']);

export function isBuySide(side: string): boolean {
  return BUY_SIDES.has(side);
}

export function checkRow(tx: Transaction, category: Category): string[] {
  const warnings: string[] = [];
  const sign = isBuySide(tx.side) ? 1 : -1;

  // Mutual funds print no gross column; units x NAV reproduces the total instead.
  if (category === 'th_fund') {
    if (Math.abs(tx.units * tx.price - tx.total) > grossTolerance(tx.units)) {
      warnings.push('units x NAV does not equal total');
    }
    return warnings;
  }

  if (Math.abs(tx.units * tx.price - tx.gross) > grossTolerance(tx.units)) {
    warnings.push('units x price does not equal gross');
  }

  if (category === 'th_equity') {
    const expected = tx.gross + sign * (tx.fee + tx.vat);
    if (Math.abs(expected - tx.total) > MONEY_TOLERANCE) {
      warnings.push('gross +/- fee +/- VAT does not equal total');
    }
  }

  if (category === 'offshore') {
    const expected = tx.gross + sign * (tx.fee + tx.withholdingTax);
    if (Math.abs(expected - tx.total) > MONEY_TOLERANCE) {
      warnings.push('USD leg: gross +/- fee +/- withholding does not equal total');
    }
    // The THB leg is converted then rounded, so it needs a slightly wider band.
    const expectedTHB = tx.grossTHB + sign * (tx.feeTHB + tx.withholdingTaxTHB);
    if (Math.abs(expectedTHB - tx.totalTHB) > 0.02) {
      warnings.push('THB leg: gross +/- fee +/- withholding does not equal total');
    }
  }

  return warnings;
}

/**
 * Cross-check the parsed rows against the summary block the document prints on
 * its last page. This catches a whole row that the row parser failed to see,
 * which per-row checksums cannot.
 *
 * REW rows are excluded because Dime excludes them from its own totals.
 */
export function checkDocumentTotals(
  transactions: Transaction[],
  totals: { buy?: number; sell?: number },
  category: Category,
): string[] {
  const warnings: string[] = [];
  const amount = (t: Transaction) => (category === 'offshore' ? t.totalTHB : t.total);
  const counted = transactions.filter((t) => t.side !== 'REW');

  const sums = {
    buy: counted.filter((t) => isBuySide(t.side)).reduce((a, t) => a + amount(t), 0),
    sell: counted.filter((t) => !isBuySide(t.side)).reduce((a, t) => a + amount(t), 0),
  };

  for (const key of ['buy', 'sell'] as const) {
    const printed = totals[key];
    if (printed === undefined) continue;
    if (Math.abs(printed - sums[key]) > 0.02) {
      warnings.push(
        `document total ${key} is ${printed.toFixed(2)} but the rows sum to ${sums[key].toFixed(2)}`,
      );
    }
  }
  return warnings;
}
