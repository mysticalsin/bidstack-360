import { describe, expect, it } from 'vitest';

import { buildAllowedCorsOrigins, isLoopbackOrigin } from './cors-origins.js';

describe('cors origin allowlist', () => {
  it('allows localhost and 127.0.0.1 variants for shifted dev/preview ports', () => {
    const origins = buildAllowedCorsOrigins('http://localhost:5174', 'development');

    expect(origins).toContain('http://localhost:5174');
    expect(origins).toContain('http://127.0.0.1:5174');
    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://127.0.0.1:5173');
    expect(origins).toContain('http://[::1]:5173');
    expect(origins).toContain('http://localhost:4174');
  });

  it('does not add loopback origins in production', () => {
    const origins = buildAllowedCorsOrigins('https://crm.example.com', 'production');

    expect(origins).toEqual(['https://crm.example.com']);
    expect(isLoopbackOrigin('http://localhost:5173')).toBe(true);
    expect(isLoopbackOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isLoopbackOrigin('http://[::1]:5173')).toBe(true);
    expect(isLoopbackOrigin('https://crm.example.com')).toBe(false);
  });
});
