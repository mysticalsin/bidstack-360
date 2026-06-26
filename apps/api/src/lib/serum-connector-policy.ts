import {
  SERUM_RUNTIME_CONFIG_KEYS,
  checkSerumConnectorRuntimePolicy,
  recordSerumConnectorConnectionTest,
} from '@bidstack/db/serum-runtime-policy';
import type { SerumConfigEnvironment, SerumRuntimeDecision } from '@bidstack/shared';

export class SerumConnectorPolicyError extends Error {
  readonly statusCode = 403;
  readonly code = 'SERUM_CONNECTOR_POLICY_DENIED';
  readonly decision: SerumRuntimeDecision | null;

  constructor(message: string, decision: SerumRuntimeDecision | null = null) {
    super(message);
    this.name = 'SerumConnectorPolicyError';
    this.decision = decision;
  }
}

function defaultSerumConfigEnvironment(): SerumConfigEnvironment {
  const env = process.env.SERUM_CONFIG_ENVIRONMENT;
  if (env === 'staging' || env === 'production') return env;
  return 'dev';
}

export async function assertSerumConnectorAllowed(args: {
  orgId: string;
  connectorId: string;
  operation: string;
  writeRequested: boolean;
  connectionTestProbe?: boolean;
  approvalConfirmed?: boolean;
}): Promise<SerumRuntimeDecision> {
  let decision: SerumRuntimeDecision;
  try {
    decision = await checkSerumConnectorRuntimePolicy({
      orgId: args.orgId,
      environment: defaultSerumConfigEnvironment(),
      configKey: SERUM_RUNTIME_CONFIG_KEYS.connectors,
      connectorId: args.connectorId,
      operation: args.operation,
      writeRequested: args.writeRequested,
      connectionTestProbe: args.connectionTestProbe ?? false,
      approvalConfirmed: args.approvalConfirmed ?? false,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SerumConnectorPolicyError(
      `SERUM connector policy check failed for ${args.connectorId} ${args.operation}; connector execution is blocked: ${detail}`,
      null,
    );
  }

  if (!decision.allowed) {
    throw new SerumConnectorPolicyError(
      `SERUM connector policy denied ${args.connectorId} ${args.operation}: ${decision.reason}`,
      decision,
    );
  }

  return decision;
}

export async function recordSerumConnectorTestSuccess(args: {
  orgId: string;
  connectorId: string;
  operation: string;
  testedByUserId?: string | null;
  evidence?: Record<string, unknown>;
}): Promise<void> {
  await recordSerumConnectorConnectionTest({
    orgId: args.orgId,
    environment: defaultSerumConfigEnvironment(),
    connectorId: args.connectorId,
    operation: args.operation,
    testedByUserId: args.testedByUserId,
    evidence: args.evidence,
  });
}
