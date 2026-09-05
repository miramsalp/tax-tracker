import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Category, Transaction } from '../core/types.ts';
import type { ParsedStatement } from '../parser/statement.ts';
import type { Engine } from './App.tsx';
import { baht, CATEGORY_LABEL, pnlClass, signedBaht, units as fmtUnits } from './format.ts';

interface Props {
  engine: Engine;
  transactions: Transaction[];
  statements: ParsedStatement[];
}

const GAIN = '#059669';
const LOSS = '#e11d48';

export function OverviewPage({ engine, transactions, statements }: Props) {
  const categories = useMemo(() => {
    const present = new Set(transactions.map((t) => t.category));
    return (['offshore', 'th_equity', 'th_fund'] as Category[]).filter((c) => present.has(c));
  }, [transactions]);

  const [category, setCategory] = useState<Category>(categories[0] ?? 'offshore');
  const active = categories.includes(category) ? category : (categories[0] ?? 'offshore');

  const periods = engine.periods.filter((p) => p.category === active);
  const gaps = engine.gaps.filter((g) => g.category === active);

  // Monthly net P/L. Losses point down and keep their own colour: a chart that
  // hid them would misrepresent exactly the thing this tool exists to show.
  const monthly = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const lot of engine.realized) {
      if (lot.category !== active) continue;
      const month = lot.tradeDate.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + lot.pnlTHB);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, pnl]) => ({ month, pnl: Math.round(pnl * 100) / 100 }));
  }, [engine.realized, active]);

  const open = useMemo(() => {
    const byPosition = new Map<
      string,
      { symbol: string; units: number; cost: number; lots: number; since: string; manual: boolean }
    >();
    for (const lot of engine.open) {
      if (lot.category !== active) continue;
      const key = `${lot.accountNo}|${lot.symbol}`;
      const existing = byPosition.get(key);
      if (existing) {
        existing.units += lot.remainingUnits;
        existing.cost += lot.costTHB;
        existing.lots += 1;
        existing.manual ||= lot.source !== 'pdf';
        if (lot.tradeDate < existing.since) existing.since = lot.tradeDate;
      } else {
        byPosition.set(key, {
          symbol: lot.symbol,
          units: lot.remainingUnits,
          cost: lot.costTHB,
          lots: 1,
          since: lot.tradeDate,
          manual: lot.source !== 'pdf',
        });
      }
    }
    return [...byPosition.values()].sort((a, b) => b.cost - a.cost);
  }, [engine.open, active]);

  const totals = periods.reduce(
    (a, p) => ({
      net: a.net + p.netPnL,
      gains: a.gains + p.sumOfGains,
      losses: a.losses + p.sumOfLosses,
    }),
    { net: 0, gains: 0, losses: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={[
              'rounded-md px-3 py-1.5 text-sm',
              c === active
                ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                : 'border border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-400',
            ].join(' ')}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card title="กำไร/ขาดทุนสุทธิ" hint="รวมทั้งกำไรและขาดทุน — ใช้ดูผลงาน ไม่ใช่ตัวเลขภาษี">
          <span className={`text-2xl font-semibold tnum ${pnlClass(totals.net)}`}>
            {signedBaht(totals.net)}
          </span>
        </Card>
        <Card title="รวมเฉพาะรายการที่กำไร" hint="ตัวเลขที่เกี่ยวกับภาษี">
          <span className="text-2xl font-semibold tnum text-emerald-600 dark:text-emerald-400">
            {baht(totals.gains)}
          </span>
        </Card>
        <Card title="รวมเฉพาะรายการที่ขาดทุน" hint="แสดงไว้ให้เห็น ถึงจะเอาไปหักกลบไม่ได้">
          <span className="text-2xl font-semibold tnum text-rose-600 dark:text-rose-400">
            {baht(totals.losses)}
          </span>
        </Card>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-sm font-semibold">กำไร/ขาดทุนที่รับรู้แล้ว รายเดือน</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          แท่งขึ้นคือกำไร แท่งลงคือขาดทุน ทุกเดือนที่มีรายการจะแสดงเสมอ
        </p>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-stone-200 dark:text-stone-800" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis
                tick={{ fontSize: 11 }}
                width={70}
                tickFormatter={(v: number) => (v / 1000).toFixed(0) + 'k'}
              />
              <ReferenceLine y={0} stroke="currentColor" className="text-stone-400" />
              <Tooltip
                formatter={(v) => [signedBaht(Number(v)) + ' บาท', 'สุทธิ']}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="pnl" radius={[2, 2, 2, 2]}>
                {monthly.map((d) => (
                  <Cell key={d.month} fill={d.pnl >= 0 ? GAIN : LOSS} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-sm font-semibold">สรุปรายปี</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="py-1 font-medium">ปี</th>
              <th className="py-1 text-right font-medium">รายการ</th>
              <th className="py-1 text-right font-medium">สุทธิ</th>
              <th className="py-1 text-right font-medium">เฉพาะที่กำไร</th>
              <th className="py-1 text-right font-medium">เฉพาะที่ขาดทุน</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.year} className="border-t border-stone-200 dark:border-stone-800">
                <td className="py-1.5 tnum">{p.year}</td>
                <td className="py-1.5 text-right tnum text-stone-500">{p.lots}</td>
                <td className={`py-1.5 text-right tnum ${pnlClass(p.netPnL)}`}>{signedBaht(p.netPnL)}</td>
                <td className="py-1.5 text-right tnum text-emerald-600 dark:text-emerald-400">{baht(p.sumOfGains)}</td>
                <td className="py-1.5 text-right tnum text-rose-600 dark:text-rose-400">{baht(p.sumOfLosses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {gaps.length > 0 && (
          <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            ยังมียอดขาย{' '}
            <span className="tnum font-medium">
              {baht(gaps.reduce((a, g) => a + g.unaccountedProceedsTHB, 0))}
            </span>{' '}
            บาทที่ไม่มีต้นทุน จึงยังไม่ถูกนับในตัวเลขข้างบน
          </p>
        )}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">ที่ยังถืออยู่ ({open.length} ตัว)</h2>
          <span className="text-xs text-stone-500">
            ต้นทุนรวม <span className="tnum">{baht(open.reduce((a, p) => a + p.cost, 0))}</span> บาท
          </span>
        </div>
        <p className="mt-0.5 text-xs text-stone-500">
          แสดงต้นทุนเท่านั้น ไม่มีมูลค่าตลาดหรือกำไรที่ยังไม่รับรู้ เพราะระบบไม่ดึงราคาจากภายนอก
          ตัวเลขเหล่านี้ไม่เกี่ยวกับภาษีจนกว่าจะขายจริง
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1 pr-3 font-medium">หลักทรัพย์</th>
                <th className="py-1 pr-3 text-right font-medium">จำนวนหน่วย</th>
                <th className="py-1 pr-3 text-right font-medium">ต้นทุนรวม</th>
                <th className="py-1 pr-3 text-right font-medium">lot</th>
                <th className="py-1 font-medium">ถือมาตั้งแต่</th>
              </tr>
            </thead>
            <tbody>
              {open.map((p) => (
                <tr key={p.symbol} className="border-t border-stone-200 dark:border-stone-800">
                  <td className="py-1.5 pr-3 font-mono text-xs">
                    {p.symbol}
                    {p.manual && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        กรอกเอง
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tnum">{fmtUnits(p.units)}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{baht(p.cost)}</td>
                  <td className="py-1.5 pr-3 text-right tnum text-stone-500">{p.lots}</td>
                  <td className="py-1.5 tnum text-stone-500">{p.since}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {statements.length > 0 && <Reconciliation engine={engine} statements={statements} active={active} />}
    </div>
  );
}

/**
 * Compares the position we computed at each month end with what the broker's
 * statement reported. A symbol that first disagrees in April says the missing
 * paperwork is dated April, which is far less work than searching a symbol's
 * whole history.
 */
function Reconciliation({
  engine,
  statements,
  active,
}: {
  engine: Engine;
  statements: ParsedStatement[];
  active: Category;
}) {
  const rows = useMemo(() => {
    const relevant = statements
      .filter((s) => s.asOf && s.accountNo && s.holdings.length > 0)
      .sort((a, b) => (a.asOf ?? '').localeCompare(b.asOf ?? ''));

    const firstGap = new Map<string, { period: string; diff: number }>();
    for (const statement of relevant) {
      const held = new Map<string, number>();
      for (const lot of engine.open) {
        if (lot.accountNo !== statement.accountNo) continue;
        held.set(lot.symbol, (held.get(lot.symbol) ?? 0) + lot.remainingUnits);
      }
      for (const holding of statement.holdings) {
        const ours = held.get(holding.symbol) ?? 0;
        const diff = ours - holding.units;
        if (Math.abs(diff) < 1e-4 || firstGap.has(holding.symbol)) continue;
        firstGap.set(holding.symbol, { period: statement.period ?? '', diff });
      }
    }
    return [...firstGap.entries()].map(([symbol, gap]) => ({ symbol, ...gap }));
  }, [engine.open, statements]);

  if (rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-sm font-semibold">ตรวจสอบกับสรุปรายเดือน — {CATEGORY_LABEL[active]}</h2>
      <p className="mt-0.5 text-xs text-stone-500">
        เทียบยอดคงเหลือที่คำนวณได้กับที่ Dime รายงานไว้สิ้นเดือน
        ตัวที่ไม่ตรงแปลว่ามีใบยืนยันหายไป และเดือนที่แสดงคือจุดที่เริ่มไม่ตรง
      </p>
      <ul className="mt-3 space-y-1 text-xs">
        {rows.map((r) => (
          <li key={r.symbol} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono">{r.symbol}</span>
            <span className="text-stone-500">{r.period}</span>
            <span className={pnlClass(-r.diff)}>
              {r.diff < 0 ? `ขาดใบซื้อ ${fmtUnits(-r.diff)} หน่วย` : `ขาดใบขาย ${fmtUnits(r.diff)} หน่วย`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Card({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <p className="text-xs text-stone-500">{title}</p>
      <div className="mt-1">{children}</div>
      <p className="mt-1 text-xs text-stone-400">{hint}</p>
    </div>
  );
}
