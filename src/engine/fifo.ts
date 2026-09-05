import type { Category, Instrument, Provenance, Transaction } from '../core/types.ts';
import { roundMoney, roundUnits, unitsPositive } from '../core/num.ts';
import { isBuySide } from '../parser/checksum.ts';

export interface RealizedLot {
  sellTxId: string;
  buyTxId: string;
  accountNo: string;
  symbol: string;
  category: Category;
  instrument: Instrument;
  units: number;
  /** Includes the buy-side fees for these units. */
  costTHB: number;
  /** Net of the sell-side fees for these units. */
  proceedsTHB: number;
  pnlTHB: number;
  /** ISO date of the sell. */
  tradeDate: string;
  buyDate: string;
  year: string;
  sellFile: string | null;
  buyFile: string | null;
  /**
   * Where the cost side came from. Inherited from the buy lot so a figure that
   * rests on a hand-entered cost stays visible all the way into the tax total.
   */
  costSource: Provenance;
}

export interface OpenLot {
  buyTxId: string;
  accountNo: string;
  symbol: string;
  category: Category;
  instrument: Instrument;
  remainingUnits: number;
  costTHB: number;
  tradeDate: string;
  sourceFile: string | null;
  source: Provenance;
}

export interface OrphanSell {
  sellTxId: string;
  accountNo: string;
  symbol: string;
  category: Category;
  instrument: Instrument;
  tradeDate: string;
  unitsSold: number;
  unitsMatched: number;
  unitsMissing: number;
  /** Proceeds attributable to the units with no cost basis. */
  missingProceedsTHB: number;
  sellFile: string | null;
  /** Earliest acquisition of this position in the data, to narrow the search. */
  firstBuyInData: string | null;
}

export interface FifoResult {
  realized: RealizedLot[];
  open: OpenLot[];
  orphans: OrphanSell[];
}

/**
 * Residues below this are arithmetic dust from fractional-share allocation, not
 * missing paperwork. Real gaps in the data are whole or near-whole units.
 */
const DUST_UNITS = 1e-4;

interface Lot {
  txId: string;
  units: number;
  costTHB: number;
  tradeDate: string;
  sourceFile: string | null;
  source: Provenance;
}

/**
 * Positions are kept per account and symbol. Mixing accounts would blend cost
 * bases that belong to different portfolios; the three Dime account types are
 * already distinct account numbers, so this also keeps the categories apart.
 */
function queueKey(tx: Transaction): string {
  return `${tx.accountNo}|${tx.symbol}|${tx.currency}`;
}

/**
 * REW rows are reward shares. They are parsed and displayed, but by decision
 * they do not create a lot and are not treated as income here, so a later sale
 * of those shares surfaces as an orphan rather than as a zero-cost gain.
 */
function isAcquisition(tx: Transaction): boolean {
  return isBuySide(tx.side);
}

function isDisposal(tx: Transaction): boolean {
  return tx.side === 'SEL' || tx.side === 'RED' || tx.side === 'SWO';
}

/**
 * Within one day the document gives no ordering, and sorting by file name is
 * arbitrary. Acquisitions are placed first because these accounts cannot go
 * short: a same-day sale must be drawing on a lot bought that day or earlier.
 * Applying this rule removed a third of the apparent orphans on the real data.
 */
export function orderTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort(
    (a, b) =>
      a.tradeDate.localeCompare(b.tradeDate) ||
      Number(isDisposal(a)) - Number(isDisposal(b)) ||
      (a.sourceFile ?? '').localeCompare(b.sourceFile ?? '') ||
      a.orderNo.localeCompare(b.orderNo),
  );
}

export function runFifo(transactions: Transaction[]): FifoResult {
  const ordered = orderTransactions(transactions);
  const queues = new Map<string, Lot[]>();
  const firstBuy = new Map<string, string>();
  const realized: RealizedLot[] = [];
  const orphans: OrphanSell[] = [];

  for (const tx of ordered) {
    const key = queueKey(tx);
    let lots = queues.get(key);
    if (!lots) queues.set(key, (lots = []));

    if (isAcquisition(tx)) {
      if (!firstBuy.has(key)) firstBuy.set(key, tx.tradeDate);
      lots.push({
        txId: tx.id,
        units: tx.units,
        // The cash actually paid, fees included.
        costTHB: tx.totalTHB,
        tradeDate: tx.tradeDate,
        sourceFile: tx.sourceFile,
        source: tx.source,
      });
      continue;
    }
    if (!isDisposal(tx)) continue;

    // Proceeds are already net of the sell-side fees, so splitting them across a
    // partial fill is a straight pro-rata of the row's own total.
    const proceedsPerUnit = tx.units !== 0 ? tx.totalTHB / tx.units : 0;
    let remaining = tx.units;

    while (unitsPositive(remaining) && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(remaining, lot.units);
      const cost = lot.costTHB * (take / lot.units);
      const proceeds = proceedsPerUnit * take;

      realized.push({
        sellTxId: tx.id,
        buyTxId: lot.txId,
        accountNo: tx.accountNo,
        symbol: tx.symbol,
        category: tx.category,
        instrument: tx.instrument,
        units: roundUnits(take),
        costTHB: roundMoney(cost),
        proceedsTHB: roundMoney(proceeds),
        pnlTHB: roundMoney(proceeds - cost),
        tradeDate: tx.tradeDate,
        buyDate: lot.tradeDate,
        year: tx.tradeDate.slice(0, 4),
        sellFile: tx.sourceFile,
        buyFile: lot.sourceFile,
        costSource: lot.source,
      });

      lot.units = roundUnits(lot.units - take);
      lot.costTHB = roundMoney(lot.costTHB - cost);
      remaining = roundUnits(remaining - take);
      if (!unitsPositive(lot.units)) lots.shift();
    }

    // Selling more than the data accounts for is never a crash and never a
    // zero-cost gain. It is recorded so the user can supply the missing buy.
    if (remaining >= DUST_UNITS) {
      orphans.push({
        sellTxId: tx.id,
        accountNo: tx.accountNo,
        symbol: tx.symbol,
        category: tx.category,
        instrument: tx.instrument,
        tradeDate: tx.tradeDate,
        unitsSold: tx.units,
        unitsMatched: roundUnits(tx.units - remaining),
        unitsMissing: roundUnits(remaining),
        missingProceedsTHB: roundMoney(proceedsPerUnit * remaining),
        sellFile: tx.sourceFile,
        firstBuyInData: firstBuy.get(key) ?? null,
      });
    }
  }

  const open: OpenLot[] = [];
  for (const [key, lots] of queues) {
    const [accountNo] = key.split('|');
    for (const lot of lots) {
      if (!unitsPositive(lot.units)) continue;
      const tx = ordered.find((t) => t.id === lot.txId);
      open.push({
        buyTxId: lot.txId,
        accountNo,
        symbol: tx?.symbol ?? '',
        category: tx?.category ?? 'offshore',
        instrument: tx?.instrument ?? 'equity',
        remainingUnits: roundUnits(lot.units),
        costTHB: roundMoney(lot.costTHB),
        tradeDate: lot.tradeDate,
        sourceFile: lot.sourceFile,
        source: lot.source,
      });
    }
  }

  return { realized, open, orphans };
}
