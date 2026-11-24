import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const restoreScript = path.join(repoRoot, 'scripts/restore-postgres.sh');

describe('documented backup commands', () => {
  it('treats pnpm\'s -- as a separator so db:restore still refuses to guess the target', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'polo-restore-argv-'));
    const dump = path.join(dir, 'polo-synthetic.dump');
    writeFileSync(dump, 'not a postgres archive');
    const env = { ...process.env };
    delete env.POLO_RESTORE_DATABASE_URL;

    // WHY: the install guide's command is `pnpm db:restore -- <file>`. pnpm
    // forwards that `--` as argv. If the script treats `--` as the dump path,
    // the operator gets a usage line and never reaches the guard that refuses
    // to restore without an explicit POLO_RESTORE_DATABASE_URL.
    const result = spawnSync('bash', [restoreScript, '--', dump], {
      env,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('POLO_RESTORE_DATABASE_URL is required');
    expect(result.stderr).not.toContain('Usage:');
  });

  it('keeps the default backup directory out of git', () => {
    // WHY: `pnpm db:backup` writes a custom-format dump of the database under
    // ./var/backups. That file holds tenant rows. It must stay untracked so
    // `git add` of the worktree cannot commit it.
    const result = spawnSync(
      'git',
      ['check-ignore', '-q', '--', 'var/backups/polo-example.dump'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
  });
});
