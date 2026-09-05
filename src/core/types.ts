export type Category = 'th_equity' | 'th_fund' | 'offshore';

/** Sub-type within a category. Offshore holds both plain equity and OCC options. */
export type Instrument = 'equity' | 'fund' | 'option';

/**
 * Raw side codes as printed by Dime. Kept verbatim rather than normalised to
 * BUY/SELL so a row always traces back to what the document actually said.
 *   REW = free reward shares. Dime excludes these from its own Total Buy/Total Sell.
 *   SWI/SWO = mutual fund switch in/out.
 */
export type Side = 'BUY' | 'SEL' | 'REW' | 'SUB' | 'RED' | 'SWI' | 'SWO';

export type Currency = 'THB' | 'USD';

/** Where a number came from. Propagates through FIFO into the tax figures. */
export type Provenance = 'pdf' | 'manual' | 'unknown_cost';

export interface Transaction {
  /** hash(taxInvoiceNo + orderNo + symbol) — stable across re-imports. */
  id: string;
  source: Provenance;
  /** Present for source==='pdf'. Null for manual entries. */
  sourceFile: string | null;
  /** Free-text reason, required for manual entries. */
  note?: string;

  accountNo: string;
  taxId: string;
  taxInvoiceNo: string;
  orderNo: string;

  category: Category;
  instrument: Instrument;

  /** ISO. From the header's Effective Date — never the row's settlement date. */
  tradeDate: string;
  /** ISO. Null for mutual funds, which do not print one. */
  settlementDate: string | null;

  side: Side;
  symbol: string;
  /** Offshore only, e.g. XNAS. */
  exchange?: string | null;

  units: number;
  price: number;
  gross: number;
  /** Offshore fees are VAT-inclusive; th_equity prints fee and VAT separately. */
  fee: number;
  vat: number;
  /** Offshore only. */
  withholdingTax: number;
  total: number;

  currency: Currency;

  /** Offshore prints both legs, so the rate is observed, never assumed. */
  grossTHB: number;
  feeTHB: number;
  withholdingTaxTHB: number;
  totalTHB: number;
  fxRate: number | null;
  fxEstimated: boolean;

  confidence: 'ok' | 'low';
  warnings: string[];
}

export interface ParsedDocument {
  file: string;
  category: Category;
  numPages: number;
  header: DocumentHeader;
  transactions: Transaction[];
  /** Page-2 summary block, used to cross-check the sum of the rows. */
  totals: DocumentTotals;
  warnings: string[];
}

export interface DocumentHeader {
  accountType: string | null;
  accountNo: string | null;
  docNo: string | null;
  taxInvoiceNo: string | null;
  /** ISO */
  effectiveDate: string | null;
  /** ISO */
  issueDate: string | null;
  taxId: string | null;
}

export interface DocumentTotals {
  buy?: number;
  sell?: number;
  fee?: number;
  vat?: number;
  switchIn?: number;
  switchOut?: number;
}

export type RejectReason =
  | 'encrypted'
  | 'wrong_password'
  | 'scanned'
  | 'monthly_statement'
  | 'unknown_format';

export interface RejectedDocument {
  file: string;
  reject: RejectReason;
}

export type ParseResult = ParsedDocument | RejectedDocument;

export function isRejected(r: ParseResult): r is RejectedDocument {
  return 'reject' in r;
}
