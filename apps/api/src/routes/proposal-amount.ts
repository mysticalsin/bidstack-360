const MICROS_PER_UNIT = 1_000_000n;

/**
 * Linked opportunity valueMicros has no currency column. Group the units.
 * A euro sign in the draft prompt would price a synthetic bid the CRM never recorded.
 */
function formatProposalUnits(valueMicros: bigint | number): string {
  const value = typeof valueMicros === 'bigint' ? valueMicros : BigInt(Math.trunc(valueMicros));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const units = Number(whole) + Number(remainder) / 1_000_000;
  if (!Number.isFinite(units)) return 'Not a number';
  const signed = negative ? -units : units;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(signed);
}

/**
 * The value line fed to a proposal section draft.
 * A missing or zero amount stays blank: zero is not a recorded price.
 */
export function proposalOpportunityValueLine(
  valueMicros: bigint | number | null | undefined,
): string {
  if (!valueMicros) return '';
  return `Value: ${formatProposalUnits(valueMicros)}`;
}
