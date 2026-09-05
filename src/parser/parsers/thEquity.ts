import type { Transaction, DocumentHeader } from '../../core/types.ts';
import { parseAmount, toIsoDate } from '../../core/num.ts';
import { transactionId } from '../../core/id.ts';
import { cells, type Page } from '../layout.ts';

/**
 * Thai equity rows are a single line of ten cells in fixed order:
 *
 *   Order No. | Settlement Date | Transaction Type | Securities | Units |
 *   Price/Share | Gross Amount | Fee | VAT | Total Amount
 *
 * Cells are zipped by their order within the row. Mapping by x range does not
 * work here: the numeric columns are right-aligned while their headers are
 * left-aligned, so a value's x can sit outside its own header's span.
 */
const FIELD_COUNT = 10;

export function parseThEquity(pages: Page[], header: DocumentHeader): Transaction[] {
  const out: Transaction[] = [];
  const seen = new Map<string, number>();

  for (const line of pages.flat()) {
    const c = cells(line);
    if (c.length !== FIELD_COUNT) continue;
    if (!/^\d{10,14}$/.test(c[0])) continue;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(c[1])) continue;
    if (!/^(BUY|SEL|REW)$/.test(c[2])) continue;

    const [orderNo, settle, side, symbol, units, price, gross, fee, vat, total] = c;
    const occurrence = (seen.get(symbol) ?? 0) + 1;
    seen.set(symbol, occurrence);

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
      category: 'th_equity',
      instrument: 'equity',
      tradeDate: header.effectiveDate ?? '',
      settlementDate: toIsoDate(settle),
      side: side as Transaction['side'],
      symbol,
      exchange: null,
      units: parseAmount(units),
      price: parseAmount(price),
      gross: parseAmount(gross),
      fee: parseAmount(fee),
      vat: parseAmount(vat),
      withholdingTax: 0,
      total: parseAmount(total),
      currency: 'THB',
      grossTHB: parseAmount(gross),
      feeTHB: parseAmount(fee),
      withholdingTaxTHB: 0,
      totalTHB: parseAmount(total),
      fxRate: 1,
      fxEstimated: false,
      confidence: 'ok',
      warnings: [],
    });
  }
  return out;
}
