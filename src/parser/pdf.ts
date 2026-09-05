import type { ParseResult } from '../core/types.ts';
import { toLines, type Page, type TextItem } from './layout.ts';
import { parsePages } from './index.ts';

/**
 * The only module that touches pdf.js. Everything downstream works on plain
 * positioned text, which keeps the parsers testable without a PDF and lets the
 * Node CLI and the browser worker share one code path.
 *
 * `getDocument` is injected rather than imported so each host can supply the
 * build it needs — the legacy ESM build under Node, the worker build in the
 * browser — without this file reaching for either.
 */
export interface PdfLoader {
  (args: { data: Uint8Array; password?: string }): Promise<PdfDocumentLike>;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: Array<{ str: string; transform: number[] }> }>;
  }>;
}

export async function extractPages(
  load: PdfLoader,
  data: Uint8Array,
  password?: string,
): Promise<Page[]> {
  const doc = await load({ data, password });
  const pages: Page[] = [];
  // Confirmation notes run to at least two pages and the transaction table can
  // continue past the first, so every page is read.
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: TextItem[] = content.items.map((i) => ({
      s: i.str,
      x: i.transform[4],
      y: i.transform[5],
    }));
    pages.push(toLines(items));
  }
  return pages;
}

export async function parsePdf(
  load: PdfLoader,
  file: string,
  data: Uint8Array,
  password?: string,
): Promise<ParseResult> {
  let pages: Page[];
  try {
    pages = await extractPages(load, data, password);
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'PasswordException') {
      const code = (err as { code?: number })?.code;
      // pdf.js reports 1 for "need a password" and 2 for "that password was wrong".
      return { file, reject: code === 2 ? 'wrong_password' : 'encrypted' };
    }
    throw err;
  }
  return parsePages(file, pages);
}
