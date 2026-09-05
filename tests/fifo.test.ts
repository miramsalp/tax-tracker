import { describe, it, expect } from 'vitest';
import { runFifo } from '../src/engine/fifo.ts';
import { summarise, completeness } from '../src/engine/summary.ts';
import type { Transaction, Side, Provenance } from '../src/core/types.ts';

/**
 * Every expectation here is worked out by hand in the comment above it, so a
 * change in the engine has to argue with arithmetic rather than with a snapshot.
 */

let seq = 0;
function tx(v: {
  date: string;
  side: Side;
  symbol: string;
  units: number;
  /** Cash paid or received in THB, fees included. */
  totalTHB: number;
  account?: string;
  source?: Provenance;
  category?: Transaction['category'];
}): Transaction {
  const price = v.totalTHB / v.units;
  return {
    id: `t${++seq}`,
    source: v.source ?? 'pdf',
    sourceFile: 'fixture.pdf',
    accountNo: v.account ?? 'ACC1',
    taxId: '1234567890123',
    taxInvoiceNo: `INV${seq}`,
    orderNo: String(seq).padStart(6, '0'),
    category: v.category ?? 'offshore',
    instrument: 'equity',
    tradeDate: v.date,
    settlementDate: v.date,
    side: v.side,
    symbol: v.symbol,
    exchange: 'XNAS',
    units: v.units,
    price,
    gross: v.totalTHB,
    fee: 0,
    vat: 0,
    withholdingTax: 0,
    total: v.totalTHB,
    currency: 'USD',
    grossTHB: v.totalTHB,
    feeTHB: 0,
    withholdingTaxTHB: 0,
    totalTHB: v.totalTHB,
    fxRate: 1,
    fxEstimated: false,
    confidence: 'ok',
    warnings: [],
  };
}

describe('partial fills', () => {
  it('draws one sale from two buy lots, oldest first', () => {
    // Buy 400 for 4,000 (10.00/unit), buy 600 for 7,200 (12.00/unit).
    // Sell 1,000 for 15,000 (15.00/unit).
    //   lot 1: 400 units, cost 4,000, proceeds 6,000 -> +2,000
    //   lot 2: 600 units, cost 7,200, proceeds 9,000 -> +1,800
    const { realized, open, orphans } = runFifo([
      tx({ date: '2024-01-01', side: 'BUY', symbol: 'AAA', units: 400, totalTHB: 4000 }),
      tx({ date: '2024-02-01', side: 'BUY', symbol: 'AAA', units: 600, totalTHB: 7200 }),
      tx({ date: '2024-03-01', side: 'SEL', symbol: 'AAA', units: 1000, totalTHB: 15000 }),
    ]);

    expect(realized).toHaveLength(2);
    expect(realized[0]).toMatchObject({ units: 400, costTHB: 4000, proceedsTHB: 6000, pnlTHB: 2000 });
    expect(realized[1]).toMatchObject({ units: 600, costTHB: 7200, proceedsTHB: 9000, pnlTHB: 1800 });
    expect(open).toHaveLength(0);
    expect(orphans).toHaveLength(0);
  });

  it('leaves the unsold remainder of a lot open with its share of the cost', () => {
    // Buy 100 for 1,000. Sell 30 for 450 -> cost 300, gain 150.
    // 70 units remain, carrying 700 of cost.
    const { realized, open } = runFifo([
      tx({ date: '2024-01-01', side: 'BUY', symbol: 'AAA', units: 100, totalTHB: 1000 }),
      tx({ date: '2024-02-01', side: 'SEL', symbol: 'AAA', units: 30, totalTHB: 450 }),
    ]);
    expect(realized[0]).toMatchObject({ units: 30, costTHB: 300, proceedsTHB: 450, pnlTHB: 150 });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ remainingUnits: 70, costTHB: 700 });
  });
});

describe('selling more than the data accounts for', () => {
  it('records the shortfall instead of crashing or assuming a zero cost', () => {
    // Buy 40 for 400. Sell 100 for 1,500 (15.00/unit).
    //   40 units match: cost 400, proceeds 600, gain 200
    //   60 units have no cost basis: 900 of proceeds unaccounted
    const { realized, orphans } = runFifo([
      tx({ date: '2024-01-01', side: 'BUY', symbol: 'AAA', units: 40, totalTHB: 400 }),
      tx({ date: '2024-02-01', side: 'SEL', symbol: 'AAA', units: 100, totalTHB: 1500 }),
    ]);

    expect(realized).toHaveLength(1);
    expect(realized[0].pnlTHB).toBe(200);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      symbol: 'AAA', unitsSold: 100, unitsMatched: 40, unitsMissing: 60, missingProceedsTHB: 900,
    });
    // The unmatched 900 must not appear as a gain anywhere.
    expect(summarise(realized)[0].sumOfGains).toBe(200);
    expect(completeness(orphans)[0].unaccountedProceedsTHB).toBe(900);
  });

  it('handles a sale with no prior buy at all', () => {
    const { realized, orphans } = runFifo([
      tx({ date: '2024-02-01', side: 'SEL', symbol: 'ZZZ', units: 50, totalTHB: 5000 }),
    ]);
    expect(realized).toHaveLength(0);
    expect(orphans[0]).toMatchObject({ unitsMissing: 50, missingProceedsTHB: 5000, firstBuyInData: null });
  });

  it('ignores sub-unit rounding dust left by fractional-share allocation', () => {
    const { orphans } = runFifo([
      tx({ date: '2024-01-01', side: 'BUY', symbol: 'AAA', units: 3.5113955, totalTHB: 3511.3955 }),
      tx({ date: '2024-02-01', side: 'SEL', symbol: 'AAA', units: 3.5113956, totalTHB: 4000 }),
    ]);
    expect(orphans).toHaveLength(0);
  });
});

describe('account separation', () => {
  it('does not let one account draw on another account cost basis', () => {
    // Same symbol, two accounts. The sale in ACC2 has no lot of its own.
    const { realized, orphans } = runFifo([
      tx({ date: '2024-01-01', side: 'BUY', symbol: 'AAA', units: 100, totalTHB: 1000, account: 'ACC1' }),
      tx({ date: '2024-02-01', side: 'SEL', symbol: 'AAA', units: 100, totalTHB: 1500, account: 'ACC2' }),
    ]);
    expect(realized).toHaveLength(0);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].accountNo).toBe('ACC2');
  });
});

describe('same-day ordering', () => {
  it('lets a sale draw on a lot bought the same day whatever order they arrive in', () => {
    const { realized, orphans } = runFifo([
      tx({ date: '2024-01-01', side: 'SEL', symbol: 'AAA', units: 10, totalTHB: 150 }),
      tx({ date: '2024-01-01', side: 'BUY', symbol: 'AAA', units: 10, totalTHB: 100 }),
    ]);
    expect(orphans).toHaveLength(0);
    expect(realized[0].pnlTHB).toBe(50);
  });
});

describe('reward shares', () => {
  it('does not create a lot for a REW row', () => {
    // Reward shares are excluded by decision, so selling them shows up as a gap
    // rather than as a gain with no cost.
    const { realized, open, orphans } = runFifo([
      tx({ date: '2024-01-01', side: 'REW', symbol: 'AAA', units: 5, totalTHB: 50 }),
      tx({ date: '2024-02-01', side: 'SEL', symbol: 'AAA', units: 5, totalTHB: 80 }),
    ]);
    expect(open).toHaveLength(0);
    expect(realized).toHaveLength(0);
    expect(orphans[0].unitsMissing).toBe(5);
  });
});

describe('provenance', () => {
  it('carries a hand-entered cost through to the realized lot and the summary', () => {
    const { realized } = runFifo([
      tx({ date: '2024-01-01', side: 'BUY', symbol: 'AAA', units: 10, totalTHB: 100, source: 'manual' }),
      tx({ date: '2024-01-05', side: 'BUY', symbol: 'BBB', units: 10, totalTHB: 100 }),
      tx({ date: '2024-02-01', side: 'SEL', symbol: 'AAA', units: 10, totalTHB: 300 }),
      tx({ date: '2024-02-01', side: 'SEL', symbol: 'BBB', units: 10, totalTHB: 200 }),
    ]);

    expect(realized.find((r) => r.symbol === 'AAA')!.costSource).toBe('manual');
    expect(realized.find((r) => r.symbol === 'BBB')!.costSource).toBe('pdf');

    // Gains total 300, of which the 200 from AAA rests on a hand-entered cost.
    const [summary] = summarise(realized);
    expect(summary.sumOfGains).toBe(300);
    expect(summary.gainsFromManualCost).toBe(200);
    expect(summary.manualLotCount).toBe(1);
  });
});

describe('summary', () => {
  it('reports gains, losses and the net separately', () => {
    // +500 on AAA, -200 on BBB.
    const { realized } = runFifo([
      tx({ date: '2024-01-01', side: 'BUY', symbol: 'AAA', units: 10, totalTHB: 1000 }),
      tx({ date: '2024-01-01', side: 'BUY', symbol: 'BBB', units: 10, totalTHB: 1000 }),
      tx({ date: '2024-06-01', side: 'SEL', symbol: 'AAA', units: 10, totalTHB: 1500 }),
      tx({ date: '2024-06-01', side: 'SEL', symbol: 'BBB', units: 10, totalTHB: 800 }),
    ]);
    const [summary] = summarise(realized);
    expect(summary).toMatchObject({
      year: '2024', netPnL: 300, sumOfGains: 500, sumOfLosses: -200, lots: 2,
    });
  });

  it('keeps years and categories apart', () => {
    const { realized } = runFifo([
      tx({ date: '2024-01-01', side: 'BUY', symbol: 'AAA', units: 10, totalTHB: 1000 }),
      tx({ date: '2024-06-01', side: 'SEL', symbol: 'AAA', units: 10, totalTHB: 1200 }),
      tx({ date: '2025-01-01', side: 'BUY', symbol: 'KTC', units: 10, totalTHB: 1000, category: 'th_equity' }),
      tx({ date: '2025-06-01', side: 'SEL', symbol: 'KTC', units: 10, totalTHB: 900, category: 'th_equity' }),
    ]);
    const summaries = summarise(realized);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ year: '2024', category: 'offshore', netPnL: 200 });
    expect(summaries[1]).toMatchObject({ year: '2025', category: 'th_equity', netPnL: -100 });
  });
});
