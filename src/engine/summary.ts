import type { Category } from '../core/types.ts';
import { roundMoney } from '../core/num.ts';
import type { RealizedLot, OrphanSell } from './fifo.ts';

export interface PeriodSummary {
  year: string;
  category: Category;
  lots: number;
  /** Everything added up, losses included. This is performance, not tax. */
  netPnL: number;
  /** Only the lots that made money. This is the tax-relevant figure. */
  sumOfGains: number;
  /** Only the lots that lost money, kept visible even where it cannot be offset. */
  sumOfLosses: number;
  /** How much of sumOfGains rests on a hand-entered cost. */
  gainsFromManualCost: number;
  manualLotCount: number;
}

/** Thai equity and Thai mutual fund gains are shown for performance only. */
export const TAXABLE_CATEGORIES: Category[] = ['offshore'];

export function isTaxable(category: Category): boolean {
  return TAXABLE_CATEGORIES.includes(category);
}

export function summarise(realized: RealizedLot[]): PeriodSummary[] {
  const groups = new Map<string, PeriodSummary>();

  for (const lot of realized) {
    const key = `${lot.year}|${lot.category}`;
    let s = groups.get(key);
    if (!s) {
      s = {
        year: lot.year,
        category: lot.category,
        lots: 0,
        netPnL: 0,
        sumOfGains: 0,
        sumOfLosses: 0,
        gainsFromManualCost: 0,
        manualLotCount: 0,
      };
      groups.set(key, s);
    }
    s.lots += 1;
    s.netPnL += lot.pnlTHB;
    if (lot.pnlTHB > 0) s.sumOfGains += lot.pnlTHB;
    else s.sumOfLosses += lot.pnlTHB;
    if (lot.costSource !== 'pdf') {
      s.manualLotCount += 1;
      if (lot.pnlTHB > 0) s.gainsFromManualCost += lot.pnlTHB;
    }
  }

  for (const s of groups.values()) {
    s.netPnL = roundMoney(s.netPnL);
    s.sumOfGains = roundMoney(s.sumOfGains);
    s.sumOfLosses = roundMoney(s.sumOfLosses);
    s.gainsFromManualCost = roundMoney(s.gainsFromManualCost);
  }

  return [...groups.values()].sort(
    (a, b) => a.year.localeCompare(b.year) || a.category.localeCompare(b.category),
  );
}

export interface Completeness {
  year: string;
  category: Category;
  orphanCount: number;
  /** Proceeds that carry no cost basis, so no gain can be computed for them. */
  unaccountedProceedsTHB: number;
}

/**
 * Sales whose cost basis is missing are reported next to the tax figures rather
 * than folded into them. Treating a missing cost as zero would count the whole
 * proceeds as gain, which on the current data would overstate the taxable
 * figure by more than a million baht.
 */
export function completeness(orphans: OrphanSell[]): Completeness[] {
  const groups = new Map<string, Completeness>();
  for (const o of orphans) {
    const year = o.tradeDate.slice(0, 4);
    const key = `${year}|${o.category}`;
    let c = groups.get(key);
    if (!c) groups.set(key, (c = { year, category: o.category, orphanCount: 0, unaccountedProceedsTHB: 0 }));
    c.orphanCount += 1;
    c.unaccountedProceedsTHB += o.missingProceedsTHB;
  }
  for (const c of groups.values()) c.unaccountedProceedsTHB = roundMoney(c.unaccountedProceedsTHB);
  return [...groups.values()].sort(
    (a, b) => a.year.localeCompare(b.year) || a.category.localeCompare(b.category),
  );
}
