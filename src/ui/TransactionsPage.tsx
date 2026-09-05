import { useMemo, useState } from 'react';
import type { Category, Transaction } from '../core/types.ts';
import { baht, CATEGORY_LABEL, INSTRUMENT_LABEL, maskTaxId, SIDE_LABEL, units as fmtUnits } from './format.ts';

interface Props {
  transactions: Transaction[];
  onRemove(id: string): void;
}

export function TransactionsPage({ transactions, onRemove }: Props) {
  const [year, setYear] = useState('all');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [side, setSide] = useState('all');
  const [symbol, setSymbol] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);

  const years = useMemo(
    () => [...new Set(transactions.map((t) => t.tradeDate.slice(0, 4)))].sort(),
    [transactions],
  );

  const rows = useMemo(() => {
    const query = symbol.trim().toUpperCase();
    return transactions
      .filter((t) => year === 'all' || t.tradeDate.startsWith(year))
      .filter((t) => category === 'all' || t.category === category)
      .filter((t) => side === 'all' || t.side === side)
      .filter((t) => query === '' || t.symbol.includes(query))
      // Filtering to what needs review is allowed; hiding losses is not, so
      // there is deliberately no filter that removes losing rows.
      .filter((t) => !flaggedOnly || t.confidence === 'low' || t.source !== 'pdf')
      .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || a.symbol.localeCompare(b.symbol));
  }, [transactions, year, category, side, symbol, flaggedOnly]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <Filter label="ปี">
          <select value={year} onChange={(e) => setYear(e.target.value)} className={selectClass}>
            <option value="all">ทุกปี</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </Filter>
        <Filter label="หมวด">
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | 'all')} className={selectClass}>
            <option value="all">ทุกหมวด</option>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </Filter>
        <Filter label="ประเภท">
          <select value={side} onChange={(e) => setSide(e.target.value)} className={selectClass}>
            <option value="all">ทั้งหมด</option>
            {Object.entries(SIDE_LABEL).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </Filter>
        <Filter label="หลักทรัพย์">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="ค้นหา"
            className={`${selectClass} font-mono`}
          />
        </Filter>
        <label className="flex items-center gap-2 pb-1.5 text-xs text-stone-600 dark:text-stone-400">
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
          เฉพาะที่ต้องตรวจสอบ
        </label>
        <span className="ml-auto pb-1.5 text-xs text-stone-500 tnum">{rows.length} รายการ</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 text-left text-xs text-stone-500 dark:border-stone-800">
            <tr>
              <th className="px-3 py-2 font-medium">วันที่ซื้อขาย</th>
              <th className="px-3 py-2 font-medium">หลักทรัพย์</th>
              <th className="px-3 py-2 font-medium">ประเภท</th>
              <th className="px-3 py-2 text-right font-medium">จำนวนหน่วย</th>
              <th className="px-3 py-2 text-right font-medium">ราคา</th>
              <th className="px-3 py-2 text-right font-medium">รวมเป็นบาท</th>
              <th className="px-3 py-2 font-medium">ที่มา</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.id}
                onClick={() => setSelected(t)}
                className="cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 dark:border-stone-800/60 dark:hover:bg-stone-800/50"
              >
                <td className="px-3 py-1.5 tnum">{t.tradeDate}</td>
                <td className="px-3 py-1.5 font-mono text-xs">
                  {t.symbol}
                  {t.instrument === 'option' && (
                    <span className="ml-1.5 rounded bg-violet-100 px-1 text-[10px] text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                      ออปชัน
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">{SIDE_LABEL[t.side]}</td>
                <td className="px-3 py-1.5 text-right tnum">{fmtUnits(t.units)}</td>
                <td className="px-3 py-1.5 text-right tnum">
                  {t.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 })}
                  <span className="ml-1 text-xs text-stone-400">{t.currency}</span>
                </td>
                <td className="px-3 py-1.5 text-right tnum">{baht(t.totalTHB)}</td>
                <td className="px-3 py-1.5">
                  {t.source === 'manual' ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      กรอกเอง
                    </span>
                  ) : t.confidence === 'low' ? (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                      ต้องตรวจสอบ
                    </span>
                  ) : (
                    <span className="text-xs text-stone-400">เอกสาร</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-stone-500">ไม่มีรายการที่ตรงกับตัวกรอง</p>}
      </div>

      {selected && <Detail transaction={selected} onClose={() => setSelected(null)} onRemove={onRemove} />}
    </div>
  );
}

/** Every figure has to be traceable back to where it came from. */
function Detail({
  transaction: t,
  onClose,
  onRemove,
}: {
  transaction: Transaction;
  onClose(): void;
  onRemove(id: string): void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-xl border border-stone-200 bg-white p-5 shadow-xl dark:border-stone-800 dark:bg-stone-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-mono text-base font-semibold">{t.symbol}</h2>
        <p className="text-xs text-stone-500">
          {SIDE_LABEL[t.side]} · {CATEGORY_LABEL[t.category]} · {INSTRUMENT_LABEL[t.instrument]}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Row label="วันที่ซื้อขาย" value={t.tradeDate} />
          <Row label="วันที่ชำระราคา" value={t.settlementDate ?? '—'} />
          <Row label="จำนวนหน่วย" value={fmtUnits(t.units)} />
          <Row label="ราคาต่อหน่วย" value={`${t.price} ${t.currency}`} />
          <Row label="มูลค่า" value={`${baht(t.gross)} ${t.currency}`} />
          <Row label="ค่าธรรมเนียม" value={`${baht(t.fee)} ${t.currency}`} />
          {t.vat > 0 && <Row label="ภาษีมูลค่าเพิ่ม" value={baht(t.vat)} />}
          {t.withholdingTax > 0 && <Row label="ภาษีหัก ณ ที่จ่าย" value={baht(t.withholdingTax)} />}
          <Row label="รวมทั้งสิ้น" value={`${baht(t.total)} ${t.currency}`} />
          {t.currency !== 'THB' && (
            <>
              <Row label="เรตแลกเปลี่ยน" value={`${t.fxRate?.toFixed(4) ?? '—'}${t.fxEstimated ? ' (ประมาณ)' : ''}`} />
              <Row label="คิดเป็นบาท" value={baht(t.totalTHB)} />
            </>
          )}
        </dl>

        <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs dark:border-stone-800 dark:bg-stone-950">
          <p className="font-medium">ที่มาของตัวเลขนี้</p>
          {t.source === 'pdf' ? (
            <dl className="mt-1.5 space-y-0.5 text-stone-600 dark:text-stone-400">
              <div>ไฟล์: <span className="font-mono">{t.sourceFile}</span></div>
              <div>เลขที่ใบกำกับภาษี: <span className="font-mono">{t.taxInvoiceNo}</span></div>
              <div>เลขที่คำสั่ง: <span className="font-mono">{t.orderNo}</span></div>
              <div>เลขที่บัญชี: <span className="font-mono">{t.accountNo}</span></div>
              <div>ผู้ถือบัญชี: <span className="font-mono">{maskTaxId(t.taxId)}</span></div>
            </dl>
          ) : (
            <div className="mt-1.5 space-y-1 text-stone-600 dark:text-stone-400">
              <p>รายการนี้กรอกเอง ไม่ได้มาจากเอกสาร</p>
              {t.note && <p className="italic">เหตุผล: {t.note}</p>}
              <button
                type="button"
                onClick={() => {
                  onRemove(t.id);
                  onClose();
                }}
                className="mt-1 rounded border border-rose-300 px-2 py-0.5 text-rose-700 dark:border-rose-900 dark:text-rose-400"
              >
                ลบรายการนี้
              </button>
            </div>
          )}
        </div>

        {t.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        <button type="button" onClick={onClose} className="mt-4 rounded-md border border-stone-300 px-4 py-2 text-sm dark:border-stone-700">
          ปิด
        </button>
      </div>
    </div>
  );
}

const selectClass =
  'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900';

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-stone-500">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}
