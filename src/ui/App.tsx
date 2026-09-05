import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../core/types.ts';
import type { ParsedStatement } from '../parser/statement.ts';
import { runFifo } from '../engine/fifo.ts';
import { summarise, completeness } from '../engine/summary.ts';
import { loadStored, saveStatements, saveTransactions } from '../app/store.ts';
import { ImportPage } from './ImportPage.tsx';
import { OverviewPage } from './OverviewPage.tsx';
import { TransactionsPage } from './TransactionsPage.tsx';
import { TaxReportPage } from './TaxReportPage.tsx';
import { PrivacyBanner } from './PrivacyBanner.tsx';

type Tab = 'import' | 'overview' | 'transactions' | 'tax';

const TABS: { id: Tab; label: string }[] = [
  { id: 'import', label: 'นำเข้า' },
  { id: 'overview', label: 'ภาพรวม' },
  { id: 'transactions', label: 'รายการ' },
  { id: 'tax', label: 'ภาษี' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('import');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [statements, setStatements] = useState<ParsedStatement[]>([]);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    loadStored().then(({ transactions: t, statements: s }) => {
      if (t.length > 0 || s.length > 0) {
        setTransactions(t);
        setStatements(s);
        setTab('overview');
      }
      setRestored(true);
    });
  }, []);

  const addTransactions = useCallback((incoming: Transaction[]) => {
    setTransactions((current) => {
      const byId = new Map(current.map((t) => [t.id, t]));
      for (const tx of incoming) byId.set(tx.id, tx);
      return [...byId.values()];
    });
    void saveTransactions(incoming);
  }, []);

  const addStatements = useCallback((incoming: ParsedStatement[]) => {
    setStatements((current) => {
      const byKey = new Map(
        current.map((s) => [`${s.file}|${s.accountNo}|${s.accountKind}`, s]),
      );
      for (const s of incoming) byKey.set(`${s.file}|${s.accountNo}|${s.accountKind}`, s);
      return [...byKey.values()];
    });
    void saveStatements(incoming);
  }, []);

  const removeTransaction = useCallback((id: string) => {
    setTransactions((current) => current.filter((t) => t.id !== id));
  }, []);

  const resetAll = useCallback(() => {
    setTransactions([]);
    setStatements([]);
  }, []);

  // One FIFO pass feeds every view, so no two screens can disagree.
  const engine = useMemo(() => {
    const result = runFifo(transactions);
    return {
      ...result,
      periods: summarise(result.realized),
      gaps: completeness(result.orphans),
    };
  }, [transactions]);

  const hasData = transactions.length > 0;

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <h1 className="text-base font-semibold">ใบยืนยันการซื้อขาย → ภาษี</h1>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                disabled={t.id !== 'import' && !hasData}
                className={[
                  'rounded-md px-3 py-1.5 text-sm transition',
                  tab === t.id
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'text-stone-600 hover:bg-stone-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-stone-400 dark:hover:bg-stone-800',
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {hasData && (
            <span className="ml-auto text-xs text-stone-500 tnum">
              {transactions.length} รายการ · {engine.realized.length} lot ที่รับรู้แล้ว
            </span>
          )}
        </div>
      </header>

      <PrivacyBanner />

      <main className="mx-auto max-w-7xl px-4 py-6">
        {!restored ? (
          <p className="text-sm text-stone-500">กำลังอ่านข้อมูลที่บันทึกไว้…</p>
        ) : tab === 'import' ? (
          <ImportPage
            transactions={transactions}
            statements={statements}
            orphans={engine.orphans}
            onTransactions={addTransactions}
            onStatements={addStatements}
            onReset={resetAll}
          />
        ) : tab === 'overview' ? (
          <OverviewPage engine={engine} transactions={transactions} statements={statements} />
        ) : tab === 'transactions' ? (
          <TransactionsPage transactions={transactions} onRemove={removeTransaction} />
        ) : (
          <TaxReportPage engine={engine} />
        )}
      </main>
    </div>
  );
}

export type Engine = ReturnType<typeof runFifo> & {
  periods: ReturnType<typeof summarise>;
  gaps: ReturnType<typeof completeness>;
};
