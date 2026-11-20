import { describe, expect, it } from 'vitest';

import { importFileHash } from './import-file-hash.js';

describe('import file hash', () => {
  it('treats key order as the same file and row order as a different file', () => {
    const left = importFileHash([{ name: 'Acme', city: 'Lyon' }]);
    const right = importFileHash([{ city: 'Lyon', name: 'Acme' }]);
    const reordered = importFileHash([
      { name: 'Beta', city: 'Lyon' },
      { name: 'Acme', city: 'Lyon' },
    ]);
    const original = importFileHash([
      { name: 'Acme', city: 'Lyon' },
      { name: 'Beta', city: 'Lyon' },
    ]);
    expect(left).toBe(right);
    expect(reordered).not.toBe(original);
  });
});
