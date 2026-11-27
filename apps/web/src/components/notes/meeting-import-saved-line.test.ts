import { describe, expect, it } from 'vitest';

import {
  meetingImportRecordBadge,
  meetingImportSavedLine,
} from './meeting-import-saved-line';

const stackOnly = {
  contacts: 0,
  risks: 0,
  compliance: 0,
  tasks: 0,
  techStackItems: 6,
};

describe('meeting import saved line', () => {
  it('names the note when the only extra number is extracted tech-stack names', () => {
    expect(meetingImportSavedLine(stackOnly)).toBe('Note saved.');
    expect(meetingImportRecordBadge(stackOnly)).toBe('Note saved');
  });

  it('counts a contact and leaves the tech-stack names out of that count', () => {
    const created = { ...stackOnly, contacts: 1 };
    expect(meetingImportSavedLine(created)).toBe('Note saved. 1 record created or refreshed.');
    expect(meetingImportRecordBadge(created)).toBe('1 record');
  });

  it('counts every created side record, still without the tech-stack names', () => {
    const created = { contacts: 1, risks: 1, compliance: 2, tasks: 1, techStackItems: 6 };
    expect(meetingImportSavedLine(created)).toBe('Note saved. 5 records created or refreshed.');
    expect(meetingImportRecordBadge(created)).toBe('5 records');
  });
});
