/**
 * Turning a bag of positioned text items into rows.
 *
 * Two rules from the real documents drive this file:
 *  1. Items on one visual row can differ in y by 1-2 units, so rows are clustered
 *     with a tolerance rather than matched on an exact y.
 *  2. Numbers are right-aligned while their headers are left-aligned, so a column
 *     cannot be identified by an x range. Callers zip items by their order within
 *     the row instead. That only works if items are sorted by x *after* clustering,
 *     which is why the sort below is per-cluster and not global.
 */

export interface TextItem {
  s: string;
  x: number;
  y: number;
}

export interface Line {
  y: number;
  items: TextItem[];
  /** Items joined by a space, for cheap pattern tests. */
  text: string;
}

export type Page = Line[];

export const ROW_Y_TOLERANCE = 2;

export function toLines(items: TextItem[], tolerance = ROW_Y_TOLERANCE): Page {
  const kept = items
    .filter((i) => i.s.trim() !== '')
    .map((i) => ({ s: i.s.trim(), x: i.x, y: i.y }))
    .sort((a, b) => b.y - a.y);

  const lines: Page = [];
  for (const item of kept) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - item.y) <= tolerance) last.items.push(item);
    else lines.push({ y: item.y, items: [item], text: '' });
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map((i) => i.s).join(' ');
  }
  return lines;
}

export function cells(line: Line | undefined): string[] {
  return line ? line.items.map((i) => i.s) : [];
}

export function pageText(pages: Page[]): string {
  return pages.flat().map((l) => l.text).join('\n');
}

export function countItems(pages: Page[]): number {
  return pages.reduce((a, p) => a + p.reduce((b, l) => b + l.items.length, 0), 0);
}
