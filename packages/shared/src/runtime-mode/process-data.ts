import type { DataMode, RuntimeEnv } from './types.js';

/** Unset, blank, and every value other than the exact string "demo" are real. */
export function resolveProcessData(env: RuntimeEnv): DataMode {
  return env.POLO_DATA_MODE === 'demo' ? 'demo' : 'real';
}
