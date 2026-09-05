/**
 * Stable id for a transaction. A confirmation note can list the same symbol
 * twice (two fills of one order arrive as separate rows), so the symbol and an
 * occurrence index join the invoice and order numbers to keep ids unique.
 * Re-importing the same file must produce the same ids, which is what makes
 * duplicate detection work without storing the file itself.
 */
export function transactionId(parts: {
  taxInvoiceNo: string;
  orderNo: string;
  symbol: string;
  occurrence: number;
}): string {
  const key = `${parts.taxInvoiceNo}|${parts.orderNo}|${parts.symbol}|${parts.occurrence}`;
  return `tx_${fnv1a(key)}`;
}

export function manualId(seed: string): string {
  return `mx_${fnv1a(seed)}_${Date.now().toString(36)}`;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
