// WHY: getEnv() and validateWorkerProductionEnv() can pass in a unit test
// while the process that operators start still boots. This starts both
// entrypoints with the opt-out and requires each one to exit.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tsx = path.join(root, 'node_modules/.bin/tsx');
const REFUSED = 'OAUTH_REFRESH_LOCK_REDIS_REQUIRED=false is refused when NODE_ENV=production';

const productionOptOut: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://bidstack:test@postgres:5432/bidstack',
  REDIS_URL: 'redis://:test@redis:6379',
  INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
  PII_FIELD_ENCRYPTION: 'true',
  PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'bidstack-prod-files',
  S3_REGION: 'us-east-1',
  BIDSTACK_JOB_SIGNING_SECRET: 'c'.repeat(64),
  BIDSTACK_TENANT_SCOPE_GUARD: 'enforce',
  PUBLIC_BASE_URL: 'https://crm.example.com',
  STORAGE_SCAN_REQUIRED: 'true',
  OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
};

function boot(entry: string): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [entry], {
      cwd: root,
      env: productionOptOut,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const keep = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 20_000) output = output.slice(-20_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out booting ${path.basename(path.dirname(entry))}`));
    }, 45_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (status) => {
      clearTimeout(timer);
      resolve({ status, output });
    });
  });
}

describe('production refuses the refresh-lock opt-out at process start', () => {
  it('the API process exits', async () => {
    const api = await boot(path.join(root, 'apps/api/src/main.ts'));
    expect(api.status).not.toBe(0);
    expect(api.output).toContain(REFUSED);
  }, 60_000);

  it('the worker process exits', async () => {
    const worker = await boot(path.join(root, 'apps/worker/src/main.ts'));
    expect(worker.status).not.toBe(0);
    expect(worker.output).toContain(REFUSED);
  }, 60_000);
});
