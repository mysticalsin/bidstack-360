/** Integer micros from a stored amount. An unsafe JS number has already lost cents. */
export function pipelineMicros(value: bigint | number | null | undefined): bigint {
  if (typeof value === 'bigint') return value < 0n ? 0n : value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  return 0n;
}

/** Open-pipeline total in integer micros. Number(valueMicros) drops cents past 2^53. */
export function sumOpenPipelineMicros(
  rows: readonly { valueMicros?: bigint | number | null }[],
): bigint {
  let total = 0n;
  for (const row of rows) total += pipelineMicros(row.valueMicros);
  return total;
}
