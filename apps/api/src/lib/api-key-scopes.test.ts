import { describe, expect, it } from 'vitest';

import {
  allowLegacyRestApiKeyScopes,
  apiKeyScopeSatisfiesPermission,
  validateApiKeyScopes,
} from './api-key-scopes.js';

describe('API key scopes', () => {
  it('uses exact permission scopes in production by default', () => {
    const env = { NODE_ENV: 'production' };

    expect(apiKeyScopeSatisfiesPermission(['settings:write'], 'settings:write', env)).toBe(true);
    expect(apiKeyScopeSatisfiesPermission(['write'], 'settings:write', env)).toBe(false);
    expect(apiKeyScopeSatisfiesPermission(['read'], 'accounts:read', env)).toBe(false);
  });

  it('keeps legacy read/write fallback outside production for existing tests and dev keys', () => {
    const env = { NODE_ENV: 'test' };

    expect(apiKeyScopeSatisfiesPermission(['write'], 'settings:write', env)).toBe(true);
    expect(apiKeyScopeSatisfiesPermission(['read'], 'accounts:read', env)).toBe(true);
  });

  it('supports an explicit production compatibility escape hatch', () => {
    const env = {
      NODE_ENV: 'production',
      BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES: 'true',
    };

    expect(allowLegacyRestApiKeyScopes(env)).toBe(true);
    expect(apiKeyScopeSatisfiesPermission(['write'], 'settings:write', env)).toBe(true);
  });

  it('rejects broad non-MCP production keys during creation validation', () => {
    const env = { NODE_ENV: 'production' };

    expect(validateApiKeyScopes(['read'], env)).toEqual([
      'Production REST API keys must use exact permission scopes, not read.',
    ]);
    expect(validateApiKeyScopes(['accounts:read'], env)).toEqual([]);
  });

  it('allows MCP transport keys to retain tool-class read/write scopes', () => {
    const env = { NODE_ENV: 'production' };

    expect(validateApiKeyScopes(['mcp', 'read'], env)).toEqual([]);
    expect(apiKeyScopeSatisfiesPermission(['mcp', 'write'], 'settings:write', env)).toBe(false);
  });

  it('rejects unknown, duplicate, and unusable MCP scope sets', () => {
    const env = { NODE_ENV: 'production' };

    expect(validateApiKeyScopes(['mcp'], env)).toContain(
      'MCP keys must include read or write for tool access.',
    );
    expect(validateApiKeyScopes(['accounts:read', 'accounts:read'], env)).toContain(
      'Duplicate API key scope: accounts:read',
    );
    expect(validateApiKeyScopes(['everything:write'], env)).toContain(
      'Unknown API key scope: everything:write',
    );
  });
});
