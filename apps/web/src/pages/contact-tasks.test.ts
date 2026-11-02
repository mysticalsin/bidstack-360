import { describe, expect, it } from 'vitest';

import { contactTaskCaption, contactTaskEmpty } from './contact-tasks';

describe('contact task page', () => {
  it('does not describe a short task page as every follow-up', () => {
    // WHY: the contact page counted the first 50 tasks as every related
    // follow-up. The route already drops the extra probe row. A shorter page
    // is the whole match and keeps the old sentence.
    expect(contactTaskCaption(2, true)).toBe(
      '2 related in the latest 50 tasks, not every task',
    );
    expect(contactTaskCaption(2, true)).not.toBe('2 related');
    expect(contactTaskEmpty(true)).toMatch(/not every task/i);
    expect(contactTaskEmpty(true)).not.toBe('No related tasks.');

    expect(contactTaskCaption(2, false)).toBe('2 related');
    expect(contactTaskCaption(0, false)).toBe('0 related');
    expect(contactTaskCaption(2, false)).not.toMatch(/not every/i);
    expect(contactTaskEmpty(false)).toBe('No related tasks.');
    expect(contactTaskEmpty(false)).not.toMatch(/not every/i);
  });
});
