import { describe, expect, it } from 'vitest';

import { detectBusinessLines } from './business-lines.js';

describe('detectBusinessLines', () => {
  it('counts cybersecurity, cyber-security and cyber security as IT', () => {
    expect(detectBusinessLines('Cybersecurity Transformation')).toContain('it');
    expect(detectBusinessLines('Cyber-security programme')).toContain('it');
    expect(detectBusinessLines('Cyber security review')).toContain('it');
    expect(detectBusinessLines('HSBC Cyber, Discovery Response')).toContain('it');
  });

  it('keeps whole-word matching for short aliases like "it"', () => {
    expect(detectBusinessLines('IT managed services')).toContain('it');
    expect(detectBusinessLines('Digital storefront')).not.toContain('it');
    expect(detectBusinessLines('Working with the board')).not.toContain('it');
    expect(detectBusinessLines('Itinerary planning')).not.toContain('it');
  });
});
