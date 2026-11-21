import type { RuntimeEnv } from './types.js';

/**
 * The container may pass an environment through.
 * It may not assign a data mode after reading that environment, and it may not write the org flag.
 * Preview is not inferred here. The caller must already have set POLO_DEPLOYMENT_ENV when it means preview.
 */
export function guardContainerEnv(incoming: RuntimeEnv, outgoing: RuntimeEnv): RuntimeEnv {
  if (outgoing.POLO_DATA_MODE !== incoming.POLO_DATA_MODE) {
    throw new Error(
      'The container must not assign POLO_DATA_MODE. Pass the environment through so an unset value stays real.',
    );
  }
  if (outgoing.POLO_ORG_DEMO_DATA !== undefined || outgoing.DEMO_DATA !== undefined) {
    throw new Error('The container must not write the org demo-data flag.');
  }
  return outgoing;
}
