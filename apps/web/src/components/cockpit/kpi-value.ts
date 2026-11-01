/** True when one fraction digit would print a different number than the label. */
export function kpiFractionWouldMove(literal: string, locale?: string): boolean {
  if (!literal.includes('.')) return false;
  const target = Number(literal.replace(/,/g, ''));
  if (!Number.isFinite(target)) return true;
  const shown = target.toLocaleString(locale, { maximumFractionDigits: 1 });
  const digits = (value: string) => value.replace(/\D/g, '');
  return digits(shown) !== digits(literal);
}
