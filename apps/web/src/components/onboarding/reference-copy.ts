/**
 * Seller-facing onboarding copy for fixture rows.
 * Rows stay sample on the server (`isSample`, DELETE /api/onboarding/sample-data).
 * These sentences never call a row a sample, a demo, or live.
 * `sampleData.confirmClear` is the DESIGN.md 9.5 destructive warning and stays verbatim.
 */
export const ONBOARDING_SELLER_COPY = {
  'sampleData.banner': 'You are viewing reference records.',
  'sampleData.clear': 'Clear reference records',
  'sampleData.confirmClear': 'Delete all demonstration data? This action cannot be undone.',
  'templatePicker.subtitle':
    'Each template sets up a pipeline with stages and a handful of reference records so you can explore right away. You can remove the reference records any time.',
  'templatePicker.toastInstalledDescription':
    '{{stages}} stages, {{deals}} reference records, {{leads}} leads.',
  'templatePicker.toastConflictDescription':
    'Remove the existing reference records first, or start from the pipeline already in this workspace.',
  'sampleDataBanner.title': 'Reference',
  'sampleDataBanner.description':
    'Reference records are in this workspace. Hide this notice, or remove the reference records when you are ready to work from your own pipeline.',
  'sampleDataBanner.remove': 'Remove reference records',
  'sampleDataBanner.removedToast': 'Reference records removed',
  'sampleDataBanner.removeErrorToast': 'Could not remove reference records',
} as const;
