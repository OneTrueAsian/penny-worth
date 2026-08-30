/** The one shared "$1,234.56" / "-$1,234.56" formatter used everywhere a
 * full (non-abbreviated) dollar amount is displayed — thousands get a
 * comma separator via the locale formatter rather than a hand-rolled
 * regex. For the abbreviated "$1.2k" / "$3.4M" style, see
 * `fmtMoneyShort` in charts.tsx instead. */
export function formatAmount(amount: string | number): string {
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${s}` : `$${s}`;
}
