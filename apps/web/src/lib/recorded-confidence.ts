/** A missing score stays missing. Callers must not substitute a default percent. */
export function recordedConfidencePercent(confidence: number | null | undefined): number | null {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}
