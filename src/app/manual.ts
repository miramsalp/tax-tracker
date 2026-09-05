import type { Category, Instrument, Side, Transaction } from '../core/types.ts';
import { manualId } from '../core/id.ts';
import { roundMoney } from '../core/num.ts';
import { isOptionSymbol } from '../parser/parsers/offshore.ts';
import type { OrphanSell } from '../engine/fifo.ts';

/**
 * Hand-entered transactions, for the trades Dime never sent a confirmation for.
 *
 * These break the rule that every figure traces back to a document, so the rule
 * becomes: every figure traces back to a *source*, and a hand-entered source is
 * labelled everywhere it reaches — including inside the tax totals, which is
 * where it would otherwise disappear.
 */

export interface ManualEntryDraft {
  category: Category;
  accountNo: string;
  symbol: string;
  side: Side;
  tradeDate: string;
  units: string;
  price: string;
  fee: string;
  /** Offshore only. Blank means "use the suggested rate". */
  fxRate: string;
  currency: 'THB' | 'USD';
  note: string;
}

export interface FxSuggestion {
  rate: number;
  /** Date of the document the rate was taken from. */
  fromDate: string;
  daysAway: number;
}

/**
 * Rates come from the imported documents themselves — every offshore row prints
 * both a USD and a THB leg. Nothing is fetched, and no rate is invented; if
 * there is no document near the date, the user has to supply the rate.
 */
export function suggestFxRate(
  transactions: Transaction[],
  tradeDate: string,
): FxSuggestion | null {
  let best: FxSuggestion | null = null;
  const target = Date.parse(tradeDate);
  if (Number.isNaN(target)) return null;

  for (const tx of transactions) {
    if (tx.currency !== 'USD' || !tx.fxRate || tx.fxEstimated) continue;
    const when = Date.parse(tx.tradeDate);
    if (Number.isNaN(when)) continue;
    const daysAway = Math.abs(when - target) / 86_400_000;
    if (!best || daysAway < best.daysAway) {
      best = { rate: tx.fxRate, fromDate: tx.tradeDate, daysAway };
    }
  }
  return best;
}

/** Pre-fills what the gap itself already tells us, leaving only price and date. */
export function draftFromOrphan(orphan: OrphanSell): ManualEntryDraft {
  return {
    category: orphan.category,
    accountNo: orphan.accountNo,
    symbol: orphan.symbol,
    side: orphan.category === 'th_fund' ? 'SUB' : 'BUY',
    tradeDate: orphan.firstBuyInData ?? '',
    units: String(orphan.unitsMissing),
    price: '',
    fee: '0',
    fxRate: '',
    currency: orphan.category === 'offshore' ? 'USD' : 'THB',
    note: `เติมต้นทุนที่ขาดของ ${orphan.symbol} จากการขายวันที่ ${orphan.tradeDate}`,
  };
}

export function emptyDraft(category: Category, accountNo: string): ManualEntryDraft {
  return {
    category,
    accountNo,
    symbol: '',
    side: category === 'th_fund' ? 'SUB' : 'BUY',
    tradeDate: '',
    units: '',
    price: '',
    fee: '0',
    fxRate: '',
    currency: category === 'offshore' ? 'USD' : 'THB',
    note: '',
  };
}

export interface DraftValidation {
  errors: Partial<Record<keyof ManualEntryDraft, string>>;
  /** Derived so the user cannot enter a gross that disagrees with units x price. */
  preview: { gross: number; total: number; totalTHB: number; fxRate: number } | null;
}

export function validateDraft(
  draft: ManualEntryDraft,
  suggestion: FxSuggestion | null,
): DraftValidation {
  const errors: DraftValidation['errors'] = {};
  const units = Number(draft.units);
  const price = Number(draft.price);
  const fee = Number(draft.fee || '0');

  if (!draft.symbol.trim()) errors.symbol = 'ต้องระบุชื่อหลักทรัพย์';
  if (!draft.accountNo.trim()) errors.accountNo = 'ต้องระบุเลขที่บัญชี';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.tradeDate)) errors.tradeDate = 'ต้องระบุวันที่ซื้อขาย';
  if (!Number.isFinite(units) || units <= 0) errors.units = 'จำนวนหน่วยต้องมากกว่า 0';
  if (!Number.isFinite(price) || price <= 0) errors.price = 'ราคาต่อหน่วยต้องมากกว่า 0';
  if (!Number.isFinite(fee) || fee < 0) errors.fee = 'ค่าธรรมเนียมต้องไม่ติดลบ';

  const manualRate = draft.fxRate.trim() === '' ? null : Number(draft.fxRate);
  const rate =
    draft.currency === 'THB' ? 1 : (manualRate ?? suggestion?.rate ?? null);
  if (draft.currency === 'USD' && (rate === null || !Number.isFinite(rate) || rate <= 0)) {
    errors.fxRate = 'ไม่มีเรตจากเอกสารใกล้เคียง กรุณากรอกเรตเอง';
  }

  if (Object.keys(errors).length > 0 || rate === null) return { errors, preview: null };

  const gross = roundMoney(units * price);
  const total = roundMoney(gross + fee);
  return {
    errors,
    preview: { gross, total, totalTHB: roundMoney(total * rate), fxRate: rate },
  };
}

export function buildManualTransaction(
  draft: ManualEntryDraft,
  suggestion: FxSuggestion | null,
): Transaction {
  const { preview } = validateDraft(draft, suggestion);
  if (!preview) throw new Error('ข้อมูลยังไม่ครบ');

  const units = Number(draft.units);
  const price = Number(draft.price);
  const fee = Number(draft.fee || '0');
  const usedSuggestion = draft.fxRate.trim() === '' && draft.currency === 'USD';
  const instrument: Instrument =
    draft.category === 'th_fund' ? 'fund' : isOptionSymbol(draft.symbol) ? 'option' : 'equity';

  return {
    id: manualId(`${draft.accountNo}|${draft.symbol}|${draft.tradeDate}|${draft.units}`),
    source: 'manual',
    sourceFile: null,
    note: draft.note.trim() || undefined,
    accountNo: draft.accountNo.trim(),
    taxId: '',
    taxInvoiceNo: '',
    orderNo: '',
    category: draft.category,
    instrument,
    tradeDate: draft.tradeDate,
    settlementDate: null,
    side: draft.side,
    symbol: draft.symbol.trim().toUpperCase(),
    exchange: null,
    units,
    price,
    gross: preview.gross,
    fee,
    vat: 0,
    withholdingTax: 0,
    total: preview.total,
    currency: draft.currency,
    grossTHB: roundMoney(preview.gross * preview.fxRate),
    feeTHB: roundMoney(fee * preview.fxRate),
    withholdingTaxTHB: 0,
    totalTHB: preview.totalTHB,
    fxRate: preview.fxRate,
    fxEstimated: usedSuggestion,
    confidence: 'ok',
    warnings: usedSuggestion
      ? [`ใช้เรตแลกเปลี่ยนจากใบยืนยันวันที่ ${suggestion?.fromDate} (ไม่ใช่เรตของวันนี้)`]
      : [],
  };
}
