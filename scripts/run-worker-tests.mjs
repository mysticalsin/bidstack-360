import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function findWorkspaceRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Could not find pnpm-workspace.yaml');
    current = parent;
  }
}

const rootDir = findWorkspaceRoot(process.cwd());
const workerDir = path.join(rootDir, 'apps', 'worker');

const env = { ...process.env, NODE_ENV: 'test' };

function findPnpmCjsFromPath() {
  if (process.platform !== 'win32') return undefined;
  const result = spawnSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return undefined;
  for (const pnpmCmd of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const candidate = path.join(path.dirname(pnpmCmd), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const pnpmExecPath =
  process.env.npm_execpath && path.basename(process.env.npm_execpath).toLowerCase().includes('pnpm')
    ? process.env.npm_execpath
    : undefined;
const pnpmCjsPath = findPnpmCjsFromPath() ?? pnpmExecPath;
const command = pnpmCjsPath ? process.execPath : 'pnpm';
const args = [
  ...(pnpmCjsPath ? [pnpmCjsPath] : []),
  'exec',
  'vitest',
  'run',
  '--passWithNoTests',
  '--pool=forks',
  '--no-file-parallelism',
  '--isolate=false',
  ...process.argv.slice(2),
];

const child = spawn(command, args, {
  cwd: workerDir,
  env,
  shell: false,
  stdio: 'inherit',
  windowsHide: true,
});

const exitCode = await new Promise((resolve) => {
  child.on('error', (error) => {
    console.error(error);
    resolve(1);
  });

  child.on('close', (code, signal) => {
    if (signal) {
      console.error(`Worker tests terminated by ${signal}`);
      resolve(1);
      return;
    }
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
