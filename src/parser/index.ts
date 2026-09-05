import type { ParseResult, Category } from '../core/types.ts';
import { countItems, type Page } from './layout.ts';
import { extractHeader } from './header.ts';
import { extractTotals } from './totals.ts';
import { detectFormat } from './registry.ts';
import { checkRow, checkDocumentTotals } from './checksum.ts';

export { toLines, type TextItem, type Line, type Page } from './layout.ts';
export { detectFormat, FORMATS } from './registry.ts';
export { isOptionSymbol, parseOptionSymbol } from './parsers/offshore.ts';
export { isBuySide } from './checksum.ts';

/**
 * A scanned page yields almost no text items. The threshold sits well below the
 * ~100 items a real single-trade note produces and well above zero, so a mostly
 * blank but text-based page is not mistaken for a scan.
 */
const MIN_TEXT_ITEMS = 20;

/** Parses already-extracted page lines. Pure, so it can be tested without a PDF. */
export function parsePages(file: string, pages: Page[]): ParseResult {
  if (countItems(pages) < MIN_TEXT_ITEMS) {
    return { file, reject: 'scanned' };
  }

  const format = detectFormat(pages);
  if (format.id === 'monthly_statement') return { file, reject: 'monthly_statement' };
  if (format.id === 'unknown' || !format.parse) return { file, reject: 'unknown_format' };

  const category = format.id as Category;
  const header = extractHeader(pages);
  const totals = extractTotals(pages);
  const transactions = format.parse(pages, header);

  for (const tx of transactions) {
    tx.sourceFile = file;
    tx.warnings = checkRow(tx, category);
    tx.confidence = tx.warnings.length > 0 ? 'low' : 'ok';
  }

  const warnings = checkDocumentTotals(transactions, totals, category);
  if (transactions.length === 0) {
    warnings.push('no transaction rows were found in a document that matched a known format');
  }
  for (const field of ['accountNo', 'taxInvoiceNo', 'effectiveDate', 'taxId'] as const) {
    if (!header[field]) warnings.push(`header field ${field} could not be read`);
  }

  return { file, category, numPages: pages.length, header, transactions, totals, warnings };
}
