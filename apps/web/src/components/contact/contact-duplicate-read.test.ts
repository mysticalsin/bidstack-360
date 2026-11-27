// A clean duplicate book is a count of zero clusters. That count is a lie
// until the scan payload arrives. Pending wins over a caller-supplied [].
import { describe, expect, it } from 'vitest';

import { contactDuplicateRead } from './contact-duplicate-read';

const ada = { id: 'ada', name: 'Ada Example' };

describe('contactDuplicateRead', () => {
  it('keeps a failed read failed even when the caller passes an empty list', () => {
    // WHY: a thrown scan is not a finished book. [] here is the caller's
    // stand-in for "nothing yet", not a payload that arrived empty.
    expect(contactDuplicateRead({ isError: true, isPending: false, clusters: [] }).phase).toBe(
      'failed',
    );
  });

  it('stays unread while the scan is pending, including a placeholder []', () => {
    // WHY: the dialog used to treat "no clusters" as a clean book. A pending
    // read has not scanned Ada Example, so [] must not become empty.
    expect(contactDuplicateRead({ isError: false, isPending: true, clusters: [] }).phase).toBe(
      'unread',
    );
    expect(contactDuplicateRead({ isError: false, isPending: true, clusters: null }).phase).toBe(
      'unread',
    );
  });

  it('stays unread when the payload is missing and the flags say idle', () => {
    // WHY: isLoading is false on a paused query, and a missing payload is
    // still not a clean book.
    expect(contactDuplicateRead({ isError: false, isPending: false, clusters: null }).phase).toBe(
      'unread',
    );
  });

  it('says empty only for a payload that arrived with zero clusters', () => {
    // WHY: a workspace with no twins is the clean book. Hiding that would
    // make a finished scan look like one that never ended.
    expect(contactDuplicateRead({ isError: false, isPending: false, clusters: [] }).phase).toBe(
      'empty',
    );
  });

  it('says ready when Ada Example is in an arrived cluster', () => {
    // WHY: a settled cluster is the scan. The empty phase stays reserved
    // for a payload that arrived with no rows.
    expect(
      contactDuplicateRead({ isError: false, isPending: false, clusters: [ada] }).phase,
    ).toBe('ready');
  });
});
