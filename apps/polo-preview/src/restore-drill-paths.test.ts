// WHY: the restore drill runs on the host. restoreFrom, snapshotFile, and
// stageMigrationsWithoutIndex rmSync shared /tmp paths, so a file already at
// /tmp/restore is deleted. Issue #370: with POLO_RESTORE_DRILL=1 the drill
// uses its own temp directory and that file is still there afterwards.
// Without the flag, the container keeps /tmp/restore, /data, and /app.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const entrypoint = join(dirname(fileURLToPath(import.meta.url)), '../container/entrypoint.mjs');
const SHARED_RESTORE = '/tmp/restore';

function functionBody(source: string, name: string): string {
  const marker = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = marker.exec(source);
  if (!match) return '';
  const open = source.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  return '';
}

describe('restore drill temp paths', () => {
  const entry = readFileSync(entrypoint, 'utf8');

  it('does not delete the shared /tmp paths from the container entrypoint', () => {
    // WHY: a helper that the entrypoint never calls leaves rmSync('/tmp/restore') in place.
    const restore = functionBody(entry, 'restoreFrom');
    const snapshot = functionBody(entry, 'snapshotFile');
    const staging = functionBody(entry, 'stageMigrationsWithoutIndex');
    expect(restore).not.toContain("'/tmp/restore'");
    expect(snapshot).not.toContain("'/tmp/snapshot'");
    expect(staging).not.toContain("'/tmp/polo-migrate'");
    expect(entry).not.toContain("'-k', '/tmp'");
    expect(restore).toContain('RESTORE_DIR');
    expect(snapshot).toContain('SNAPSHOT_DIR');
    expect(snapshot).toContain('SNAPSHOT_TGZ');
    expect(staging).toContain('MIGRATE_STAGING');
    expect(entry).toContain("'-k', PG_SOCKET");
    expect(entry).toContain('resolveRestoreDrillPaths');
  });

  it('keeps the container paths when the drill flag is off', async () => {
    const { resolveRestoreDrillPaths } = await import('./restore-drill-paths.js');
    const paths = resolveRestoreDrillPaths({
      POLO_RESTORE_DRILL: '0',
      POLO_RESTORE_DIR: join(tmpdir(), 'should-be-ignored'),
      POLO_DATA_DIR: join(tmpdir(), 'should-be-ignored'),
      POLO_APP_ROOT: join(tmpdir(), 'should-be-ignored'),
    });
    // WHY: production must keep deleting only the container's own paths.
    expect(paths.restoreDir).toBe('/tmp/restore');
    expect(paths.snapshotDir).toBe('/tmp/snapshot');
    expect(paths.snapshotTgz).toBe('/tmp/snapshot.tgz');
    expect(paths.migrateStaging).toBe('/tmp/polo-migrate');
    expect(paths.pgSocket).toBe('/tmp');
    expect(paths.data).toBe('/data');
    expect(paths.app).toBe('/app');
  });

  it('leaves a file already at /tmp/restore when the drill runs', async () => {
    const { resolveRestoreDrillPaths } = await import('./restore-drill-paths.js');
    const stamp = 'synthetic-restore-sentinel';
    const created = !existsSync(SHARED_RESTORE);
    if (created) writeFileSync(SHARED_RESTORE, stamp);
    const root = mkdtempSync(join(tmpdir(), 'polo-restore-drill-'));
    try {
      const paths = resolveRestoreDrillPaths({ POLO_RESTORE_DRILL: '1' }, { root });
      expect(resolve(paths.restoreDir)).not.toBe(resolve(SHARED_RESTORE));
      expect(paths.restoreDir.startsWith(resolve(root) + sep)).toBe(true);
      expect(resolve(paths.snapshotDir)).not.toBe('/tmp/snapshot');
      expect(resolve(paths.snapshotTgz)).not.toBe('/tmp/snapshot.tgz');
      expect(resolve(paths.migrateStaging)).not.toBe('/tmp/polo-migrate');
      expect(resolve(paths.pgSocket)).not.toBe('/tmp');
      expect(resolve(paths.data)).not.toBe('/data');
      expect(paths.app).toBe('/app');
      // The entrypoint deletes these directories. The shared file is not one of them.
      rmSync(paths.restoreDir, { recursive: true, force: true });
      rmSync(paths.snapshotDir, { recursive: true, force: true });
      rmSync(paths.migrateStaging, { recursive: true, force: true });
      expect(existsSync(SHARED_RESTORE)).toBe(true);
      if (created) expect(readFileSync(SHARED_RESTORE, 'utf8')).toBe(stamp);
    } finally {
      if (created) rmSync(SHARED_RESTORE, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('honors a drill override that stays under the temp directory', async () => {
    const { resolveRestoreDrillPaths } = await import('./restore-drill-paths.js');
    const root = mkdtempSync(join(tmpdir(), 'polo-restore-drill-'));
    const restore = join(root, 'custom-restore');
    try {
      const paths = resolveRestoreDrillPaths({
        POLO_RESTORE_DRILL: '1',
        POLO_APP_ROOT: '/app',
        POLO_DATA_DIR: join(root, 'data'),
        POLO_PG_SOCKET: join(root, 'pg-socket'),
        POLO_MIGRATE_STAGING: join(root, 'polo-migrate'),
        POLO_SNAPSHOT_DIR: join(root, 'snapshot'),
        POLO_SNAPSHOT_TGZ: join(root, 'snapshot.tgz'),
        POLO_RESTORE_DIR: restore,
      });
      // WHY: the drill may name its own directories. Those are the ones rmSync runs on.
      expect(paths.restoreDir).toBe(resolve(restore));
      expect(paths.data).toBe(resolve(join(root, 'data')));
      expect(paths.app).toBe('/app');
      expect(resolve(paths.restoreDir)).not.toBe(resolve(SHARED_RESTORE));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a drill path that is not under the temp directory', async () => {
    const { resolveRestoreDrillPaths } = await import('./restore-drill-paths.js');
    const root = mkdtempSync(join(tmpdir(), 'polo-restore-drill-'));
    try {
      expect(() =>
        resolveRestoreDrillPaths({ POLO_RESTORE_DRILL: '1', POLO_DATA_DIR: '/data' }, { root }),
      ).toThrow(/POLO_DATA_DIR must be a subdirectory of the temp directory/);
      expect(() =>
        resolveRestoreDrillPaths({ POLO_RESTORE_DRILL: '1', POLO_PG_SOCKET: '/tmp' }, { root }),
      ).toThrow(/POLO_PG_SOCKET is too broad/);
      expect(() =>
        resolveRestoreDrillPaths({ POLO_RESTORE_DRILL: '1', POLO_RESTORE_DIR: '/etc/restore' }, { root }),
      ).toThrow(/POLO_RESTORE_DIR must be a subdirectory of the temp directory/);
      const outside = resolveRestoreDrillPaths(
        { POLO_RESTORE_DRILL: '1', POLO_APP_ROOT: '/app' },
        { root },
      );
      // WHY: the app tree is the image, not a scratch directory the drill deletes.
      expect(outside.app).toBe('/app');
      expect(outside.restoreDir.startsWith(resolve(root) + sep)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
