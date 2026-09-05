/** Units are printed to 7 decimals, money to 2. Everything here rounds to those grids. */
export const UNIT_DP = 7;
export const MONEY_DP = 2;

const UNIT_EPS = 5e-8;

export function roundUnits(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True when two unit counts are the same position to within printing precision. */
export function unitsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < UNIT_EPS;
}

export function unitsPositive(n: number): boolean {
  return n > UNIT_EPS;
}

/**
 * "1,234.56" -> 1234.56. Statements print negatives as "- 17.82" with a space
 * between the sign and the digits, so whitespace is stripped alongside commas.
 * NaN when the token is not a number.
 */
export function parseAmount(s: string): number {
  const v = Number.parseFloat(String(s).replace(/[,\s]/g, ''));
  return Number.isFinite(v) ? v : NaN;
}

export function looksNumeric(s: string): boolean {
  return /^-?[\d,]+\.?\d*$/.test(String(s).trim());
}

/** "01/08/2024" -> "2024-08-01". Null when the token is not a date. */
export function toIsoDate(s: string | undefined | null): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Tolerance for `units x price === gross`.
 *
 * Price is printed rounded to 2 decimals while units carry 7, so the product
 * drifts in proportion to the size of the trade. A flat +/-0.01 falsely flags
 * roughly a third of the real offshore rows.
 */
export function grossTolerance(units: number): number {
  return Math.abs(units) * 0.005 + 0.011;
}

/** Tolerance for sums of already-rounded money (fee + vat + gross === total). */
export const MONEY_TOLERANCE = 0.011;
