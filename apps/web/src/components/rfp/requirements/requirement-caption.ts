import { EXTRACTED_REQUIREMENTS_DRAWN, extractedRequirementPage } from '@bidstack/shared';

export { EXTRACTED_REQUIREMENTS_DRAWN, extractedRequirementPage };

/**
 * Requirements the review list draws. The API drops the probe and sets
 * `requirementsContinue`. A response that still carries that row is paged
 * here so the probe is not shown.
 */
export function shownExtractedRequirements<T>(
  items: readonly T[],
  requirementsContinue: boolean | undefined,
): { items: T[]; pageContinues: boolean } {
  if (items.length > EXTRACTED_REQUIREMENTS_DRAWN) return extractedRequirementPage(items);
  return { items: [...items], pageContinues: Boolean(requirementsContinue) };
}

/**
 * Extracted-requirements caption. A longer loaded list is the latest
 * requirements, not every requirement on the deal. A shorter list keeps
 * "N requirement(s) extracted". No requirement total is invented.
 */
export function extractedRequirementCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${count} in the latest ${count}, not every requirement`;
  }
  return `${count} requirement(s) extracted`;
}
