import { describe, expect, it } from 'vitest';

import { riskRegisterCaption } from './cockpit-risks';

const WHOLE_REGISTER = 'No open items in the recorded register';

describe('risk register caption', () => {
  it('does not describe a short risk slice as the whole register', () => {
    // WHY: the cockpit shows six risks and the caption treated that page as
    // the recorded register. One risk past the page means those rows are not
    // every risk. A page that matches the loaded set keeps the old wording.
    expect(riskRegisterCaption(6, true, WHOLE_REGISTER)).toBe('6 in the latest 6, not every risk');
    expect(riskRegisterCaption(6, true, WHOLE_REGISTER)).not.toBe(WHOLE_REGISTER);
    expect(riskRegisterCaption(6, true, '6 open items')).not.toBe('6 open items');
    expect(riskRegisterCaption(2, true, WHOLE_REGISTER)).toMatch(/not every risk/i);
    expect(riskRegisterCaption(2, true, WHOLE_REGISTER)).not.toMatch(/recorded register/i);

    expect(riskRegisterCaption(6, false, WHOLE_REGISTER)).toBe(WHOLE_REGISTER);
    expect(riskRegisterCaption(2, false, '2 open items')).toBe('2 open items');
    expect(riskRegisterCaption(1, false, '1 open item')).toBe('1 open item');
    expect(riskRegisterCaption(2, false, WHOLE_REGISTER)).not.toMatch(/not every/i);
  });
});
