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

  it('locks railway, vercel, and wrangler to exact versions with integrity hashes', () => {
    const pkg = JSON.parse(readFileSync(join(repo, 'deploy/cli/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const name of ['@railway/cli', 'vercel', 'wrangler']) {
      expect(pkg.dependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const parsed = JSON.parse(
      readFileSync(join(repo, 'deploy/cli/package-lock.json'), 'utf8'),
    ) as { packages: Record<string, { version?: string; integrity?: string }> };
    for (const name of ['node_modules/@railway/cli', 'node_modules/vercel', 'node_modules/wrangler']) {
      expect(parsed.packages[name]?.version).toBe(pkg.dependencies[name.replace('node_modules/', '')]);
      expect(parsed.packages[name]?.integrity).toMatch(/^sha512-/);
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
