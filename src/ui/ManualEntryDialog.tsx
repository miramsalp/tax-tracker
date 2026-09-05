import { useMemo, useState } from 'react';
import type { Category, Side, Transaction } from '../core/types.ts';
import type { OrphanSell } from '../engine/fifo.ts';
import {
  buildManualTransaction,
  draftFromOrphan,
  emptyDraft,
  suggestFxRate,
  validateDraft,
  type ManualEntryDraft,
} from '../app/manual.ts';
import { baht, CATEGORY_LABEL, SIDE_LABEL } from './format.ts';

interface Props {
  transactions: Transaction[];
  orphan: OrphanSell | null;
  onClose(): void;
  onSave(transaction: Transaction): void;
}

const SIDES_BY_CATEGORY: Record<Category, Side[]> = {
  offshore: ['BUY', 'SEL'],
  th_equity: ['BUY', 'SEL'],
  th_fund: ['SUB', 'RED', 'SWI', 'SWO'],
};

export function ManualEntryDialog({ transactions, orphan, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<ManualEntryDraft>(() =>
    orphan ? draftFromOrphan(orphan) : emptyDraft('offshore', ''),
  );

  const suggestion = useMemo(
    () => (draft.tradeDate ? suggestFxRate(transactions, draft.tradeDate) : null),
    [transactions, draft.tradeDate],
  );
  const { errors, preview } = validateDraft(draft, suggestion);
  const set = <K extends keyof ManualEntryDraft>(key: K, value: ManualEntryDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/50 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-stone-200 bg-white p-5 shadow-xl dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-base font-semibold">เพิ่มรายการเอง</h2>
        <p className="mt-1 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
          ใช้เมื่อ Dime ไม่ได้ส่งใบยืนยันมาให้ รายการที่กรอกเองจะถูกทำเครื่องหมายไว้ทุกที่ที่มันไปโผล่
          รวมถึงในตัวเลขภาษี เพื่อให้รู้เสมอว่ายอดไหนพึ่งข้อมูลที่กรอกเอง
        </p>

        {orphan && (
          <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            เติมต้นทุนให้ <span className="font-mono">{orphan.symbol}</span> ที่ขายไปเมื่อ{' '}
            {orphan.tradeDate} และยังขาดต้นทุนอยู่ {orphan.unitsMissing} หน่วย
            {orphan.firstBuyInData
              ? ` — ใบซื้อที่หายน่าจะอยู่ก่อน ${orphan.firstBuyInData}`
              : ' — ไม่พบใบซื้อของหลักทรัพย์นี้เลย'}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Field label="หมวด">
            <select
              value={draft.category}
              onChange={(e) => {
                const category = e.target.value as Category;
                setDraft((d) => ({
                  ...d,
                  category,
                  side: SIDES_BY_CATEGORY[category][0],
                  currency: category === 'offshore' ? 'USD' : 'THB',
                }));
              }}
              className={inputClass}
            >
              {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="ประเภทรายการ">
            <select value={draft.side} onChange={(e) => set('side', e.target.value as Side)} className={inputClass}>
              {SIDES_BY_CATEGORY[draft.category].map((s) => (
                <option key={s} value={s}>
                  {SIDE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="เลขที่บัญชี" error={errors.accountNo}>
            <input value={draft.accountNo} onChange={(e) => set('accountNo', e.target.value)} className={inputClass} />
          </Field>

          <Field label="ชื่อหลักทรัพย์" error={errors.symbol}>
            <input
              value={draft.symbol}
              onChange={(e) => set('symbol', e.target.value)}
              placeholder="AMZN"
              className={`${inputClass} font-mono`}
            />
          </Field>

          <Field label="วันที่ซื้อขาย" error={errors.tradeDate}>
            <input type="date" value={draft.tradeDate} onChange={(e) => set('tradeDate', e.target.value)} className={inputClass} />
          </Field>

          <Field label="สกุลเงิน">
            <select
              value={draft.currency}
              onChange={(e) => set('currency', e.target.value as 'THB' | 'USD')}
              className={inputClass}
            >
              <option value="USD">USD</option>
              <option value="THB">THB</option>
            </select>
          </Field>

          <Field label="จำนวนหน่วย" error={errors.units}>
            <input value={draft.units} onChange={(e) => set('units', e.target.value)} inputMode="decimal" className={`${inputClass} tnum`} />
          </Field>

          <Field label="ราคาต่อหน่วย" error={errors.price}>
            <input value={draft.price} onChange={(e) => set('price', e.target.value)} inputMode="decimal" className={`${inputClass} tnum`} />
          </Field>

          <Field label="ค่าธรรมเนียม" error={errors.fee}>
            <input value={draft.fee} onChange={(e) => set('fee', e.target.value)} inputMode="decimal" className={`${inputClass} tnum`} />
          </Field>

          {draft.currency === 'USD' && (
            <Field
              label="เรตแลกเปลี่ยน"
              error={errors.fxRate}
              hint={
                suggestion
                  ? `ว่างไว้เพื่อใช้ ${suggestion.rate.toFixed(4)} จากใบยืนยันวันที่ ${suggestion.fromDate}`
                  : 'ไม่มีเอกสารใกล้เคียงให้อ้างอิง ต้องกรอกเอง'
              }
            >
              <input
                value={draft.fxRate}
                onChange={(e) => set('fxRate', e.target.value)}
                inputMode="decimal"
                placeholder={suggestion ? suggestion.rate.toFixed(4) : ''}
                className={`${inputClass} tnum`}
              />
            </Field>
          )}
        </div>

        <Field label="เหตุผลที่ต้องกรอกเอง">
          <input
            value={draft.note}
            onChange={(e) => set('note', e.target.value)}
            placeholder="เช่น Dime ไม่ได้ส่งใบยืนยันของรายการนี้มาทางอีเมล"
            className={inputClass}
          />
        </Field>

        {preview && (
          <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs dark:border-stone-800 dark:bg-stone-950">
            <p className="font-medium">ตัวเลขที่จะถูกบันทึก</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              <Stat label="มูลค่ารวม" value={baht(preview.gross)} />
              <Stat label="รวมค่าธรรมเนียม" value={baht(preview.total)} />
              <Stat label="เรตที่ใช้" value={preview.fxRate.toFixed(4)} />
              <Stat label="คิดเป็นบาท" value={baht(preview.totalTHB)} />
            </dl>
            <p className="mt-2 text-stone-500">
              มูลค่าคำนวณจากจำนวนหน่วย × ราคา ไม่ได้ให้พิมพ์เอง เพื่อไม่ให้ตัวเลขขัดกันเองแบบที่ระบบตรวจไม่เจอ
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-stone-300 px-4 py-2 text-sm dark:border-stone-700">
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!preview}
            onClick={() => onSave(buildManualTransaction(draft, suggestion))}
            className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
          >
            บันทึกรายการ
          </button>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-950';

function Field(props: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="col-span-full block sm:col-span-1">
      <span className="mb-1 block text-xs text-stone-500">{props.label}</span>
      {props.children}
      {props.error ? (
        <span className="mt-0.5 block text-xs text-rose-600 dark:text-rose-400">{props.error}</span>
      ) : props.hint ? (
        <span className="mt-0.5 block text-xs text-stone-500">{props.hint}</span>
      ) : null}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-stone-500">{label}</dt>
      <dd className="tnum font-medium">{value}</dd>
    </div>
  );
}
