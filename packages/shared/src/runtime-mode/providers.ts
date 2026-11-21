import { refuse } from './guards.js';
import { NOT_CONNECTED, type ProviderId, type Refusal } from './types.js';

export type ProviderDecision =
  | { ok: true; providerId: ProviderId; status: 'approved'; enablePath: false }
  | (Refusal & { status: typeof NOT_CONNECTED; enablePath: false; providerId: ProviderId });

/**
 * Approval is an explicit flag that defaults to off.
 * The flag does not open a connection. There is no enable transition.
 */
export function connectProvider(providerId: ProviderId, approved: boolean | string | null | undefined): ProviderDecision {
  if (approved === true || approved === 'true') {
    return { ok: true, providerId, status: 'approved', enablePath: false };
  }
  return refuse(['provider-not-approved'], {
    status: NOT_CONNECTED,
    enablePath: false,
    providerId,
  }) as ProviderDecision;
}

/** Env form of the approval flag. Anything other than the exact string "true" is off. */
export function providerApprovalFromEnv(env: Record<string, string | undefined>, providerId: ProviderId): boolean {
  const key = `POLO_PROVIDER_${providerId.toUpperCase().replaceAll('-', '_')}_APPROVED`;
  return env[key] === 'true';
}
