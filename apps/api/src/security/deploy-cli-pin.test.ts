import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// WHY: an unpinned railway, vercel, or wrangler fetches whatever the
// registry calls latest, then runs with a production token. A split
// `spawnSync('npx', ['vercel'])` is the same fetch as `npx vercel`.
// The Railway package's own postinstall downloads a GitHub binary that
// is not covered by the lockfile, so the install must ignore scripts
// and check a checksum for that binary instead.

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const TOOL = String.raw`(?:railway|vercel|wrangler|@railway\/cli)`;
const TOOL_RE = new RegExp(`^(?:${TOOL})(?:@|$)`);

export function unpinnedDeployCli(source: string): string[] {
  const hits: string[] = [];
  const npxInline = new RegExp(
    String.raw`\bnpx(?:\s+(?:-[A-Za-z]|--[A-Za-z-]+))*\s+['"\`]?(${TOOL})\b`,
    'g',
  );
  for (const match of source.matchAll(npxInline)) hits.push(`npx ${match[1]}`);

  const split = /(?:spawn(?:Sync)?|execFile(?:Sync)?|execa|exec(?:Sync)?)\(\s*['"]npx['"]\s*,\s*\[([\s\S]*?)\]/g;
  for (const match of source.matchAll(split)) {
    const args = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((part) => part[1]);
    if (args.some((arg) => TOOL_RE.test(arg))) hits.push(`npx argv ${args.find((arg) => TOOL_RE.test(arg))}`);
  }

  const bareSpawn =
    /(?:spawn(?:Sync)?|execFile(?:Sync)?|execa)\(\s*['"](railway|vercel|wrangler)['"]/g;
  for (const match of source.matchAll(bareSpawn)) hits.push(`spawn ${match[1]}`);

  const bareExec = /\bexec(?:Sync)?\(\s*(['"`])(railway|vercel|wrangler)\b/g;
  for (const match of source.matchAll(bareExec)) hits.push(`exec ${match[2]}`);

  const shell = /(?:^|\n)\s*(?:run:\s*)?(railway|vercel|wrangler)\b(?!\s*\()/g;
  for (const match of source.matchAll(shell)) hits.push(`shell ${match[1]}`);

  return hits;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'package-lock.json') continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.(mjs|cjs|js|ts|sh|yml|yaml)$/.test(name)) out.push(path);
  }
  return out;
}

describe('deploy CLIs are pinned', () => {
  it('flags split npx argv, exec, execa, and a bare PATH command', () => {
    const flagged = [
      "spawnSync('npx', ['vercel', 'env', 'pull'])",
      'execa("npx", ["--yes", "wrangler", "deploy"])',
      "exec('npx railway up')",
      'execSync(`npx -y vercel deploy`)',
      "spawn('vercel', ['deploy'])",
      'run: railway up --service api',
    ];
    const allowed = [
      "spawnSync(pinnedDeployCli('vercel'), args)",
      "spawnSync(vercel, ['deploy', '--prod', '--yes'])",
      './deploy/cli/node_modules/.bin/railway up --service api',
      'npx web-push generate-vapid-keys',
      "spawnSync('node', ['scripts/gen-prod-secrets.mjs'])",
      "railway(['link', '--project', PROJECT])",
    ];
    for (const sample of flagged) expect(unpinnedDeployCli(sample), sample).not.toEqual([]);
    for (const sample of allowed) expect(unpinnedDeployCli(sample), sample).toEqual([]);
  });

  it('workflows and deploy scripts do not fetch an unpinned CLI', () => {
    const roots = [join(repo, 'scripts'), join(repo, '.github'), join(repo, 'deploy')];
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const found = unpinnedDeployCli(readFileSync(file, 'utf8'));
        if (found.length > 0) hits.push(`${file.slice(repo.length + 1)}: ${found.join(', ')}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('locks railway and vercel to exact versions with integrity hashes', () => {
    const pkg = JSON.parse(readFileSync(join(repo, 'deploy/cli/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const name of ['@railway/cli', 'vercel']) {
      expect(pkg.dependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const parsed = JSON.parse(
      readFileSync(join(repo, 'deploy/cli/package-lock.json'), 'utf8'),
    ) as { packages: Record<string, { version?: string; integrity?: string }> };
    for (const name of ['node_modules/@railway/cli', 'node_modules/vercel']) {
      expect(parsed.packages[name]?.version).toBe(pkg.dependencies[name.replace('node_modules/', '')]);
      expect(parsed.packages[name]?.integrity).toMatch(/^sha512-/);
    }
  });

  it('does not install the versions Trivy flagged, or an unused wrangler', () => {
    // WHY: the pin is a separate npm tree. Bumping the CLI versions does
    // not move these transitives, and code scanning fails on the lockfile.
    // wrangler is not invoked by any workflow or script, so it is not a
    // dependency of this install.
    const pkg = JSON.parse(readFileSync(join(repo, 'deploy/cli/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      overrides?: Record<string, string>;
    };
    expect(pkg.dependencies.wrangler).toBeUndefined();
    expect(pkg.overrides).toMatchObject({
      'js-yaml': '4.3.2',
      tar: '7.5.23',
      'undici@5': '6.29.1',
      minimatch: '11.0.1',
      'path-to-regexp@6': '6.3.0',
      'path-to-regexp@8': '8.4.0',
      '@fastify/busboy': '3.2.2',
      'smol-toml': '1.9.0',
      glob: '14.0.2',
      ajv: '8.18.0',
      zod: '4.6.7',
    });
    const parsed = JSON.parse(readFileSync(join(repo, 'deploy/cli/package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    const banned = new Map<string, Set<string>>([
      ['js-yaml', new Set(['4.1.1'])],
      ['tar', new Set(['6.2.1', '7.5.11'])],
      ['undici', new Set(['5.28.4', '5.29.0'])],
      ['minimatch', new Set(['10.1.1', '10.2.6'])],
      ['path-to-regexp', new Set(['6.1.0', '8.3.0'])],
      ['@fastify/busboy', new Set(['2.1.1'])],
      ['smol-toml', new Set(['1.5.2'])],
      ['glob', new Set(['13.0.7'])],
      ['ajv', new Set(['8.6.3'])],
    ]);
    for (const [path, entry] of Object.entries(parsed.packages)) {
      const name = path.split('node_modules/').pop() ?? '';
      expect(name).not.toBe('wrangler');
      const versions = banned.get(name);
      if (versions?.has(entry.version ?? '')) {
        throw new Error(`${name}@${entry.version} is still in the deploy lockfile`);
      }
    }
  });

  it('ignores install scripts and checksums the Railway binary instead of running its postinstall', () => {
    // WHY: @railway/cli postinstall downloads a release from GitHub. That
    // bytes are not in the lockfile. Ignoring scripts closes the fetch.
    // The binary we actually run is a release asset with a sha256.
    const npmrc = readFileSync(join(repo, 'deploy/cli/.npmrc'), 'utf8');
    expect(npmrc).toMatch(/^ignore-scripts=true$/m);
    const workflow = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8');
    expect(workflow).toMatch(/npm ci --ignore-scripts/);
    expect(workflow).not.toMatch(/postinstall\.js/);
    const pins = JSON.parse(readFileSync(join(repo, 'deploy/cli/railway-binaries.json'), 'utf8')) as {
      version: string;
      targets: Record<string, { url: string; sha256: string }>;
    };
    const pkg = JSON.parse(readFileSync(join(repo, 'deploy/cli/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pins.version).toBe(pkg.dependencies['@railway/cli']);
    expect(pins.targets['linux-x64']?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pins.targets['linux-x64']?.url).toContain(`v${pins.version}/`);
    const installer = readFileSync(join(repo, 'deploy/cli/install-railway.mjs'), 'utf8');
    expect(installer).toContain('sha256');
    expect(installer).not.toContain('postinstall.js');
  });
});
