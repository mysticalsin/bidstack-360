// Places the Railway binary next to @railway/cli's wrapper. npm ci is run
// with ignore-scripts, so the package postinstall must not download it.
// The archive is the release named in railway-binaries.json, and the
// sha256 has to match before anything is extracted.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(readFileSync(join(here, 'railway-binaries.json'), 'utf8'));
const key = `${process.platform}-${process.arch}`;
const target = pins.targets[key];
if (!target) {
  console.error(`no checksummed railway binary for ${key}`);
  process.exit(1);
}

const response = await fetch(target.url);
if (!response.ok) {
  console.error(`railway download failed: ${response.status}`);
  process.exit(1);
}
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== target.sha256) {
  console.error(`railway checksum mismatch for ${key}`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'railway-'));
const archive = join(dir, 'railway.tgz');
writeFileSync(archive, bytes);
const dest = join(here, 'node_modules/@railway/cli/bin');
const extracted = spawnSync('tar', ['-xzf', archive, '-C', dest], { encoding: 'utf8' });
rmSync(dir, { recursive: true, force: true });
if (extracted.status !== 0) {
  console.error(extracted.stderr || 'tar failed');
  process.exit(extracted.status ?? 1);
}
chmodSync(join(dest, process.platform === 'win32' ? 'railway.exe' : 'railway'), 0o755);
