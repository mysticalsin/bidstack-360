/** Blank probability is stored as 0. That is not a measured win chance. */
export function storedProbabilityLabel(probability: number, unrecorded = 'Not recorded'): string {
  return probability === 0 ? unrecorded : `${probability}%`;
}
