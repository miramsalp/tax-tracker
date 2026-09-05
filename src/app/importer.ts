import type { ParseResult, Transaction, RejectReason } from '../core/types.ts';
import { isRejected } from '../core/types.ts';
import type { ParsedStatement } from '../parser/statement.ts';
import type { ParseRequest, WorkerResponse } from '../worker/parse.worker.ts';

/**
 * Drives a pool of parse workers over a batch of files and reports progress as
 * it goes. A few hundred confirmation notes take minutes, so results stream out
 * one file at a time rather than arriving in one lump at the end, and the run
 * can be stopped.
 */

/** Four at a time: enough to use the cores, few enough not to swamp memory. */
const CONCURRENCY = 4;

export type Severity = 'blocked' | 'needs_password' | 'warning' | 'skipped' | 'ok';

export interface FileOutcome {
  file: string;
  severity: Severity;
  /** Why it was rejected and what to do instead. Always both, never just "invalid". */
  title: string;
  detail?: string;
  transactions: Transaction[];
  statements: ParsedStatement[];
  /** Set when the user must decide before these rows are accepted. */
  pendingIdentity?: { taxId: string; accountNo: string };
}

export interface ImportProgress {
  done: number;
  total: number;
  current: string | null;
}

export interface ImportHandle {
  cancel(): void;
  promise: Promise<FileOutcome[]>;
}

export interface ImportOptions {
  files: File[];
  /** Password applied to every encrypted file in the batch. */
  password?: string;
  /** Tax invoice numbers already imported, so repeats are skipped quietly. */
  knownInvoices: Set<string>;
  /** Tax ID of the documents imported so far, if any. */
  knownTaxId?: string | null;
  onProgress(progress: ImportProgress): void;
  onOutcome(outcome: FileOutcome): void;
}

const REJECT_MESSAGES: Record<RejectReason, { title: string; detail: string }> = {
  monthly_statement: {
    title: 'ไฟล์นี้เป็นสรุปรายเดือน (Statement) ไม่ใช่ใบยืนยันการซื้อขาย',
    detail:
      'สรุปรายเดือนบอกแค่ยอดคงเหลือสิ้นเดือน ไม่มีข้อมูลรายการซื้อขายทีละรายการที่ใช้คำนวณ FIFO ได้ ' +
      'กรุณาใช้ไฟล์ Confirmation Note แทน — แต่ระบบเก็บยอดคงเหลือจากไฟล์นี้ไว้ใช้ตรวจสอบความครบถ้วนให้แล้ว',
  },
  scanned: {
    title: 'อ่านข้อความจากไฟล์นี้ไม่ได้ (เป็นไฟล์สแกน)',
    detail:
      'ไฟล์นี้เป็นภาพ ไม่มีชั้นข้อความให้อ่าน กรุณาดาวน์โหลดไฟล์ต้นฉบับจากแอป Dime ใหม่อีกครั้ง ' +
      'อย่าใช้ไฟล์ที่ได้จากการถ่ายรูปหรือสแกนกระดาษ',
  },
  unknown_format: {
    title: 'ยังไม่รองรับรูปแบบเอกสารนี้',
    detail:
      'ไฟล์เปิดได้และมีข้อความ แต่โครงสร้างไม่ตรงกับใบยืนยันแบบที่ระบบรู้จัก ' +
      'กด "ส่งออกโครงสร้างไฟล์" เพื่อได้ไฟล์ที่บอกเฉพาะตำแหน่งและชนิดของช่อง โดยไม่มีตัวเลขหรือข้อมูลส่วนตัว',
  },
  encrypted: {
    title: 'ไฟล์นี้ต้องใช้รหัสผ่าน',
    detail: 'ใส่รหัสผ่านที่ Dime ใช้ป้องกันไฟล์ แล้วเลือกใช้กับไฟล์ที่เหลือทั้งหมดได้',
  },
  wrong_password: {
    title: 'รหัสผ่านไม่ถูกต้อง',
    detail: 'ลองใหม่อีกครั้ง รายการที่นำเข้าไปแล้วยังอยู่ครบ ไม่ถูกล้าง',
  },
};

export function startImport(options: ImportOptions): ImportHandle {
  const { files, password, knownInvoices, knownTaxId, onProgress, onOutcome } = options;
  let cancelled = false;
  let cursor = 0;
  let done = 0;

  // Tracks invoice numbers within this batch too, so a file dropped twice in
  // one go is caught as well as one already in the store.
  const seenInvoices = new Set(knownInvoices);
  let batchTaxId = knownTaxId ?? null;

  const workers: Worker[] = [];
  const outcomes: FileOutcome[] = [];

  const promise = new Promise<FileOutcome[]>((resolve) => {
    let running = 0;

    const finish = () => {
      for (const w of workers) w.terminate();
      resolve(outcomes);
    };

    const pump = (worker: Worker) => {
      if (cancelled || cursor >= files.length) {
        running -= 1;
        if (running === 0) finish();
        return;
      }
      const file = files[cursor++];
      onProgress({ done, total: files.length, current: file.name });
      file
        .arrayBuffer()
        .then((buffer) => {
          const request: ParseRequest = {
            type: 'parse',
            jobId: cursor,
            file: file.name,
            data: buffer,
            password,
          };
          worker.postMessage(request, [buffer]);
        })
        .catch(() => {
          record({
            file: file.name,
            severity: 'blocked',
            title: 'เปิดไฟล์ไม่ได้',
            detail: 'เบราว์เซอร์อ่านไฟล์นี้ไม่สำเร็จ ลองลากไฟล์เข้ามาใหม่อีกครั้ง',
            transactions: [],
            statements: [],
          });
          pump(worker);
        });
    };

    const record = (outcome: FileOutcome) => {
      done += 1;
      outcomes.push(outcome);
      onOutcome(outcome);
      onProgress({ done, total: files.length, current: null });
    };

    const handle = (worker: Worker, message: WorkerResponse) => {
      if (message.type === 'failed') {
        record({
          file: message.file,
          severity: 'blocked',
          title: 'อ่านไฟล์นี้ไม่สำเร็จ',
          detail: `${message.message} — ถ้าเกิดกับไฟล์เดียว ให้ดาวน์โหลดใหม่จากแอป Dime`,
          transactions: [],
          statements: [],
        });
      } else {
        record(classify(message.result, message.statements));
      }
      pump(worker);
    };

    const classify = (result: ParseResult, statements: ParsedStatement[]): FileOutcome => {
      if (isRejected(result)) {
        const message = REJECT_MESSAGES[result.reject];
        const needsPassword = result.reject === 'encrypted' || result.reject === 'wrong_password';
        return {
          file: result.file,
          // A statement still contributes its holdings, so it is not a failure.
          severity: needsPassword
            ? 'needs_password'
            : result.reject === 'monthly_statement'
              ? 'ok'
              : 'blocked',
          title: message.title,
          detail: message.detail,
          transactions: [],
          statements,
        };
      }

      const invoice = result.header.taxInvoiceNo;
      if (invoice && seenInvoices.has(invoice)) {
        return {
          file: result.file,
          severity: 'skipped',
          title: 'ข้ามไฟล์ซ้ำ',
          detail: `เลขที่ใบกำกับภาษี ${invoice} ถูกนำเข้าไปแล้ว`,
          transactions: [],
          statements,
        };
      }
      if (invoice) seenInvoices.add(invoice);

      const taxId = result.header.taxId;
      // Different account holder: a warning, not a block. People legitimately
      // hold more than one account, and only they can say which is theirs.
      if (taxId && batchTaxId && taxId !== batchTaxId) {
        return {
          file: result.file,
          severity: 'warning',
          title: 'ไฟล์นี้เป็นของผู้ถือบัญชีคนละคนกับที่นำเข้าไว้',
          detail:
            `เอกสารก่อนหน้าเป็นของ ${mask(batchTaxId)} แต่ไฟล์นี้เป็นของ ${mask(taxId)} — ` +
            'ถ้ารวมกันโดยไม่ตั้งใจ ต้นทุน FIFO จะผิดทั้งชุด',
          transactions: result.transactions,
          statements,
          pendingIdentity: { taxId, accountNo: result.header.accountNo ?? '' },
        };
      }
      if (taxId && !batchTaxId) batchTaxId = taxId;

      const flagged = result.transactions.filter((t) => t.confidence === 'low').length;
      const notes = [...result.warnings];
      if (flagged > 0) notes.push(`${flagged} รายการไม่ผ่านการตรวจสอบตัวเลข ต้องเปิดดู`);

      return {
        file: result.file,
        severity: notes.length > 0 ? 'warning' : 'ok',
        title: notes.length > 0 ? 'นำเข้าแล้วแต่มีรายการต้องตรวจสอบ' : 'นำเข้าเรียบร้อย',
        detail: notes.length > 0 ? notes.join(' · ') : undefined,
        transactions: result.transactions,
        statements,
      };
    };

    for (let i = 0; i < Math.min(CONCURRENCY, files.length); i++) {
      const worker = new Worker(new URL('../worker/parse.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => handle(worker, event.data);
      workers.push(worker);
      running += 1;
      pump(worker);
    }

    if (files.length === 0) resolve([]);
  });

  return {
    cancel() {
      cancelled = true;
    },
    promise,
  };
}

function mask(taxId: string): string {
  return `${taxId.slice(0, 1)}-xxxx-xxxxx-xx-${taxId.slice(-1)}`;
}
