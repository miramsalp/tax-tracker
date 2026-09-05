import { describe, it, expect } from 'vitest';
import { parsePages } from '../src/parser/index.ts';
import { toLines } from '../src/parser/layout.ts';
import { parseOptionSymbol } from '../src/parser/parsers/offshore.ts';
import type { ParsedDocument } from '../src/core/types.ts';
import {
  buildPage,
  headerRows,
  offshoreEquityBlock,
  offshoreOptionBlock,
  OFFSHORE_TABLE_HEADER,
  TH_EQUITY_TABLE_HEADER,
  thEquityRow,
  totalsPage,
} from './fixtures.ts';

const HEADER = {
  accountType: 'Cash Balance',
  accountNo: '90000001',
  taxInvoiceNo: 'DIMETH2024070100000001',
  effectiveDate: '01/07/2024',
  issueDate: '02/07/2024',
  taxId: '1234567890123',
};

function parsed(pages: ReturnType<typeof buildPage>[]): ParsedDocument {
  const result = parsePages('fixture.pdf', pages);
  if ('reject' in result) throw new Error(`unexpectedly rejected: ${result.reject}`);
  return result;
}

describe('row clustering', () => {
  it('keeps items of one row together when their y differs by up to the tolerance', () => {
    const page = buildPage([
      { y: 100, cells: [{ x: 10, s: 'a' }, { x: 50, s: 'b' }, { x: 90, s: 'c' }], jitter: [0, 2, 1] },
      { y: 80, cells: [{ x: 10, s: 'd' }] },
    ]);
    expect(page).toHaveLength(2);
    expect(page[0].items.map((i) => i.s)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by x within a row, not globally, so a lower-y cell keeps its column', () => {
    // Sorting globally by (y desc, x asc) leaves the jittered cell at the end of
    // the row, which shifts every column after it when the cells are zipped.
    const page = toLines([
      { s: 'first', x: 10, y: 100 },
      { s: 'second', x: 50, y: 98 },
      { s: 'third', x: 90, y: 100 },
    ]);
    expect(page[0].items.map((i) => i.s)).toEqual(['first', 'second', 'third']);
  });
});

describe('header', () => {
  const page = buildPage([
    ...headerRows(HEADER),
    TH_EQUITY_TABLE_HEADER,
    thEquityRow({
      y: 477, orderNo: '074104240147', settlement: '03/07/2024', side: 'BUY', symbol: 'AAA',
      units: '100.00', price: '10.00', gross: '1,000.00', fee: '2.00', vat: '0.14', total: '1,002.14',
    }),
  ]);

  it('reads the account holder tax ID, not the broker registration number', () => {
    expect(parsed([page]).header.taxId).toBe('1234567890123');
  });

  it('assigns Effective and Issue dates to the right labels', () => {
    const header = parsed([page]).header;
    expect(header.effectiveDate).toBe('2024-07-01');
    expect(header.issueDate).toBe('2024-07-02');
  });

  it('uses the header trade date rather than the row settlement date', () => {
    const tx = parsed([page]).transactions[0];
    expect(tx.tradeDate).toBe('2024-07-01');
    expect(tx.settlementDate).toBe('2024-07-03');
  });
});

describe('thai equity rows', () => {
  it('maps columns by position even though values sit outside their header spans', () => {
    const tx = parsed([
      buildPage([
        ...headerRows(HEADER),
        TH_EQUITY_TABLE_HEADER,
        thEquityRow({
          y: 477, orderNo: '074104240147', settlement: '03/07/2024', side: 'BUY', symbol: 'AAA',
          units: '1,900.00', price: '4.40', gross: '8,360.00', fee: '13.12', vat: '0.92', total: '8,374.04',
          // the units cell sits 2 units lower, as it does in the real documents
          jitter: [0, 0, 0, 0, 2, 0, 0, 0, 0, 0],
        }),
      ]),
    ]).transactions[0];

    expect(tx).toMatchObject({
      orderNo: '074104240147', side: 'BUY', symbol: 'AAA',
      units: 1900, price: 4.4, gross: 8360, fee: 13.12, vat: 0.92, total: 8374.04,
    });
    expect(tx.confidence).toBe('ok');
  });

  it('accepts a sell where fees are deducted rather than added', () => {
    const tx = parsed([
      buildPage([
        ...headerRows(HEADER),
        TH_EQUITY_TABLE_HEADER,
        thEquityRow({
          y: 477, orderNo: '074104240148', settlement: '03/07/2024', side: 'SEL', symbol: 'AAA',
          units: '50.00', price: '12.00', gross: '600.00', fee: '1.20', vat: '0.08', total: '598.72',
        }),
      ]),
    ]).transactions[0];
    expect(tx.side).toBe('SEL');
    expect(tx.warnings).toEqual([]);
  });

  it('flags a row that fails its checksum but still imports it', () => {
    const doc = parsed([
      buildPage([
        ...headerRows(HEADER),
        TH_EQUITY_TABLE_HEADER,
        thEquityRow({
          y: 477, orderNo: '074104240149', settlement: '03/07/2024', side: 'BUY', symbol: 'AAA',
          units: '100.00', price: '10.00', gross: '999.00', fee: '2.00', vat: '0.14', total: '1,001.14',
        }),
      ]),
    ]);
    expect(doc.transactions).toHaveLength(1);
    expect(doc.transactions[0].confidence).toBe('low');
    expect(doc.transactions[0].warnings).toContain('units x price does not equal gross');
  });

  it('does not flag a large fractional trade whose printed price is rounded', () => {
    // 37.5036263 x 80.05 is 3002.165..., printed as 3002.17. A flat +/-0.01
    // tolerance rejects this correct row.
    const tx = parsed([
      buildPage([
        ...headerRows(HEADER),
        TH_EQUITY_TABLE_HEADER,
        thEquityRow({
          y: 477, orderNo: '074104240150', settlement: '03/07/2024', side: 'SEL', symbol: 'AAA',
          units: '37.5036263', price: '80.05', gross: '3,002.17', fee: '3.21', vat: '0.00', total: '2,998.96',
        }),
      ]),
    ]).transactions[0];
    expect(tx.warnings).toEqual([]);
  });

  it('reads rows from every page, not just the first', () => {
    const doc = parsed([
      buildPage([
        ...headerRows(HEADER),
        TH_EQUITY_TABLE_HEADER,
        thEquityRow({
          y: 477, orderNo: '000000000001', settlement: '03/07/2024', side: 'BUY', symbol: 'AAA',
          units: '100.00', price: '10.00', gross: '1,000.00', fee: '2.00', vat: '0.14', total: '1,002.14',
        }),
      ]),
      buildPage([
        thEquityRow({
          y: 700, orderNo: '000000000002', settlement: '03/07/2024', side: 'BUY', symbol: 'BBB',
          units: '200.00', price: '5.00', gross: '1,000.00', fee: '2.00', vat: '0.14', total: '1,002.14',
        }),
        ...totalsPage({ buy: '2,004.28', sell: '0.00', fee: '4.00', vat: '0.28' }),
      ]),
    ]);
    expect(doc.transactions.map((t) => t.symbol)).toEqual(['AAA', 'BBB']);
    expect(doc.warnings).toEqual([]);
  });

  it('reports when the rows do not add up to the printed document totals', () => {
    const doc = parsed([
      buildPage([
        ...headerRows(HEADER),
        TH_EQUITY_TABLE_HEADER,
        thEquityRow({
          y: 477, orderNo: '000000000003', settlement: '03/07/2024', side: 'BUY', symbol: 'AAA',
          units: '100.00', price: '10.00', gross: '1,000.00', fee: '2.00', vat: '0.14', total: '1,002.14',
        }),
      ]),
      buildPage(totalsPage({ buy: '2,500.00', sell: '0.00', fee: '4.00' })),
    ]);
    expect(doc.warnings.join(' ')).toContain('document total buy');
  });
});

describe('offshore rows', () => {
  const offshoreHeader = { ...HEADER, accountType: 'Limited Margin Account', accountNo: '80000000001' };

  it('assembles a trade from its three lines and derives the FX rate from both legs', () => {
    const tx = parsed([
      buildPage([
        ...headerRows(offshoreHeader),
        ...OFFSHORE_TABLE_HEADER,
        ...offshoreEquityBlock({
          y: 461, orderNo: '050526', settlement: '02/07/2024', side: 'BUY', symbol: 'FAKE',
          exchange: 'XNAS', units: '10.0000000', price: '20.00',
          usd: ['200.00', '0.50', '0.00', '200.50'],
          thb: ['7,000.00', '17.50', '0.00', '7,017.50'],
        }),
      ]),
    ]).transactions[0];

    expect(tx).toMatchObject({
      symbol: 'FAKE', exchange: 'XNAS', instrument: 'equity', currency: 'USD',
      units: 10, price: 20, gross: 200, fee: 0.5, total: 200.5,
      grossTHB: 7000, totalTHB: 7017.5,
    });
    expect(tx.fxRate).toBeCloseTo(35, 10);
    expect(tx.fxEstimated).toBe(false);
    expect(tx.warnings).toEqual([]);
  });

  it('reads an option row, whose long symbol moves onto the anchor line', () => {
    const tx = parsed([
      buildPage([
        ...headerRows(offshoreHeader),
        ...OFFSHORE_TABLE_HEADER,
        ...offshoreOptionBlock({
          y: 460, orderNo: '186554', settlement: '24/09/2025', side: 'BUY',
          symbol: 'FAKE251003P00010000', units: '1.0000000', price: '60.00',
          usd: ['60.00', '0.00', '0.00', '60.00'],
          thb: ['1,899.13', '0.00', '0.00', '1,899.13'],
        }),
      ]),
    ]).transactions[0];

    expect(tx.symbol).toBe('FAKE251003P00010000');
    expect(tx.instrument).toBe('option');
    expect(tx.exchange).toBeNull();
    expect(tx.warnings).toEqual([]);
  });

  it('leaves reward rows out of the document total check, as the broker does', () => {
    const doc = parsed([
      buildPage([
        ...headerRows(offshoreHeader),
        ...OFFSHORE_TABLE_HEADER,
        ...offshoreEquityBlock({
          y: 461, orderNo: '050526', settlement: '02/07/2024', side: 'BUY', symbol: 'FAKE',
          exchange: 'XNAS', units: '10.0000000', price: '20.00',
          usd: ['200.00', '0.50', '0.00', '200.50'],
          thb: ['7,000.00', '17.50', '0.00', '7,017.50'],
        }),
        ...offshoreEquityBlock({
          y: 430, orderNo: '933484', settlement: '02/07/2024', side: 'REW', symbol: 'GIFT',
          exchange: 'XNYS', units: '1.0000000', price: '5.00',
          usd: ['5.00', '0.00', '0.00', '5.00'],
          thb: ['175.00', '0.00', '0.00', '175.00'],
        }),
      ]),
      buildPage(totalsPage({ buy: '7,017.50', sell: '0.00', fee: '17.50' })),
    ]);
    expect(doc.transactions.map((t) => t.side)).toEqual(['BUY', 'REW']);
    expect(doc.warnings).toEqual([]);
  });

  it('decodes an OCC symbol', () => {
    expect(parseOptionSymbol('ADBE260320C00400000')).toEqual({
      underlying: 'ADBE', expiry: '2026-03-20', right: 'call', strike: 400,
    });
  });
});

describe('rejections', () => {
  it('rejects a page with almost no text as a scan', () => {
    const page = buildPage([{ y: 700, cells: [{ x: 20, s: 'nothing here' }] }]);
    expect(parsePages('scan.pdf', [page])).toEqual({ file: 'scan.pdf', reject: 'scanned' });
  });

  it('rejects a monthly statement even when it prints confirmation-like columns', () => {
    // A mutual fund statement carries Fund Name and NAV/Unit, which would
    // otherwise match the fund confirmation parser.
    const page = buildPage([
      { y: 740, cells: [{ x: 23, s: 'Mutual Fund Account Monthly Statement' }] },
      { y: 700, cells: [{ x: 45, s: 'Fund Name' }, { x: 190, s: 'NAV/Unit' }, { x: 260, s: 'Average Cost' }] },
      ...Array.from({ length: 20 }, (_, i) => ({ y: 600 - i * 10, cells: [{ x: 20, s: `row ${i}` }] })),
    ]);
    expect(parsePages('statement.pdf', [page])).toEqual({
      file: 'statement.pdf', reject: 'monthly_statement',
    });
  });

  it('rejects a document that matches no known format', () => {
    const page = buildPage(
      Array.from({ length: 30 }, (_, i) => ({ y: 700 - i * 10, cells: [{ x: 20, s: `line ${i}` }] })),
    );
    expect(parsePages('other.pdf', [page])).toEqual({ file: 'other.pdf', reject: 'unknown_format' });
  });
});
