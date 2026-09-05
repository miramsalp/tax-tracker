import Dexie, { type EntityTable } from 'dexie';
import type { Transaction } from '../core/types.ts';
import type { ParsedStatement } from '../parser/statement.ts';

/**
 * Storage is opt-in and lives only in this browser.
 *
 * It is offered because hand-entered transactions have to survive a reload —
 * nobody is going to retype sixteen missing trades every session — but it stays
 * a choice, with a delete-everything button and a JSON export so the data can
 * be moved or kept outside the browser.
 */

const PERSIST_KEY = 'dime.persist';

export interface StoredStatement extends ParsedStatement {
  /** file + account, so re-importing the same statement replaces it. */
  key: string;
}

class TaxDatabase extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>;
  statements!: EntityTable<StoredStatement, 'key'>;

  constructor() {
    super('dime-tax-tracker');
    this.version(1).stores({
      transactions: 'id, accountNo, symbol, tradeDate, category, source',
      statements: 'key, accountNo, asOf',
    });
  }
}

let db: TaxDatabase | null = null;

function database(): TaxDatabase {
  if (!db) db = new TaxDatabase();
  return db;
}

export function isPersistenceEnabled(): boolean {
  try {
    return localStorage.getItem(PERSIST_KEY) === 'on';
  } catch {
    return false;
  }
}

export async function setPersistenceEnabled(on: boolean): Promise<void> {
  try {
    localStorage.setItem(PERSIST_KEY, on ? 'on' : 'off');
  } catch {
    /* private browsing — the session simply stays in memory */
  }
  if (!on) await clearStoredData();
}

export async function loadStored(): Promise<{
  transactions: Transaction[];
  statements: ParsedStatement[];
}> {
  if (!isPersistenceEnabled()) return { transactions: [], statements: [] };
  try {
    const [transactions, statements] = await Promise.all([
      database().transactions.toArray(),
      database().statements.toArray(),
    ]);
    return { transactions, statements };
  } catch {
    return { transactions: [], statements: [] };
  }
}

export async function saveTransactions(transactions: Transaction[]): Promise<void> {
  if (!isPersistenceEnabled() || transactions.length === 0) return;
  await database().transactions.bulkPut(transactions);
}

export async function saveStatements(statements: ParsedStatement[]): Promise<void> {
  if (!isPersistenceEnabled() || statements.length === 0) return;
  await database().statements.bulkPut(
    statements.map((s) => ({ ...s, key: `${s.file}|${s.accountNo ?? ''}|${s.accountKind}` })),
  );
}

export async function deleteTransaction(id: string): Promise<void> {
  if (!isPersistenceEnabled()) return;
  await database().transactions.delete(id);
}

export async function clearStoredData(): Promise<void> {
  try {
    await database().delete();
    db = null;
  } catch {
    /* nothing stored yet */
  }
}

export interface Backup {
  format: 'dime-tax-tracker';
  version: 1;
  exportedAt: string;
  transactions: Transaction[];
  statements: ParsedStatement[];
}

export function buildBackup(transactions: Transaction[], statements: ParsedStatement[]): Backup {
  return {
    format: 'dime-tax-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions,
    statements,
  };
}

export function readBackup(text: string): Backup {
  const parsed = JSON.parse(text) as Backup;
  if (parsed?.format !== 'dime-tax-tracker') {
    throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของระบบนี้');
  }
  return parsed;
}
