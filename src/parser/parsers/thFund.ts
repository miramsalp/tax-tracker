import type { Transaction, DocumentHeader } from '../../core/types.ts';
import { parseAmount } from '../../core/num.ts';
import { transactionId } from '../../core/id.ts';
import { cells, type Page } from '../layout.ts';

/**
 * Mutual fund rows are a single line of seven cells:
 *
 *   Order ID | Transaction Type | Fund Name | Units | NAV/Unit | Total Amount | Fee Include Vat
 *
 * Differences from the equity template that matter downstream:
 *  - there is no settlement date column at all
 *  - there is no gross column; units x NAV reproduces Total Amount
 *  - the fee is printed VAT-inclusive and sits outside Total Amount
 *  - sides are SUB/RED/SWI/SWO, and a switch is a redemption and a subscription
 *    of two different funds carrying one order id
 */
const FIELD_COUNT = 7;

export function parseThFund(pages: Page[], header: DocumentHeader): Transaction[] {
  const out: Transaction[] = [];
  const seen = new Map<string, number>();

  for (const line of pages.flat()) {
    const c = cells(line);
    if (c.length !== FIELD_COUNT) continue;
    if (!/^\d{14,18}$/.test(c[0])) continue;
    if (!/^(SUB|RED|SWI|SWO)$/.test(c[1])) continue;

    const [orderNo, side, symbol, units, nav, total, fee] = c;
    const occurrence = (seen.get(symbol) ?? 0) + 1;
    seen.set(symbol, occurrence);

    const totalValue = parseAmount(total);
    const feeValue = parseAmount(fee);

    out.push({
      id: transactionId({
        taxInvoiceNo: header.taxInvoiceNo ?? '',
        orderNo,
        symbol,
        occurrence,
      }),
      source: 'pdf',
      sourceFile: null,
      accountNo: header.accountNo ?? '',
      taxId: header.taxId ?? '',
      taxInvoiceNo: header.taxInvoiceNo ?? '',
      orderNo,
      category: 'th_fund',
      instrument: 'fund',
      tradeDate: header.effectiveDate ?? '',
      settlementDate: null,
      side: side as Transaction['side'],
      symbol,
      exchange: null,
      units: parseAmount(units),
      price: parseAmount(nav),
      gross: totalValue,
      fee: feeValue,
      vat: 0, // printed inclusive of VAT
      withholdingTax: 0,
      total: totalValue,
      currency: 'THB',
      grossTHB: totalValue,
      feeTHB: feeValue,
      withholdingTaxTHB: 0,
      totalTHB: totalValue,
      fxRate: 1,
      fxEstimated: false,
      confidence: 'ok',
      warnings: [],
    });
  }
  return out;
}
