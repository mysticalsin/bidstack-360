import { describe, expect, it } from 'vitest';

import { requiredScopeForTool, tools } from './index.js';

describe('agreements_ingest MCP tool', () => {
  it('is a write tool', () => {
    expect(requiredScopeForTool('agreements_ingest')).toBe('write');
  });

  it('accepts base64 or url files and rejects anything else', () => {
    const input = tools.agreements_ingest.input;
    const base = { externalSource: 'clm.test', externalId: 'doc-1', fileName: 'msa.pdf' };
    expect(input.safeParse({ ...base, file: { base64: 'JVBERi0xLjc=' } }).success).toBe(true);
    expect(input.safeParse({ ...base, file: { url: 'https://files.example.com/msa.pdf' } }).success).toBe(true);
    expect(input.safeParse({ ...base, file: { path: '/etc/passwd' } }).success).toBe(false);
    expect(input.safeParse({ ...base, externalSource: 'Bad Source', file: { base64: 'JVBERi0xLjc=' } }).success).toBe(false);
    expect(input.safeParse({ ...base, file: { base64: 'JVBERi0xLjc=' }, metadata: { unknown: 1 } }).success).toBe(false);
  });
});
