// Workspace search opened a follow-up at /tasks?search=<title>. The tasks
// page does not read that query, so "Workshop with Logistec CISO" lands on
// the whole list. Two follow-ups can share a title. The id is the record,
// and the title is not an address.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { taskRecordHref } from './task-record-href.js';

const LOGISTEC = '00000000-0000-4000-8000-000000010002';

describe('workspace search follow-up href', () => {
  it('opens the follow-up record and never puts the title in the address', () => {
    // WHY: a title search is a contains match. The demo follow-up already
    // has an id. Opening that id is the record. A title, a path, or a blank
    // must not become a URL.
    expect(taskRecordHref(LOGISTEC)).toBe(`/tasks/${LOGISTEC}`);
    expect(taskRecordHref('Workshop with Logistec CISO')).toBeNull();
    expect(taskRecordHref('../admin')).toBeNull();
    expect(taskRecordHref('javascript:alert(1)')).toBeNull();
    expect(taskRecordHref('')).toBeNull();
    expect(taskRecordHref('   ')).toBeNull();
    expect(taskRecordHref(null)).toBeNull();
    expect(taskRecordHref(undefined)).toBeNull();
  });

  it('the search route uses that href for a task', () => {
    // WHY: the tasks page ignores ?search=, so a result that still builds
    // /tasks?search=<title> does not open the follow-up.
    const src = readFileSync(new URL('./search.ts', import.meta.url), 'utf8');
    expect(src).toContain('taskRecordHref(t.id)');
    expect(src).not.toContain('/tasks?search=');
  });
});
