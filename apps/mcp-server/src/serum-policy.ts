import {
  SERUM_RUNTIME_CONFIG_KEYS,
  checkSerumToolRuntimePolicy,
} from '@bidstack/db/serum-runtime-policy';

import type { McpAuthCtx } from './auth.js';
import type { ToolName } from './tools/index.js';

function defaultSerumConfigEnvironment(): 'dev' | 'staging' | 'production' {
  const env = process.env.SERUM_CONFIG_ENVIRONMENT;
  if (env === 'staging' || env === 'production') return env;
  return 'dev';
}

export async function assertSerumAllowsMcpToolCall(
  ctx: McpAuthCtx,
  toolName: ToolName,
): Promise<void> {
  const decision = await checkSerumToolRuntimePolicy({
    orgId: ctx.orgId,
    environment: defaultSerumConfigEnvironment(),
    configKey: SERUM_RUNTIME_CONFIG_KEYS.tools,
    toolName,
    dryRun: true,
  });
  if (!decision.allowed) {
    throw new Error(`SERUM runtime denied tool "${toolName}": ${decision.reason}`);
  }
}
