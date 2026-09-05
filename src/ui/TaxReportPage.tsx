import { useMemo, useState } from 'react';
import { isTaxable, TAXABLE_CATEGORIES } from '../engine/summary.ts';
import type { Engine } from './App.tsx';
import { baht, pnlClass, signedBaht, units as fmtUnits } from './format.ts';

/**
 * Only the offshore category produces a number that matters for tax here; Thai
 * equity and Thai mutual fund gains are shown for performance and are labelled
 * as exempt rather than quietly folded in.
 */
export function TaxReportPage({ engine }: { engine: Engine }) {
  const taxable = engine.periods.filter((p) => isTaxable(p.category));
  const exempt = engine.periods.filter((p) => !isTaxable(p.category));
  const years = useMemo(() => [...new Set(taxable.map((p) => p.year))].sort().reverse(), [taxable]);
  const [year, setYear] = useState(years[0] ?? '');
  const active = years.includes(year) ? year : (years[0] ?? '');

  const period = taxable.find((p) => p.year === active);
  const gaps = engine.gaps.filter((g) => g.year === active && isTaxable(g.category));
  const orphans = engine.orphans.filter(
    (o) => o.tradeDate.startsWith(active) && isTaxable(o.category),
  );
  const lots = useMemo(
    () =>
      engine.realized
        .filter((l) => l.year === active && isTaxable(l.category))
        .sort((a, b) => b.pnlTHB - a.pnlTHB),
    [engine.realized, active],
  );

  if (!period) {
    return <p className="text-sm text-stone-500">ยังไม่มีรายการขายในหมวดที่ต้องเสียภาษี</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="mr-2 text-stone-500">ปีภาษี</span>
          <select
            value={active}
            onChange={(e) => setYear(e.target.value)}
            className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => downloadCsv(active, lots)}
          className="rounded-md border border-stone-300 px-3 py-1.5 text-sm dark:border-stone-700"
        >
          ส่งออก CSV
        </button>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-sm font-semibold">
          ตัวเลขสำหรับยื่นภาษี ปี {active} — หุ้นต่างประเทศ (รวมออปชัน)
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <figure>
            <figcaption className="text-xs text-stone-500">1. กำไร/ขาดทุนสุทธิ</figcaption>
            <p className={`text-2xl font-semibold tnum ${pnlClass(period.netPnL)}`}>
              {signedBaht(period.netPnL)}
            </p>
            <p className="mt-1 text-xs text-stone-400">รวมทุกอย่าง ใช้ดูผลงานการลงทุน</p>
          </figure>
          <figure>
            <figcaption className="text-xs text-stone-500">2. รวมเฉพาะรายการที่กำไร</figcaption>
            <p className="text-2xl font-semibold tnum text-emerald-600 dark:text-emerald-400">
              {baht(period.sumOfGains)}
            </p>
            <p className="mt-1 text-xs text-stone-400">ตัวเลขที่เกี่ยวกับภาษี</p>
          </figure>
          <figure>
            <figcaption className="text-xs text-stone-500">3. รวมเฉพาะรายการที่ขาดทุน</figcaption>
            <p className="text-2xl font-semibold tnum text-rose-600 dark:text-rose-400">
              {baht(period.sumOfLosses)}
            </p>
            <p className="mt-1 text-xs text-stone-400">แสดงไว้ให้ครบ</p>
          </figure>
        </div>

        <p className="mt-4 rounded-md bg-stone-50 p-3 text-xs leading-relaxed text-stone-600 dark:bg-stone-950 dark:text-stone-400">
          <strong className="font-medium">ทำไมตัวที่ 2 ไม่เท่ากับตัวที่ 1:</strong>{' '}
          ตัวที่ 1 คือกำไรหักขาดทุนแล้ว ส่วนตัวที่ 2 นับเฉพาะรายการที่ขายได้กำไร
          โดยไม่เอาขาดทุนไปหักกลบ ปีนี้ต่างกันอยู่{' '}
          <span className="tnum">{baht(Math.abs(period.sumOfLosses))}</span> บาท
          ซึ่งคือขาดทุนที่ไม่ได้ถูกนำไปหักออกจากตัวที่ 2
        </p>

        {period.manualLotCount > 0 && (
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            ในกำไร {baht(period.sumOfGains)} บาทข้างต้น มี{' '}
            <span className="tnum font-medium">{baht(period.gainsFromManualCost)}</span> บาท (
            {((period.gainsFromManualCost / Math.max(period.sumOfGains, 1)) * 100).toFixed(1)}%)
            ที่คำนวณจากต้นทุนซึ่งกรอกเอง ไม่ได้มาจากเอกสาร รวม {period.manualLotCount} รายการ
          </p>
        )}

        {gaps.length > 0 && (
          <div className="mt-3 rounded-md bg-rose-50 p-3 text-xs leading-relaxed text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <p>
              <strong className="font-medium">ตัวเลขนี้ยังไม่สมบูรณ์:</strong> มียอดขาย{' '}
              <span className="tnum font-medium">
                {baht(gaps.reduce((a, g) => a + g.unaccountedProceedsTHB, 0))}
              </span>{' '}
              บาทจาก {gaps.reduce((a, g) => a + g.orphanCount, 0)} รายการที่ยังไม่รู้ต้นทุน
              จึงถูกกันออกไปทั้งหมด ไม่ได้นับเป็นกำไรและไม่ได้นับเป็นขาดทุน
            </p>
            <ul className="mt-2 space-y-0.5">
              {orphans.map((o) => (
                <li key={o.sellTxId + o.symbol}>
                  <span className="font-mono">{o.symbol}</span> ขาย {o.tradeDate} — ขาดต้นทุน{' '}
                  {fmtUnits(o.unitsMissing)} หน่วย คิดเป็น {baht(o.missingProceedsTHB)} บาท
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {exempt.length > 0 && (
        <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <h2 className="text-sm font-semibold">หุ้นไทยและกองทุนรวมไทย</h2>
          <p className="mt-0.5 text-xs text-stone-500">
            กำไรจากการขายหุ้นในตลาดหลักทรัพย์ไทยและกองทุนรวมไทยได้รับยกเว้นภาษีเงินได้บุคคลธรรมดา
            ตัวเลขด้านล่างจึงแสดงไว้เพื่อดูผลงานเท่านั้น ไม่ต้องนำไปยื่น
          </p>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {exempt
                .filter((p) => p.year === active)
                .map((p) => (
                  <tr key={p.category} className="border-t border-stone-200 dark:border-stone-800">
                    <td className="py-1.5">{p.category === 'th_equity' ? 'หุ้นไทย' : 'กองทุนรวม'}</td>
                    <td className={`py-1.5 text-right tnum ${pnlClass(p.netPnL)}`}>{signedBaht(p.netPnL)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-sm font-semibold">รายการที่รับรู้กำไร/ขาดทุนในปี {active}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1 pr-3 font-medium">วันที่ขาย</th>
                <th className="py-1 pr-3 font-medium">หลักทรัพย์</th>
                <th className="py-1 pr-3 text-right font-medium">หน่วย</th>
                <th className="py-1 pr-3 text-right font-medium">ต้นทุน</th>
                <th className="py-1 pr-3 text-right font-medium">เงินที่ได้รับ</th>
                <th className="py-1 pr-3 text-right font-medium">กำไร/ขาดทุน</th>
                <th className="py-1 font-medium">ที่มาของต้นทุน</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l, i) => (
                <tr key={`${l.sellTxId}-${l.buyTxId}-${i}`} className="border-t border-stone-100 dark:border-stone-800/60">
                  <td className="py-1.5 pr-3 tnum">{l.tradeDate}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{l.symbol}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{fmtUnits(l.units)}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{baht(l.costTHB)}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{baht(l.proceedsTHB)}</td>
                  <td className={`py-1.5 pr-3 text-right tnum ${pnlClass(l.pnlTHB)}`}>{signedBaht(l.pnlTHB)}</td>
                  <td className="py-1.5 text-xs text-stone-500">
                    {l.costSource === 'pdf' ? (
                      <span className="font-mono">{l.buyFile}</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        กรอกเอง
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400">
        เครื่องมือนี้ช่วยรวบรวมและคำนวณตัวเลขจากเอกสารที่คุณมีเท่านั้น ไม่ใช่คำแนะนำทางภาษี
        ความถูกต้องของผลลัพธ์ขึ้นกับความครบถ้วนของเอกสารที่นำเข้า และวิธีคำนวณที่ระบบใช้คือ FIFO
        แยกตามบัญชีและหลักทรัพย์ กรุณาตรวจสอบกับผู้ทำบัญชีหรือกรมสรรพากรก่อนยื่นจริง
      </p>
    </div>
  );
}

function downloadCsv(year: string, lots: Engine['realized']) {
  const header = [
    'sell_date', 'buy_date', 'symbol', 'category', 'instrument', 'units',
    'cost_thb', 'proceeds_thb', 'pnl_thb', 'cost_source', 'buy_file', 'sell_file',
  ];
  const rows = lots.map((l) =>
    [l.tradeDate, l.buyDate, l.symbol, l.category, l.instrument, l.units,
     l.costTHB, l.proceedsTHB, l.pnlTHB, l.costSource, l.buyFile ?? '', l.sellFile ?? ''].join(','),
  );
  // A BOM so Excel opens the file as UTF-8 rather than mangling it.
  const blob = new Blob(['﻿' + [header.join(','), ...rows].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tax-report-${TAXABLE_CATEGORIES.join('-')}-${year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
