import { type GuardName, type Refusal } from './types.js';

const ERRORS: Record<GuardName, string> = {
  'stub-with-real-data':
    'Stub auth cannot boot with real data. Set POLO_DATA_MODE=demo for synthetic data, or configure CLERK_SECRET_KEY or CF_ACCESS_AUTH=true.',
  'stub-in-production': 'Stub auth cannot boot in production.',
  'preview-without-explicit-env':
    'Preview requires the explicit environment value POLO_DEPLOYMENT_ENV=preview.',
  'real-without-auth':
    'Real mode with no auth configured cannot boot. Configure CLERK_SECRET_KEY or CF_ACCESS_AUTH=true.',
  'demo-door-with-real-data': 'DEMO_MODE cannot run with real data.',
  'demo-door-with-clerk': 'DEMO_MODE cannot run with CLERK_SECRET_KEY set.',
  'demo-door-with-cf-access': 'DEMO_MODE cannot run with CF_ACCESS_AUTH=true.',
  'clerk-with-cf-access': 'CF_ACCESS_AUTH cannot run with CLERK_SECRET_KEY set.',
  'member-toggle': 'Only the owner or an admin can change demo data.',
  'api-key-toggle': 'Only the owner or an admin can change demo data.',
  'provider-not-approved': 'Not connected',
  'unknown-deployment':
    'Deployment environment is not explicit. Set POLO_DEPLOYMENT_ENV to local, preview, or production.',
  'local-claim-in-production':
    'POLO_DEPLOYMENT_ENV=local cannot boot when a production signal is set.',
  'demo-door-without-ack':
    'DEMO_MODE=true in production requires DEMO_PUBLIC_DEPLOYMENT_ACK=true',
};

export function refuse(guards: readonly GuardName[], extra?: Partial<Omit<Refusal, 'ok' | 'guard' | 'guards' | 'error'>>): Refusal {
  const unique: GuardName[] = [];
  for (const guard of guards) {
    if (!unique.includes(guard)) unique.push(guard);
  }
  const guard = unique[0];
  if (!guard) {
    throw new Error('A refusal needs a named guard.');
  }
  return {
    ok: false,
    guard,
    guards: unique,
    error: unique.map((name) => ERRORS[name]).join(' '),
    ...extra,
  };
}
