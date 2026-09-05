import type { Category, Instrument, Side } from '../core/types.ts';

export const baht = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Signed, for figures where the direction is the point. */
export const signedBaht = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${baht(Math.abs(n))}`;

export const units = (n: number): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: 7 });

export const CATEGORY_LABEL: Record<Category, string> = {
  offshore: 'หุ้นต่างประเทศ',
  th_equity: 'หุ้นไทย',
  th_fund: 'กองทุนรวม',
};

export const INSTRUMENT_LABEL: Record<Instrument, string> = {
  equity: 'หุ้น',
  option: 'ออปชัน',
  fund: 'กองทุน',
};

export const SIDE_LABEL: Record<Side, string> = {
  BUY: 'ซื้อ',
  SEL: 'ขาย',
  REW: 'หุ้นรางวัล',
  SUB: 'ซื้อหน่วย',
  RED: 'ขายคืน',
  SWI: 'สับเปลี่ยนเข้า',
  SWO: 'สับเปลี่ยนออก',
};

/** Losses never share a colour with gains, and zero is neutral. */
export function pnlClass(n: number): string {
  if (n > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (n < 0) return 'text-rose-600 dark:text-rose-400';
  return 'text-stone-500';
}

export function maskTaxId(taxId: string): string {
  if (!taxId) return '—';
  return `${taxId.slice(0, 1)}-xxxx-xxxxx-xx-${taxId.slice(-1)}`;
}
