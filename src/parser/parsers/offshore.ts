import type { Transaction, DocumentHeader } from '../../core/types.ts';
import { parseAmount, toIsoDate } from '../../core/num.ts';
import { transactionId } from '../../core/id.ts';
import { cells, type Page } from '../layout.ts';

/** OCC option symbol, e.g. ADBE260320C00400000 -> ADBE, 2026-03-20, Call, $400. */
export const OCC_SYMBOL = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function isOptionSymbol(s: string): boolean {
  return OCC_SYMBOL.test(s);
}

export interface OptionDetail {
  underlying: string;
  expiry: string;
  right: 'call' | 'put';
  strike: number;
}

export function parseOptionSymbol(s: string): OptionDetail | null {
  const m = OCC_SYMBOL.exec(s);
  if (!m) return null;
  return {
    underlying: m[1],
    expiry: `20${m[2]}-${m[3]}-${m[4]}`,
    right: m[5] === 'C' ? 'call' : 'put',
    strike: Number.parseInt(m[6], 10) / 1000,
  };
}

/**
 * An offshore trade occupies three visual lines, not one:
 *
 *   MSFT        416.00   0.67  0.00    416.67      <- amounts in the trade currency
 *   050526  01/08/2024  BUY  1.0000000  416.00  USD
 *   [XNAS]  14,810.31  23.85  0.00  14,834.16     <- the same amounts in THB
 *
 * The middle line is the anchor. Options carry a long OCC symbol which does not
 * fit the securities column, so it moves onto the anchor line and the exchange
 * line disappears — giving a second layout that must be handled explicitly:
 *
 *              60.00   0.00  0.00     60.00
 *   186554  24/09/2025  BUY  EOSE251003P00010000  1.0000000  60.00  USD
 *            1,899.13  0.00  0.00  1,899.13
 *
 * Because both legs are printed, the FX rate is observed per row. There is no
 * rate table to import and no external lookup to make.
 */
export function parseOffshore(pages: Page[], header: DocumentHeader): Transaction[] {
  const out: Transaction[] = [];
  const seen = new Map<string, number>();

  for (const page of pages) {
    for (let i = 1; i < page.length - 1; i++) {
      const mid = cells(page[i]);
      const above = cells(page[i - 1]);
      const below = cells(page[i + 1]);

      if (!/^\d{4,12}$/.test(mid[0] ?? '')) continue;
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(mid[1] ?? '')) continue;
      if (!/^(BUY|SEL|REW)$/.test(mid[2] ?? '')) continue;

      let symbol: string;
      let exchange: string | null;
      let units: string, price: string, currency: string;
      let usd: string[], thb: string[];

      const hasExchangeLine = /^\[.+\]$/.test(below[0] ?? '');
      if (mid.length === 6 && above.length === 5 && below.length === 5 && hasExchangeLine) {
        [, , , units, price, currency] = mid;
        symbol = above[0];
        exchange = below[0].slice(1, -1);
        usd = above.slice(1);
        thb = below.slice(1);
      } else if (mid.length === 7 && above.length === 4 && below.length === 4) {
        [, , , symbol, units, price, currency] = mid;
        exchange = null;
        usd = above;
        thb = below;
      } else {
        continue;
      }

      const [gross, fee, withholdingTax, total] = usd.map(parseAmount);
      const [grossTHB, feeTHB, withholdingTaxTHB, totalTHB] = thb.map(parseAmount);

      const occurrence = (seen.get(symbol) ?? 0) + 1;
      seen.set(symbol, occurrence);

      out.push({
        id: transactionId({
          taxInvoiceNo: header.taxInvoiceNo ?? '',
          orderNo: mid[0],
          symbol,
          occurrence,
        }),
        source: 'pdf',
        sourceFile: null,
        accountNo: header.accountNo ?? '',
        taxId: header.taxId ?? '',
        taxInvoiceNo: header.taxInvoiceNo ?? '',
        orderNo: mid[0],
        category: 'offshore',
        instrument: isOptionSymbol(symbol) ? 'option' : 'equity',
        tradeDate: header.effectiveDate ?? '',
        settlementDate: toIsoDate(mid[1]),
        side: mid[2] as Transaction['side'],
        symbol,
        exchange,
        units: parseAmount(units),
        price: parseAmount(price),
        gross,
        fee,
        vat: 0, // offshore fees are printed VAT-inclusive
        withholdingTax,
        total,
        currency: currency === 'THB' ? 'THB' : 'USD',
        grossTHB,
        feeTHB,
        withholdingTaxTHB,
        totalTHB,
        fxRate: gross !== 0 ? grossTHB / gross : null,
        fxEstimated: false,
        confidence: 'ok',
        warnings: [],
      });
    }
  }
  return out;
}
