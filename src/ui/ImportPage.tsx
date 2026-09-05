import { useCallback, useRef, useState } from 'react';
import type { Transaction } from '../core/types.ts';
import type { ParsedStatement } from '../parser/statement.ts';
import type { OrphanSell } from '../engine/fifo.ts';
import { startImport, type FileOutcome, type ImportHandle } from '../app/importer.ts';
import {
  buildBackup,
  clearStoredData,
  isPersistenceEnabled,
  readBackup,
  setPersistenceEnabled,
} from '../app/store.ts';
import { ManualEntryDialog } from './ManualEntryDialog.tsx';
import { baht, units as fmtUnits } from './format.ts';

interface Props {
  transactions: Transaction[];
  statements: ParsedStatement[];
  orphans: OrphanSell[];
  onTransactions(transactions: Transaction[]): void;
  onStatements(statements: ParsedStatement[]): void;
  onReset(): void;
}

const SEVERITY_STYLE = {
  blocked: 'border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40',
  needs_password: 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
  warning: 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
  skipped: 'border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900',
  ok: 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900',
} as const;

export function ImportPage(props: Props) {
  const { transactions, statements, orphans, onTransactions, onStatements, onReset } = props;
  const [progress, setProgress] = useState<{ done: number; total: number; current: string | null } | null>(null);
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([]);
  const [password, setPassword] = useState('');
  const [applyToAll, setApplyToAll] = useState(true);
  const [persist, setPersist] = useState(isPersistenceEnabled);
  const [manualOpen, setManualOpen] = useState<OrphanSell | 'blank' | null>(null);
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<ImportHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      setOutcomes([]);
      setProgress({ done: 0, total: files.length, current: null });

      const knownInvoices = new Set(
        transactions.map((t) => t.taxInvoiceNo).filter((v): v is string => Boolean(v)),
      );
      const knownTaxId = transactions.find((t) => t.taxId)?.taxId ?? null;

      const handle = startImport({
        files,
        password: password || undefined,
        knownInvoices,
        knownTaxId,
        onProgress: setProgress,
        onOutcome(outcome) {
          setOutcomes((current) => [...current, outcome]);
          // Results land as they arrive rather than in one lump at the end.
          if (outcome.transactions.length > 0 && !outcome.pendingIdentity) {
            onTransactions(outcome.transactions);
          }
          if (outcome.statements.length > 0) onStatements(outcome.statements);
        },
      });
      handleRef.current = handle;
      handle.promise.then(() => {
        setProgress(null);
        handleRef.current = null;
      });
    },
    [transactions, password, onTransactions, onStatements],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const files = [...event.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith('.pdf'));
      run(files);
    },
    [run],
  );

  const summary = summarise(outcomes);
  const blocked = outcomes.filter((o) => o.severity === 'blocked' || o.severity === 'needs_password');
  const warnings = outcomes.filter((o) => o.severity === 'warning');

  return (
    <div className="space-y-6">
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'rounded-xl border-2 border-dashed p-10 text-center transition',
          dragging
            ? 'border-stone-900 bg-stone-100 dark:border-stone-100 dark:bg-stone-800'
            : 'border-stone-300 dark:border-stone-700',
        ].join(' ')}
      >
        <p className="text-sm font-medium">ลากไฟล์ PDF ใบยืนยันการซื้อขายมาวางที่นี่</p>
        <p className="mt-1 text-xs text-stone-500">
          ใส่ทั้งโฟลเดอร์ได้ · ไฟล์สรุปรายเดือนใส่มาด้วยได้ ระบบจะแยกไปใช้ตรวจสอบความครบถ้วนเอง
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 rounded-md bg-stone-900 px-4 py-2 text-sm text-white dark:bg-stone-100 dark:text-stone-900"
        >
          เลือกไฟล์
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(e) => run([...(e.target.files ?? [])])}
        />

        <div className="mx-auto mt-6 flex max-w-md flex-col gap-2 text-left">
          <label className="text-xs text-stone-500" htmlFor="pdf-password">
            รหัสผ่านของไฟล์ (ถ้ามี)
          </label>
          <input
            id="pdf-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="เช่น วันเกิดหรือเลขบัตรตามที่ Dime กำหนด"
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
          />
          <label className="flex items-center gap-2 text-xs text-stone-500">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
            />
            ใช้รหัสนี้กับไฟล์ที่เหลือทั้งหมด
          </label>
        </div>
      </section>

      {progress && (
        <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center justify-between text-sm">
            <span className="truncate">
              กำลังอ่าน {progress.current ?? '…'}
            </span>
            <span className="tnum text-stone-500">
              {progress.done} / {progress.total} · เหลือ {progress.total - progress.done}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
            <div
              className="h-full bg-stone-900 transition-all dark:bg-stone-100"
              style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => handleRef.current?.cancel()}
            className="mt-3 rounded-md border border-stone-300 px-3 py-1.5 text-xs dark:border-stone-700"
          >
            ยกเลิก
          </button>
        </section>
      )}

      {outcomes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            ผลการนำเข้า — สำเร็จ {summary.ok} · เตือน {summary.warning} · ข้ามซ้ำ {summary.skipped} ·
            ไม่รับ {summary.blocked}
          </h2>

          {[...blocked, ...warnings].map((outcome, i) => (
            <article
              key={`${outcome.file}-${i}`}
              className={`rounded-lg border p-3 text-sm ${SEVERITY_STYLE[outcome.severity]}`}
            >
              <p className="font-medium">{outcome.title}</p>
              <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-400">{outcome.file}</p>
              {outcome.detail && (
                <p className="mt-1.5 text-xs leading-relaxed text-stone-700 dark:text-stone-300">
                  {outcome.detail}
                </p>
              )}
              {outcome.pendingIdentity && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onTransactions(outcome.transactions)}
                    className="rounded-md bg-stone-900 px-3 py-1 text-xs text-white dark:bg-stone-100 dark:text-stone-900"
                  >
                    ยืนยันว่าเป็นบัญชีของฉันเอง
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutcomes((c) => c.filter((o) => o !== outcome))}
                    className="rounded-md border border-stone-300 px-3 py-1 text-xs dark:border-stone-700"
                  >
                    ข้ามไฟล์นี้
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {orphans.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <h2 className="text-sm font-semibold">
            มี {orphans.length} รายการขายที่ยังไม่มีต้นทุน — รวมมูลค่า{' '}
            <span className="tnum">
              {baht(orphans.reduce((a, o) => a + o.missingProceedsTHB, 0))}
            </span>{' '}
            บาท
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
            ยอดขายเหล่านี้ถูกกันออกจากตัวเลขภาษีไว้ก่อน เพราะยังไม่รู้ต้นทุน
            ถ้านับเป็นต้นทุน 0 จะกลายเป็นกำไรทั้งก้อนและตัวเลขที่ยื่นจะสูงเกินจริง
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">วันที่ขาย</th>
                  <th className="py-1 pr-3 font-medium">หลักทรัพย์</th>
                  <th className="py-1 pr-3 text-right font-medium">หน่วยที่ขาดต้นทุน</th>
                  <th className="py-1 pr-3 text-right font-medium">มูลค่าที่กระทบ</th>
                  <th className="py-1 pr-3 font-medium">ซื้อครั้งแรกที่มี</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orphans.map((o) => (
                  <tr key={o.sellTxId + o.symbol} className="border-t border-amber-200/60 dark:border-amber-900/60">
                    <td className="py-1.5 pr-3 tnum">{o.tradeDate}</td>
                    <td className="py-1.5 pr-3 font-mono">{o.symbol}</td>
                    <td className="py-1.5 pr-3 text-right tnum">{fmtUnits(o.unitsMissing)}</td>
                    <td className="py-1.5 pr-3 text-right tnum">{baht(o.missingProceedsTHB)}</td>
                    <td className="py-1.5 pr-3 tnum">{o.firstBuyInData ?? 'ไม่มีเลย'}</td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => setManualOpen(o)}
                        className="rounded border border-amber-400 px-2 py-0.5 dark:border-amber-700"
                      >
                        กรอกต้นทุนเอง
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-900">
        <h2 className="font-semibold">ข้อมูลของคุณ</h2>
        <div className="mt-3 space-y-2 text-xs">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={persist}
              onChange={async (e) => {
                setPersist(e.target.checked);
                await setPersistenceEnabled(e.target.checked);
                if (!e.target.checked) onReset();
              }}
              className="mt-0.5"
            />
            <span>
              เก็บข้อมูลไว้ในเบราว์เซอร์นี้ เพื่อไม่ต้องนำเข้าใหม่ทุกครั้ง
              <span className="block text-stone-500">
                จำเป็นถ้าจะกรอกรายการเอง เพราะรายการที่กรอกไม่มีไฟล์ให้นำเข้าซ้ำ
                ข้อมูลอยู่ในเครื่องนี้เท่านั้น
              </span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => setManualOpen('blank')}
              className="rounded-md border border-stone-300 px-3 py-1.5 dark:border-stone-700"
            >
              เพิ่มรายการเอง
            </button>
            <button
              type="button"
              onClick={() => downloadBackup(transactions, statements)}
              disabled={transactions.length === 0}
              className="rounded-md border border-stone-300 px-3 py-1.5 disabled:opacity-40 dark:border-stone-700"
            >
              ส่งออกเป็น JSON
            </button>
            <label className="cursor-pointer rounded-md border border-stone-300 px-3 py-1.5 dark:border-stone-700">
              นำเข้าไฟล์สำรอง
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const backup = readBackup(await file.text());
                    onTransactions(backup.transactions);
                    onStatements(backup.statements);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : 'อ่านไฟล์สำรองไม่สำเร็จ');
                  }
                }}
              />
            </label>
            <button
              type="button"
              onClick={async () => {
                if (!confirm('ลบข้อมูลทั้งหมดในเบราว์เซอร์นี้? การกระทำนี้ย้อนกลับไม่ได้')) return;
                await clearStoredData();
                onReset();
              }}
              className="rounded-md border border-rose-300 px-3 py-1.5 text-rose-700 dark:border-rose-900 dark:text-rose-400"
            >
              ลบข้อมูลทั้งหมด
            </button>
          </div>
        </div>
      </section>

      {manualOpen && (
        <ManualEntryDialog
          transactions={transactions}
          orphan={manualOpen === 'blank' ? null : manualOpen}
          onClose={() => setManualOpen(null)}
          onSave={(tx) => {
            onTransactions([tx]);
            setManualOpen(null);
          }}
        />
      )}
    </div>
  );
}

function summarise(outcomes: FileOutcome[]) {
  return {
    ok: outcomes.filter((o) => o.severity === 'ok').length,
    warning: outcomes.filter((o) => o.severity === 'warning').length,
    skipped: outcomes.filter((o) => o.severity === 'skipped').length,
    blocked: outcomes.filter((o) => o.severity === 'blocked' || o.severity === 'needs_password')
      .length,
  };
}

function downloadBackup(transactions: Transaction[], statements: ParsedStatement[]) {
  const blob = new Blob([JSON.stringify(buildBackup(transactions, statements), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dime-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
