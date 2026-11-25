import { describe, expect, it } from 'vitest';

import { pipelineCardOwnerEmail } from './pipeline-card-owner';

describe('pipeline card owner email', () => {
  it('keeps the email on the bid and does not invent a name', () => {
    // WHY: demo OP-2041 is owned by alex.example@example.test. The board
    // must print that address. Turning the mailbox into "Alex Example"
    // would name a person the record does not have.
    expect(pipelineCardOwnerEmail('alex.example@example.test')).toBe('alex.example@example.test');
    expect(pipelineCardOwnerEmail('  alex.example@example.test  ')).toBe(
      'alex.example@example.test',
    );
  });

  it('treats a missing or blank owner as none', () => {
    // WHY: an empty owner is not a person. The card has to say so instead
    // of filling the gap with a guessed name.
    expect(pipelineCardOwnerEmail(null)).toBeNull();
    expect(pipelineCardOwnerEmail(undefined)).toBeNull();
    expect(pipelineCardOwnerEmail('')).toBeNull();
    expect(pipelineCardOwnerEmail('   ')).toBeNull();
  });
});
