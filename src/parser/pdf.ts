import type { ParseResult, RejectReason } from '../core/types.ts';
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

/**
 * An encrypted document is a prompt, not a failure — the user is asked for the
 * password and the file goes back in the queue. Anything else is a real error
 * and is re-thrown so it surfaces rather than being silently skipped.
 *
 * pdf.js reports code 1 for "needs a password" and 2 for "that password was
 * wrong"; the two lead to different prompts, so they stay distinct.
 */
export function passwordReject(err: unknown): RejectReason | null {
  if ((err as { name?: string })?.name !== 'PasswordException') return null;
  return (err as { code?: number })?.code === 2 ? 'wrong_password' : 'encrypted';
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
    const reject = passwordReject(err);
    if (reject) return { file, reject };
    throw err;
  }
  return parsePages(file, pages);
}
