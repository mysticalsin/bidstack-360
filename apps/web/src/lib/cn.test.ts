import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn utility', () => {
  it('combines class names correctly', () => {
    expect(cn('bg-red-500', 'text-white')).toBe('bg-red-500 text-white');
  });

  it('handles conditional class names from clsx', () => {
    const disabled = false;
    const enabled = true;

    expect(cn('bg-red-500', disabled && 'text-white', 'p-4')).toBe('bg-red-500 p-4');
    expect(cn('bg-red-500', enabled && 'text-white', 'p-4')).toBe(
      'bg-red-500 text-white p-4',
    );
  });

  it('merges tailwind classes cleanly using tailwind-merge', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('handles array and object syntax from clsx', () => {
    expect(cn(['bg-red-500', 'p-4'], { 'text-white': true, 'font-bold': false })).toBe(
      'bg-red-500 p-4 text-white',
    );
  });
});
