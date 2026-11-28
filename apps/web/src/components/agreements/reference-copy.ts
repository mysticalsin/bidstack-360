/**
 * Customer-facing copy for agreements that are not stored in this workspace.
 * The client still returns `sample: true` for that fallback. These strings
 * never call it a sample, a demo, or a service that is not live.
 */

export const AGREEMENT_REFERENCE_BADGE = 'Reference';

export const AGREEMENT_UPLOAD_OFF =
  'Uploads stay off for reference records. They turn on for agreements stored in this workspace.';

export const AGREEMENT_FILE_EMPTY = 'No file is stored for this reference record.';

export const AGREEMENT_LIBRARY_EMPTY_TITLE = 'No agreements on file';

export const AGREEMENT_LIBRARY_EMPTY =
  'Add an agreement when a signed MSA, framework, SOW, or amendment is ready.';

export function agreementReferenceNote(what: string): string {
  if (what === 'details') {
    return 'These details are reference records, not the agreement on file for this workspace.';
  }
  return 'These rows are reference records, not agreements on file for this workspace.';
}
