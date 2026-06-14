import { describe, expect, it } from 'vitest';

import { validateFieldValue } from './custom-field-validation.js';

const v = (type: string, value: unknown, options: string[] = []) =>
  validateFieldValue('f', type, options, value);

describe('validateFieldValue', () => {
  it('passes null/undefined through (required is enforced separately)', () => {
    expect(v('number', null)).toBeNull();
    expect(v('select', undefined, ['a'])).toBeUndefined();
  });

  it('coerces numeric strings and rejects non-numbers', () => {
    expect(v('number', '42')).toBe(42);
    expect(v('number', 42)).toBe(42);
    expect(() => v('number', 'not-a-number')).toThrow(/number/);
    expect(() => v('currency', {})).toThrow();
  });

  it('rejects a string in a number field with a 400 (the core integrity bug)', () => {
    try {
      v('number', 'twelve');
      throw new Error('expected validateFieldValue to throw');
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(400);
    }
  });

  it('validates select against its options', () => {
    expect(v('select', 'open', ['open', 'closed'])).toBe('open');
    expect(() => v('select', 'pending', ['open', 'closed'])).toThrow(/one of/);
  });

  it('validates multi_select members', () => {
    expect(v('multi_select', ['a', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(() => v('multi_select', ['a', 'z'], ['a', 'b'])).toThrow();
    expect(() => v('multi_select', 'a', ['a'])).toThrow(/array/);
  });

  it('validates email / url / date / boolean', () => {
    expect(v('email', 'x@y.com')).toBe('x@y.com');
    expect(() => v('email', 'nope')).toThrow();
    expect(v('url', 'https://x.com')).toBe('https://x.com');
    expect(() => v('url', 'ftp://x.com')).toThrow(/http/);
    expect(v('date', '2026-01-01')).toBe('2026-01-01');
    expect(() => v('date', 'last tuesday')).toThrow();
    expect(v('boolean', 'true')).toBe(true);
    expect(() => v('boolean', 'maybe')).toThrow();
  });

  it('passes unknown field types through unchanged (forward-compatible)', () => {
    expect(v('future_type', { any: 'shape' })).toEqual({ any: 'shape' });
  });
});
