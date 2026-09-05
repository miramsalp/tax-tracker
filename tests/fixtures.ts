import { toLines, type Page, type TextItem } from '../src/parser/layout.ts';

/**
 * Synthetic documents that copy the real layout — column positions, the
 * label-above-value header, the three-line offshore block — with invented
 * numbers. Real confirmation notes are personal tax records and are never
 * committed, so the structure is reproduced here instead of the content.
 */

export interface Cell {
  x: number;
  s: string;
}

export interface RowSpec {
  y: number;
  cells: Cell[];
  /**
   * Vertical jitter applied to a cell, mirroring how a real row's items sit
   * 1-2 units apart in y even though they read as one line.
   */
  jitter?: number[];
}

export function buildPage(rows: RowSpec[]): Page {
  const items: TextItem[] = [];
  for (const row of rows) {
    row.cells.forEach((cell, i) => {
      items.push({ s: cell.s, x: cell.x, y: row.y - (row.jitter?.[i] ?? 0) });
    });
  }
  return toLines(items);
}

/** Header block shared by every confirmation note, with values above labels. */
export function headerRows(options: {
  accountType: string;
  accountNo: string;
  taxInvoiceNo: string;
  effectiveDate: string;
  issueDate: string;
  taxId: string;
}): RowSpec[] {
  return [
    // The broker's own tax ID sits here; the holder's is further down. A parser
    // that grabs the first 13-digit number picks this one and matches every
    // document to the same person.
    { y: 748, cells: [{ x: 448, s: 'Registration No.' }, { x: 524, s: '0105564162055' }] },
    { y: 742, cells: [{ x: 18, s: 'Confirmation Note / Receipt / Tax Invoice' }] },
    { y: 674, cells: [{ x: 331, s: options.accountType }, { x: 505, s: 'TH2024070100001354' }] },
    { y: 669, cells: [{ x: 249, s: 'Account Type' }, { x: 393, s: 'No.' }] },
    { y: 634, cells: [{ x: 338, s: options.accountNo }, { x: 491, s: options.taxInvoiceNo }] },
    {
      y: 631,
      cells: [
        // Address text shares the label line and must not be read as a value.
        { x: 38, s: 'BANGKOK 10150' },
        { x: 249, s: 'Account No.' },
        { x: 393, s: 'Tax Invoice No.' },
      ],
    },
    { y: 609, cells: [{ x: 38, s: 'TAX I.D.' }, { x: 143, s: options.taxId }] },
    // Effective Date's value sits at x=333 under a label at x=249, while Issue
    // Date's sits at x=534 under a label at x=393. Nearest-label matching gives
    // Issue Date the wrong value; zipping by order gives the right one.
    { y: 594, cells: [{ x: 333, s: options.effectiveDate }, { x: 534, s: options.issueDate }] },
    { y: 590, cells: [{ x: 249, s: 'Effective Date' }, { x: 393, s: 'Issue Date' }] },
  ];
}

export const TH_EQUITY_TABLE_HEADER: RowSpec = {
  y: 508,
  cells: [
    { x: 35, s: 'Order No.' },
    { x: 122, s: 'Transaction Type' },
    { x: 179, s: 'Securities' },
    { x: 237, s: 'Units' },
    { x: 285, s: 'Price/Share' },
    { x: 349, s: 'Gross Amount' },
    { x: 423, s: 'Fee*' },
    { x: 471, s: 'VAT' },
    { x: 523, s: 'Total Amount' },
  ],
};

/**
 * A Thai equity row. Note the x positions: numbers are right-aligned so a
 * value's x does not fall inside its own header's span — Units prints at
 * x=245 under a header at x=237, Gross at x=379 under a header at x=349.
 */
export function thEquityRow(v: {
  y: number;
  orderNo: string;
  settlement: string;
  side: string;
  symbol: string;
  units: string;
  price: string;
  gross: string;
  fee: string;
  vat: string;
  total: string;
  jitter?: number[];
}): RowSpec {
  return {
    y: v.y,
    jitter: v.jitter,
    cells: [
      { x: 27, s: v.orderNo },
      { x: 81, s: v.settlement },
      { x: 137, s: v.side },
      { x: 185, s: v.symbol },
      { x: 245, s: v.units },
      { x: 310, s: v.price },
      { x: 379, s: v.gross },
      { x: 433, s: v.fee },
      { x: 483, s: v.vat },
      { x: 551, s: v.total },
    ],
  };
}

export const OFFSHORE_TABLE_HEADER: RowSpec[] = [
  {
    y: 510,
    cells: [
      { x: 81, s: 'Settlement Date' },
      { x: 295, s: 'Unit Price' },
      { x: 342, s: 'Currency' },
      { x: 383, s: 'Gross Amount' },
      { x: 535, s: 'Total Amount' },
    ],
  },
  {
    y: 507,
    cells: [
      { x: 30, s: 'Order ID' },
      { x: 190, s: '[Exchange]' },
      { x: 240, s: 'Unit' },
      { x: 434, s: 'Fee Include Vat' },
      { x: 483, s: 'Withholding Tax' },
    ],
  },
];

/** An offshore equity trade: symbol above, anchor line, THB leg below. */
export function offshoreEquityBlock(v: {
  y: number;
  orderNo: string;
  settlement: string;
  side: string;
  symbol: string;
  exchange: string;
  units: string;
  price: string;
  usd: [string, string, string, string];
  thb: [string, string, string, string];
}): RowSpec[] {
  return [
    {
      y: v.y,
      cells: [
        { x: 194, s: v.symbol },
        { x: 409, s: v.usd[0] },
        { x: 466, s: v.usd[1] },
        { x: 514, s: v.usd[2] },
        { x: 556, s: v.usd[3] },
      ],
    },
    {
      y: v.y - 4,
      cells: [
        { x: 34, s: v.orderNo },
        { x: 77, s: v.settlement },
        { x: 138, s: v.side },
        { x: 253, s: v.units },
        { x: 315, s: v.price },
        { x: 351, s: 'USD' },
      ],
    },
    {
      y: v.y - 11,
      cells: [
        { x: 192, s: `[${v.exchange}]` },
        { x: 402, s: v.thb[0] },
        { x: 463, s: v.thb[1] },
        { x: 514, s: v.thb[2] },
        { x: 549, s: v.thb[3] },
      ],
    },
  ];
}

/**
 * An offshore option trade. The OCC symbol is too wide for the securities
 * column, so it moves onto the anchor line and the exchange line disappears —
 * a second layout the parser has to recognise or the row is silently lost.
 */
export function offshoreOptionBlock(v: {
  y: number;
  orderNo: string;
  settlement: string;
  side: string;
  symbol: string;
  units: string;
  price: string;
  usd: [string, string, string, string];
  thb: [string, string, string, string];
}): RowSpec[] {
  return [
    {
      y: v.y,
      cells: [
        { x: 412, s: v.usd[0] },
        { x: 466, s: v.usd[1] },
        { x: 514, s: v.usd[2] },
        { x: 559, s: v.usd[3] },
      ],
    },
    {
      y: v.y - 4,
      cells: [
        { x: 34, s: v.orderNo },
        { x: 77, s: v.settlement },
        { x: 139, s: v.side },
        { x: 171, s: v.symbol },
        { x: 253, s: v.units },
        { x: 318, s: v.price },
        { x: 351, s: 'USD' },
      ],
    },
    {
      y: v.y - 11,
      cells: [
        { x: 405, s: v.thb[0] },
        { x: 466, s: v.thb[1] },
        { x: 514, s: v.thb[2] },
        { x: 552, s: v.thb[3] },
      ],
    },
  ];
}

/** The summary block that closes every confirmation note. */
export function totalsPage(v: { buy: string; sell: string; fee: string; vat?: string }): RowSpec[] {
  const rows: RowSpec[] = [
    { y: 799, cells: [{ x: 537, s: v.buy }] },
    { y: 794, cells: [{ x: 369, s: 'Total Buy' }] },
    { y: 766, cells: [{ x: 538, s: v.sell }] },
    { y: 761, cells: [{ x: 369, s: 'Total Sell' }] },
    { y: 733, cells: [{ x: 549, s: v.fee }] },
    { y: 728, cells: [{ x: 369, s: 'Total Fee (Exclude VAT)' }] },
  ];
  if (v.vat !== undefined) {
    rows.push({ y: 683, cells: [{ x: 551, s: v.vat }] });
    rows.push({ y: 678, cells: [{ x: 369, s: 'Total Vat' }] });
  }
  return rows;
}
