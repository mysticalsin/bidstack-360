import { describe, expect, it } from 'vitest';

import { leadRotDaysDraft } from './lead-rot-days';

describe('leadRotDaysDraft', () => {
  it('does not turn a cleared New field into 0', () => {
    // WHY: New is 7 when the org has no override. Number("") is 0, so a
    // cleared field used to save a fresh lead as already rotten.
    expect(leadRotDaysDraft('', 7)).toEqual({ ok: false, reason: 'empty' });
    expect(leadRotDaysDraft('   ', 7)).toEqual({ ok: false, reason: 'empty' });
  });

  it('does not clamp, floor, or accept a count the admin did not type', () => {
    // WHY: 400 was clamped to 365, 8.9 was floored to 8, and -1 became 0.
    expect(leadRotDaysDraft('400', 7)).toEqual({ ok: false, reason: 'invalid' });
    expect(leadRotDaysDraft('8.9', 7)).toEqual({ ok: false, reason: 'invalid' });
    expect(leadRotDaysDraft('-1', 7)).toEqual({ ok: false, reason: 'invalid' });
    expect(leadRotDaysDraft('abc', 7)).toEqual({ ok: false, reason: 'invalid' });
    expect(leadRotDaysDraft('366', 7)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('keeps 0 as a real count and a typed value that differs from the saved one', () => {
    // WHY: 0 is a threshold an admin can type. It must stay distinct from an
    // empty field. 365 is the top of the range the settings PUT already allows.
    expect(leadRotDaysDraft('0', 7)).toEqual({ ok: true, days: 0, changed: true });
    expect(leadRotDaysDraft('10', 7)).toEqual({ ok: true, days: 10, changed: true });
    expect(leadRotDaysDraft('7', 7)).toEqual({ ok: true, days: 7, changed: false });
    expect(leadRotDaysDraft(' 365 ', 14)).toEqual({ ok: true, days: 365, changed: true });
  });
});
