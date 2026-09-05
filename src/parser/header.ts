import type { DocumentHeader } from '../core/types.ts';
import { toIsoDate } from '../core/num.ts';
import type { Page, Line } from './layout.ts';

/**
 * Header values sit on the line *above* their label and are right-aligned in
 * their column, so the x of a value never lines up with the x of its label.
 * (Effective Date's label sits at x=249 while its value sits at x=333; Issue
 * Date's label at x=393 with its value at x=534. Nearest-label matching picks
 * the wrong one.)
 *
 * The same positional trick used for the table body works here: take the known
 * labels on a line ordered by x, take the values on the line above ordered by x,
 * and zip. When the two counts disagree the layout is not what we expect, so the
 * line is skipped rather than guessed at.
 */
const HEADER_LABELS = [
  'Account Type',
  'No.',
  'Account No.',
  'Tax Invoice No.',
  'Effective Date',
  'Issue Date',
] as const;

/** Labels sit to the right of the address block; ignore anything further left. */
const LEFT_MARGIN = 40;

export function extractHeader(pages: Page[]): DocumentHeader {
  const lines = pages.flat();
  const found: Record<string, string> = {};

  for (let i = 1; i < lines.length; i++) {
    const labels = lines[i].items.filter((it) =>
      (HEADER_LABELS as readonly string[]).includes(it.s),
    );
    if (labels.length === 0) continue;

    const minX = Math.min(...labels.map((l) => l.x)) - LEFT_MARGIN;
    const values = lines[i - 1].items.filter((it) => it.x >= minX);
    if (values.length !== labels.length) continue;

    labels.forEach((label, k) => {
      if (!(label.s in found)) found[label.s] = values[k].s;
    });
  }

  return {
    accountType: found['Account Type'] ?? null,
    accountNo: found['Account No.'] ?? null,
    docNo: found['No.'] ?? null,
    taxInvoiceNo: found['Tax Invoice No.'] ?? null,
    effectiveDate: toIsoDate(found['Effective Date']),
    issueDate: toIsoDate(found['Issue Date']),
    taxId: findTaxId(lines),
  };
}

/**
 * Two 13-digit tax IDs appear on every document: the broker's registration
 * number in the top-right block, and the account holder's next to the
 * "TAX I.D." label in the address block. Only the latter identifies the person,
 * so anchoring on that label matters — keying off "the first 13-digit number"
 * would match every file to the broker and make the same-person check useless.
 */
function findTaxId(lines: Line[]): string | null {
  for (const line of lines) {
    if (!/TAX I\.D\./i.test(line.text)) continue;
    const id = line.items.find((it) => /^\d{13}$/.test(it.s));
    if (id) return id.s;
  }
  return null;
}
