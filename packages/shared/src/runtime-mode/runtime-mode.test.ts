/**
 * Verifier-owned spec for Polo's runtime-mode state machine.
 *
 * These tests are the contract. They call the named transitions and check the
 * guards. They do not mock the machine, and they do not skip a case. A runner
 * timeout is an infrastructure error. A guard miss is a product failure.
 *
 * Tony, 2026-11-20:
 * - Members never see the Demo-data toggle. Owners and Admins only.
 * - Stub login is for local dev, and for the preview site only when the data
 *   is synthetic and the preview environment was set explicitly.
 * - Stub + real refuses. Stub in production refuses.
 * - External providers stay "Not connected" until an explicit approval flag
 *   that defaults to off. There is no enable path.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DEMO_DATA_TOGGLE_AUDIENCE,
  NOT_CONNECTED,
  PROVIDER_IDS,
  RUNTIME_TRANSITIONS,
  STUB_LOGIN_BANNER,
  actorMayToggle,
  transition,
  type RuntimeEnv,
  type SampleRow,
  type ToggleActor,
} from './index.js';

const BUDGET_MS = 4_000;

/** A runner timeout is infrastructure. It is not a missed guard. */
class InfrastructureTimeout extends Error {
  readonly classification = 'infrastructure' as const;

  constructor(message = 'timeout is an infrastructure error') {
    super(message);
    this.name = 'InfrastructureTimeout';
  }
}

function classifyFailure(error: unknown): 'infrastructure' | 'guard' {
  if (error instanceof InfrastructureTimeout) return 'infrastructure';
  if (!(error instanceof Error)) return 'guard';
  if (/Stub auth cannot boot|POLO_DEPLOYMENT_ENV=preview|Only the owner or an admin|Not connected/i.test(error.message)) {
    return 'guard';
  }
  if (/timed out|timeout/i.test(error.message)) return 'infrastructure';
  return 'guard';
}

function refusal(result: { ok: boolean }, guard: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const refused = result as { guard: string; guards: readonly string[]; error: string };
  expect(refused.guards).toContain(guard);
  expect(refused.guard).toBe(refused.guards[0]);
  expect(refused.error.length).toBeGreaterThan(0);
}

const ROWS: SampleRow[] = [
  { id: 'live', sample: false, source: 'edgar' },
  { id: 'sample', sample: true, source: 'edgar' },
  { id: 'fixture', sample: false, source: 'fixture' },
  { id: 'both', sample: true, source: 'fixture' },
];

describe('runtime-mode transitions', () => {
  it('names every guard transition and does not offer a provider enable path', () => {
    expect(RUNTIME_TRANSITIONS).toEqual([
      'resolve-process-data',
      'enter-preview',
      'resolve-deployment',
      'resolve-auth',
      'admit-stub',
      'boot',
      'apply-org-override',
      'toggle-demo-data',
      'hide-sample-rows',
      'connect-provider',
    ]);
    expect(RUNTIME_TRANSITIONS).not.toContain('enable-provider');
  });

  it('does not skip or xfail a guard', () => {
    const source = readFileSync(new URL(import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(?:it|test|describe)\.skip\b/);
    expect(source).not.toMatch(/\b(?:it|test|describe)\.todo\b/);
    expect(source).not.toMatch(/\bxfail\b/);
  });

  it('classifies a runner timeout as infrastructure, not a missed guard', () => {
    expect(classifyFailure(new InfrastructureTimeout())).toBe('infrastructure');
    expect(classifyFailure(new Error('Test timed out in 5000ms'))).toBe('infrastructure');
    expect(classifyFailure(new Error('Stub auth cannot boot with real data'))).toBe('guard');
  });
});

describe('process data', () => {
  it('treats an unset value as real', () => {
    const result = transition('resolve-process-data', { env: {} });
    expect(result).toEqual({ ok: true, processData: 'real' });
  });

  it('treats blank, padded, and non-demo strings as real', () => {
    for (const raw of ['', ' ', 'real', 'DEMO', 'demo ', 'other']) {
      const result = transition('resolve-process-data', { env: { POLO_DATA_MODE: raw } });
      expect(result).toEqual({ ok: true, processData: 'real' });
    }
  });

  it('treats only the exact string demo as demo', () => {
    const result = transition('resolve-process-data', { env: { POLO_DATA_MODE: 'demo' } });
    expect(result).toEqual({ ok: true, processData: 'demo' });
  });
});

describe('deployment environment', () => {
  it('refuses preview when the explicit env value is missing', () => {
    const result = transition('enter-preview', { env: {} });
    refusal(result, 'preview-without-explicit-env');
    if (!result.ok) expect(result.error).toMatch(/POLO_DEPLOYMENT_ENV=preview/);
  });

  it('refuses a preview claim that is only implied by the process', () => {
    const result = transition('resolve-deployment', {
      env: { NODE_ENV: 'production' },
      claimPreview: true,
    });
    refusal(result, 'preview-without-explicit-env');
  });

  it('refuses near-miss preview values instead of inferring preview', () => {
    for (const raw of ['Preview', ' preview', 'preview ', 'PREVIEW', 'pre-view']) {
      const entered = transition('enter-preview', { env: { POLO_DEPLOYMENT_ENV: raw } });
      refusal(entered, 'preview-without-explicit-env');
      const resolved = transition('resolve-deployment', { env: { POLO_DEPLOYMENT_ENV: raw, NODE_ENV: 'production' } });
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.guards).toContain('preview-without-explicit-env');
    }
  });

  it('accepts preview only from the exact env value', () => {
    const result = transition('enter-preview', { env: { POLO_DEPLOYMENT_ENV: 'preview' } });
    expect(result).toEqual({ ok: true, deployment: 'preview', explicitPreview: true });
  });

  it('maps an unset deployment to local only for development and test', () => {
    expect(transition('resolve-deployment', { env: { NODE_ENV: 'development' } })).toMatchObject({
      ok: true,
      deployment: 'local',
      explicitPreview: false,
    });
    expect(transition('resolve-deployment', { env: { NODE_ENV: 'test' } })).toMatchObject({
      ok: true,
      deployment: 'local',
      explicitPreview: false,
    });
  });

  it('maps an unset deployment to production when NODE_ENV is production', () => {
    expect(transition('resolve-deployment', { env: { NODE_ENV: 'production' } })).toMatchObject({
      ok: true,
      deployment: 'production',
      explicitPreview: false,
    });
  });

  it('does not infer local or preview when both values are missing', () => {
    const result = transition('resolve-deployment', { env: {} });
    refusal(result, 'unknown-deployment');
  });

  it('lets the explicit deployment value win over NODE_ENV', () => {
    expect(
      transition('resolve-deployment', { env: { POLO_DEPLOYMENT_ENV: 'local', NODE_ENV: 'production' } }),
    ).toMatchObject({ ok: true, deployment: 'local' });
    expect(
      transition('resolve-deployment', { env: { POLO_DEPLOYMENT_ENV: 'production', NODE_ENV: 'development' } }),
    ).toMatchObject({ ok: true, deployment: 'production' });
  });
});

describe('boot guards', () => {
  it('refuses stub auth with real data, including local dev', () => {
    const result = transition('boot', { env: { NODE_ENV: 'development' } });
    refusal(result, 'stub-with-real-data');
    if (!result.ok) {
      expect(result.error).toMatch(/Stub auth cannot boot with real data/);
      expect(result.guards).not.toContain('stub-in-production');
    }
  });

  it('refuses stub auth in production even when the data is synthetic', () => {
    const result = transition('boot', {
      env: { NODE_ENV: 'production', POLO_DATA_MODE: 'demo' },
    });
    refusal(result, 'stub-in-production');
    if (!result.ok) {
      expect(result.error).toMatch(/Stub auth cannot boot in production/);
      expect(result.guards).not.toContain('stub-with-real-data');
    }
  });

  it('names both refusals when production would otherwise stub real data', () => {
    const result = transition('boot', { env: { NODE_ENV: 'production' } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.guards).toEqual(
        expect.arrayContaining(['stub-with-real-data', 'stub-in-production', 'real-without-auth']),
      );
      expect(result.error).toMatch(/Stub auth cannot boot with real data/);
      expect(result.error).toMatch(/Stub auth cannot boot in production/);
      expect(result.error).toMatch(/no auth configured/);
    }
  });

  it('allows stub auth for local synthetic data and asks the web to say so', () => {
    const result = transition('boot', {
      env: { NODE_ENV: 'development', POLO_DATA_MODE: 'demo' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toMatchObject({
        processData: 'demo',
        effectiveData: 'real',
        auth: 'stub',
        deployment: 'local',
        publicDemoDoor: false,
        stubBanner: STUB_LOGIN_BANNER,
      });
    }
  });

  it('allows stub auth on preview only when the data is synthetic and the env is explicit', () => {
    const result = transition('boot', {
      env: { POLO_DEPLOYMENT_ENV: 'preview', POLO_DATA_MODE: 'demo', NODE_ENV: 'production' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode.auth).toBe('stub');
      expect(result.mode.deployment).toBe('preview');
      expect(result.mode.stubBanner).toBe(STUB_LOGIN_BANNER);
    }
  });

  it('refuses stub on preview when the data is real', () => {
    const result = transition('boot', {
      env: { POLO_DEPLOYMENT_ENV: 'preview', NODE_ENV: 'production' },
    });
    refusal(result, 'stub-with-real-data');
  });

  it('refuses to boot real data when no auth provider is configured', () => {
    const result = transition('boot', {
      env: { POLO_DEPLOYMENT_ENV: 'production', POLO_DATA_MODE: 'real' },
    });
    refusal(result, 'real-without-auth');
    if (!result.ok) expect(result.error).toMatch(/no auth configured/);
  });

  it('boots real data with Clerk or Cloudflare Access', () => {
    const clerk = transition('boot', {
      env: { NODE_ENV: 'production', CLERK_SECRET_KEY: 'sk_live' },
    });
    expect(clerk.ok).toBe(true);
    if (clerk.ok) {
      expect(clerk.mode.auth).toBe('clerk');
      expect(clerk.mode.stubBanner).toBeNull();
      expect(clerk.mode.processData).toBe('real');
    }

    const access = transition('boot', {
      env: { NODE_ENV: 'production', CF_ACCESS_AUTH: 'true' },
    });
    expect(access.ok).toBe(true);
    if (access.ok) expect(access.mode.auth).toBe('cf-access');
  });

  it('keeps the public demo door out of the auth enum and out of the stub banner', () => {
    // The door is not stub, Clerk, or Cloudflare Access. auth is null so the
    // web cannot treat it as the test login.
    const result = transition('boot', {
      env: { NODE_ENV: 'development', POLO_DATA_MODE: 'demo', DEMO_MODE: 'true' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode.publicDemoDoor).toBe(true);
      expect(result.mode.auth).toBeNull();
      expect(result.mode.stubBanner).toBeNull();
    }
  });

  it('refuses the public demo door with real data, Clerk, or Cloudflare Access', () => {
    const real = transition('boot', {
      env: { NODE_ENV: 'development', DEMO_MODE: 'true' },
    });
    refusal(real, 'demo-door-with-real-data');

    const clerk = transition('boot', {
      env: { NODE_ENV: 'development', POLO_DATA_MODE: 'demo', DEMO_MODE: 'true', CLERK_SECRET_KEY: 'sk' },
    });
    refusal(clerk, 'demo-door-with-clerk');

    const access = transition('boot', {
      env: {
        NODE_ENV: 'development',
        POLO_DATA_MODE: 'demo',
        DEMO_MODE: 'true',
        CF_ACCESS_AUTH: 'true',
      },
    });
    refusal(access, 'demo-door-with-cf-access');
  });

  it('refuses Clerk and Cloudflare Access together', () => {
    const result = transition('boot', {
      env: { NODE_ENV: 'production', CLERK_SECRET_KEY: 'sk', CF_ACCESS_AUTH: 'true' },
    });
    refusal(result, 'clerk-with-cf-access');
  });
});

describe('org demo-data toggle', () => {
  it('keeps members and API keys out of the audience', () => {
    expect(DEMO_DATA_TOGGLE_AUDIENCE).toEqual(['owner', 'admin']);
    expect(actorMayToggle('member')).toBe(false);
    expect(actorMayToggle('api-key')).toBe(false);
    expect(actorMayToggle('owner')).toBe(true);
    expect(actorMayToggle('admin')).toBe(true);
  });

  it('refuses a member toggle and does not change the stored rows', () => {
    const result = transition('toggle-demo-data', {
      actor: 'member',
      orgDemoData: false,
      next: true,
      rows: ROWS,
    });
    refusal(result, 'member-toggle');
    if (!result.ok) {
      expect(result.error).toMatch(/Only the owner or an admin/);
      expect(result.stored).toEqual(ROWS);
      expect(result.deleted).toBe(false);
      expect(result.visible).toEqual([]);
    }
  });

  it('refuses an API key toggle', () => {
    const result = transition('toggle-demo-data', {
      actor: 'api-key',
      orgDemoData: true,
      next: false,
      rows: ROWS,
    });
    refusal(result, 'api-key-toggle');
    if (!result.ok) expect(result.stored).toEqual(ROWS);
  });

  it('lets an owner turn demo off without deleting sample or fixture rows', () => {
    const result = transition('toggle-demo-data', {
      actor: 'owner',
      orgDemoData: true,
      next: false,
      processData: 'demo',
      rows: ROWS,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted).toBe(false);
      expect(result.stored).toEqual(ROWS);
      expect(result.orgDemoData).toBe(false);
      expect(result.effectiveData).toBe('real');
      expect(result.visible.map((row) => row.id)).toEqual(['live']);
    }
  });

  it('lets an admin show the same stored rows again without reseeding', () => {
    const hidden = transition('toggle-demo-data', {
      actor: 'admin',
      orgDemoData: true,
      next: false,
      processData: 'demo',
      rows: ROWS,
    });
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    const shown = transition('toggle-demo-data', {
      actor: 'admin',
      orgDemoData: false,
      next: true,
      processData: 'demo',
      rows: hidden.stored,
    });
    expect(shown.ok).toBe(true);
    if (shown.ok) {
      expect(shown.stored).toEqual(ROWS);
      expect(shown.visible).toEqual(ROWS);
      expect(shown.deleted).toBe(false);
    }
  });

  it('does not let the org flag widen a real process into demo', () => {
    const result = transition('apply-org-override', { processData: 'real', orgDemoData: true });
    expect(result).toEqual({ ok: true, processData: 'real', effectiveData: 'real' });
  });

  it('keeps sample numbers hidden while the org flag is off', () => {
    expect(transition('apply-org-override', { processData: 'demo', orgDemoData: false })).toEqual({
      ok: true,
      processData: 'demo',
      effectiveData: 'real',
    });
    expect(transition('apply-org-override', { processData: 'demo', orgDemoData: null })).toEqual({
      ok: true,
      processData: 'demo',
      effectiveData: 'real',
    });
  });

  it('shows demo data only when the process and the org flag both allow it', () => {
    expect(transition('apply-org-override', { processData: 'demo', orgDemoData: true })).toEqual({
      ok: true,
      processData: 'demo',
      effectiveData: 'demo',
    });
  });

  it('hides sample and fixture rows from a real read and keeps the stored set', () => {
    const result = transition('hide-sample-rows', { effectiveData: 'real', rows: ROWS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted).toBe(false);
      expect(result.stored).toEqual(ROWS);
      expect(result.visible.map((row) => row.id)).toEqual(['live']);
    }
  });

  it('returns every stored row when the effective mode is demo', () => {
    const result = transition('hide-sample-rows', { effectiveData: 'demo', rows: ROWS });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.visible).toEqual(ROWS);
  });
});

describe('external providers', () => {
  it('stays Not connected for every provider when the approval flag is off or missing', () => {
    for (const providerId of PROVIDER_IDS) {
      for (const approved of [undefined, false, null, 'false', 'yes', 'TRUE', '1', '']) {
        const result = transition('connect-provider', { providerId, approved });
        refusal(result, 'provider-not-approved');
        if (!result.ok) {
          expect(result.status).toBe(NOT_CONNECTED);
          expect(result.enablePath).toBe(false);
          expect(result.providerId).toBe(providerId);
        }
      }
    }
  });

  it('accepts an explicit approval without adding an enable path', () => {
    for (const approved of [true, 'true']) {
      const result = transition('connect-provider', { providerId: 'sec-edgar', approved });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.enablePath).toBe(false);
        expect(result.status).toBe('approved');
        expect(result.providerId).toBe('sec-edgar');
      }
    }
  });
});

describe('boundary grid', () => {
  it('holds the mode invariants for every env boundary', () => {
    const started = Date.now();
    const dataValues = [undefined, '', ' ', 'demo', 'DEMO', 'real', 'other'] as const;
    const deployValues = [undefined, '', 'local', 'preview', 'production', 'Preview', ' preview'] as const;
    const nodeValues = [undefined, 'development', 'test', 'production', 'staging'] as const;
    const clerkValues = [undefined, '', 'sk_test'] as const;
    const accessValues = [undefined, 'false', 'true'] as const;
    const doorValues = [undefined, 'false', 'true'] as const;
    const actors: ToggleActor[] = ['owner', 'admin', 'member', 'api-key'];

    try {
      for (const data of dataValues) {
        for (const deploy of deployValues) {
          for (const node of nodeValues) {
            for (const clerk of clerkValues) {
              for (const access of accessValues) {
                for (const door of doorValues) {
                  if (Date.now() - started > BUDGET_MS) throw new InfrastructureTimeout();
                  const env: RuntimeEnv = {};
                  if (data !== undefined) env.POLO_DATA_MODE = data;
                  if (deploy !== undefined) env.POLO_DEPLOYMENT_ENV = deploy;
                  if (node !== undefined) env.NODE_ENV = node;
                  if (clerk !== undefined) env.CLERK_SECRET_KEY = clerk;
                  if (access !== undefined) env.CF_ACCESS_AUTH = access;
                  if (door !== undefined) env.DEMO_MODE = door;

                  const preview = transition('enter-preview', { env });
                  expect(preview.ok).toBe(env.POLO_DEPLOYMENT_ENV === 'preview');

                  const deployment = transition('resolve-deployment', { env });
                  if (deployment.ok && deployment.deployment === 'preview') {
                    expect(env.POLO_DEPLOYMENT_ENV).toBe('preview');
                  }

                  const boot = transition('boot', { env });
                  if (boot.ok && boot.mode.auth === 'stub') {
                    expect(boot.mode.processData).toBe('demo');
                    expect(boot.mode.deployment).not.toBe('production');
                    expect(boot.mode.publicDemoDoor).toBe(false);
                    expect(boot.mode.stubBanner).toBe(STUB_LOGIN_BANNER);
                    if (boot.mode.deployment === 'preview') {
                      expect(env.POLO_DEPLOYMENT_ENV).toBe('preview');
                    }
                  }
                  if (boot.ok && boot.mode.publicDemoDoor) {
                    expect(boot.mode.auth).toBeNull();
                    expect(boot.mode.stubBanner).toBeNull();
                    expect(boot.mode.processData).toBe('demo');
                  }
                  if (boot.ok && boot.mode.processData === 'real') {
                    expect(['clerk', 'cf-access']).toContain(boot.mode.auth);
                    expect(boot.mode.effectiveData).toBe('real');
                  }
                  if (boot.ok) {
                    expect(boot.mode.effectiveData).toBe('real');
                  }

                  const processData = transition('resolve-process-data', { env });
                  expect(processData.ok).toBe(true);
                  if (!processData.ok) continue;
                  for (const flag of [null, false, true] as const) {
                    const applied = transition('apply-org-override', {
                      processData: processData.processData,
                      orgDemoData: flag,
                    });
                    expect(applied.ok).toBe(true);
                    if (!applied.ok) continue;
                    if (applied.effectiveData === 'demo') {
                      expect(processData.processData).toBe('demo');
                      expect(flag).toBe(true);
                    }
                  }
                }
              }
            }
          }
        }
      }

      for (const actor of actors) {
        const toggled = transition('toggle-demo-data', {
          actor,
          orgDemoData: false,
          next: true,
          processData: 'demo',
          rows: ROWS,
        });
        expect(toggled.ok).toBe(actorMayToggle(actor));
        if (!toggled.ok) {
          expect(toggled.deleted).toBe(false);
          expect(toggled.stored).toEqual(ROWS);
        }
      }

      for (const providerId of PROVIDER_IDS) {
        const blocked = transition('connect-provider', { providerId });
        expect(blocked.ok).toBe(false);
        if (!blocked.ok) {
          expect(blocked.status).toBe(NOT_CONNECTED);
          expect(blocked.enablePath).toBe(false);
        }
      }
    } catch (error) {
      if (classifyFailure(error) === 'infrastructure') {
        throw new InfrastructureTimeout(error instanceof Error ? error.message : 'timeout is an infrastructure error');
      }
      throw error;
    }
  });
});
