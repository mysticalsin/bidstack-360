import { isPermissionKey, type PermissionKey } from '@bidstack/shared';

const LEGACY_REST_SCOPE_ENV = 'BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES';
const MCP_TRANSPORT_SCOPE = 'mcp';
const LEGACY_REST_SCOPES = new Set(['read', 'write']);

type Env = Record<string, string | undefined>;

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

export function allowLegacyRestApiKeyScopes(env: Env = process.env): boolean {
  const explicit = parseBoolean(env[LEGACY_REST_SCOPE_ENV]);
  if (explicit !== null) return explicit;
  return env.NODE_ENV !== 'production';
}

export function isApiKeyScope(value: string): boolean {
  return value === MCP_TRANSPORT_SCOPE || LEGACY_REST_SCOPES.has(value) || isPermissionKey(value);
}

export function apiKeyScopeSatisfiesPermission(
  scopes: readonly string[],
  permission: PermissionKey,
  env: Env = process.env,
): boolean {
  if (scopes.includes(permission)) return true;

  if (!allowLegacyRestApiKeyScopes(env)) {
    return false;
  }

  const legacyScope = permission.endsWith(':write') ? 'write' : 'read';
  return scopes.includes(legacyScope);
}

export function validateApiKeyScopes(scopes: readonly string[], env: Env = process.env): string[] {
  const failures: string[] = [];
  const seen = new Set<string>();
  const legacyRestAllowed = allowLegacyRestApiKeyScopes(env);

  for (const scope of scopes) {
    if (!isApiKeyScope(scope)) {
      failures.push(`Unknown API key scope: ${scope}`);
      continue;
    }

    if (seen.has(scope)) {
      failures.push(`Duplicate API key scope: ${scope}`);
    }
    seen.add(scope);
  }

  const hasMcp = seen.has(MCP_TRANSPORT_SCOPE);
  const hasMcpToolScope = seen.has('read') || seen.has('write');
  if (hasMcp && !hasMcpToolScope) {
    failures.push('MCP keys must include read or write for tool access.');
  }

  const broadRestScopes = [...seen].filter((scope) => LEGACY_REST_SCOPES.has(scope));
  if (!legacyRestAllowed && broadRestScopes.length > 0 && !hasMcp) {
    failures.push(
      `Production REST API keys must use exact permission scopes, not ${broadRestScopes.join(
        ', ',
      )}.`,
    );
  }

  return failures;
}
