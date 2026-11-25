// The import always saves the note. Contacts, risks, compliance, and tasks
// are the rows the server reports as created or refreshed. techStackItems is
// the count of extracted vendor names folded into one enrichment blob, so it
// is not a record count. Counting it made the synthetic six-product paste
// read as six records when none of those rows were created.

export interface MeetingImportCreatedCounts {
  contacts: number;
  risks: number;
  compliance: number;
  tasks: number;
  techStackItems: number;
}

export function meetingImportRecordCount(created: MeetingImportCreatedCounts): number {
  return created.contacts + created.risks + created.compliance + created.tasks;
}

export function meetingImportSavedLine(created: MeetingImportCreatedCounts): string {
  const records = meetingImportRecordCount(created);
  if (records === 0) return 'Note saved.';
  if (records === 1) return 'Note saved. 1 record created or refreshed.';
  return `Note saved. ${records} records created or refreshed.`;
}

export function meetingImportRecordBadge(created: MeetingImportCreatedCounts): string {
  const records = meetingImportRecordCount(created);
  if (records === 0) return 'Note saved';
  if (records === 1) return '1 record';
  return `${records} records`;
}
