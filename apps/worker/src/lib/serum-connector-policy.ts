import {
  SERUM_RUNTIME_CONFIG_KEYS,
  checkSerumConnectorRuntimePolicy,
} from '@bidstack/db/serum-runtime-policy';
import type { SerumConfigEnvironment } from '@bidstack/shared';

function defaultSerumConfigEnvironment(): SerumConfigEnvironment {
  const env = process.env.SERUM_CONFIG_ENVIRONMENT;
  if (env === 'staging' || env === 'production') return env;
  return 'dev';
}

export async function serumConnectorDenialMessage(args: {
  orgId: string;
  connectorId: string;
  operation: string;
  writeRequested: boolean;
  connectionTestProbe?: boolean;
  approvalConfirmed?: boolean;
}): Promise<string | null> {
  try {
    const decision = await checkSerumConnectorRuntimePolicy({
      orgId: args.orgId,
      environment: defaultSerumConfigEnvironment(),
      configKey: SERUM_RUNTIME_CONFIG_KEYS.connectors,
      connectorId: args.connectorId,
      operation: args.operation,
      writeRequested: args.writeRequested,
      connectionTestProbe: args.connectionTestProbe ?? false,
      approvalConfirmed: args.approvalConfirmed ?? false,
    });
    return decision.allowed
      ? null
      : `SERUM connector policy denied ${args.connectorId} ${args.operation}: ${decision.reason}`;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `SERUM connector policy check failed for ${args.connectorId} ${args.operation}; connector execution is blocked: ${detail}`;
  }
}

export async function assertSerumConnectorAllowed(args: {
  orgId: string;
  connectorId: string;
  operation: string;
  writeRequested: boolean;
  connectionTestProbe?: boolean;
  approvalConfirmed?: boolean;
}): Promise<void> {
  const denial = await serumConnectorDenialMessage(args);
  if (denial) throw new Error(denial);
}
