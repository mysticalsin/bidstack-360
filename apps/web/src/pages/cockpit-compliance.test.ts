import { describe, expect, it } from 'vitest';

import { complianceCheckCaption } from './cockpit-compliance';

const WHOLE_REGISTER = 'No open items in the recorded register';

describe('compliance check caption', () => {
  it('does not describe a short compliance slice as every check', () => {
    // WHY: the cockpit shows six checks and the caption treated that page as
    // the recorded register. One check past the page means those rows are not
    // every check. A page that matches the loaded set keeps the old wording.
    expect(complianceCheckCaption(6, true, WHOLE_REGISTER)).toBe(
      '6 in the latest 6, not every check',
    );
    expect(complianceCheckCaption(6, true, WHOLE_REGISTER)).not.toBe(WHOLE_REGISTER);
    expect(complianceCheckCaption(6, true, '6 open items')).not.toBe('6 open items');
    expect(complianceCheckCaption(2, true, WHOLE_REGISTER)).toMatch(/not every check/i);
    expect(complianceCheckCaption(2, true, WHOLE_REGISTER)).not.toMatch(/recorded register/i);

    expect(complianceCheckCaption(6, false, WHOLE_REGISTER)).toBe(WHOLE_REGISTER);
    expect(complianceCheckCaption(2, false, '2 open items')).toBe('2 open items');
    expect(complianceCheckCaption(1, false, '1 open item')).toBe('1 open item');
    expect(complianceCheckCaption(2, false, WHOLE_REGISTER)).not.toMatch(/not every/i);
  });
});
