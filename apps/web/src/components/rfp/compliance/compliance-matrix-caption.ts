import { COMPLIANCE_MATRIX_DRAWN, complianceMatrixPage } from '@bidstack/shared';

export { COMPLIANCE_MATRIX_DRAWN, complianceMatrixPage };

/**
 * Rows the matrix draws. The API drops the probe and sets `matrixContinues`.
 * A response that still carries that row is paged here so the probe is not
 * shown.
 */
export function shownComplianceMatrix<T>(
  items: readonly T[],
  matrixContinues: boolean | undefined,
): { items: T[]; pageContinues: boolean } {
  if (items.length > COMPLIANCE_MATRIX_DRAWN) return complianceMatrixPage(items);
  return { items: [...items], pageContinues: Boolean(matrixContinues) };
}

/**
 * Compliance matrix caption. A longer loaded list is the latest rows, not
 * every row. A shorter list keeps "C / N compliant · P pending". No row
 * total is invented.
 */
export function complianceMatrixCaption(
  count: number,
  compliant: number,
  pending: number,
  pageContinues: boolean,
): string {
  if (pageContinues) {
    return `${count} in the latest ${count}, not every row`;
  }
  return `${compliant} / ${count} compliant · ${pending} pending`;
}
