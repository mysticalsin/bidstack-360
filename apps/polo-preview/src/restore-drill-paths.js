// The restore drill runs on the host. The container's shared /tmp paths are
// fine inside the image, and a drill that rmSyncs them deletes a file that
// was already at /tmp/restore. With POLO_RESTORE_DRILL=1 every directory the
// drill deletes is under its own temp directory. Without that flag the
// container keeps the production paths, and host overrides are ignored.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const PRODUCTION = {
  app: '/app',
  data: '/data',
  pgSocket: '/tmp',
  migrateStaging: '/tmp/polo-migrate',
  snapshotDir: '/tmp/snapshot',
  snapshotTgz: '/tmp/snapshot.tgz',
  restoreDir: '/tmp/restore',
};

function absolutePath(name, raw) {
  if (String(raw).includes('\0')) throw new Error(`${name} is not a path`);
  const resolved = resolve(raw);
  if (resolved === '/') throw new Error(`${name} is too broad`);
  return resolved;
}

function underTemp(name, raw) {
  const resolved = absolutePath(name, raw);
  const temp = resolve(tmpdir());
  if (resolved === temp) throw new Error(`${name} is too broad`);
  if (!resolved.startsWith(`${temp}${sep}`)) {
    throw new Error(`${name} must be a subdirectory of the temp directory`);
  }
  return resolved;
}

export function resolveRestoreDrillPaths(env = process.env, options = {}) {
  if (env.POLO_RESTORE_DRILL !== '1') return { ...PRODUCTION };

  const app = env.POLO_APP_ROOT ? absolutePath('POLO_APP_ROOT', env.POLO_APP_ROOT) : PRODUCTION.app;
  const data = env.POLO_DATA_DIR ? underTemp('POLO_DATA_DIR', env.POLO_DATA_DIR) : '';
  const pgSocket = env.POLO_PG_SOCKET ? underTemp('POLO_PG_SOCKET', env.POLO_PG_SOCKET) : '';
  const migrateStaging = env.POLO_MIGRATE_STAGING ? underTemp('POLO_MIGRATE_STAGING', env.POLO_MIGRATE_STAGING) : '';
  const snapshotDir = env.POLO_SNAPSHOT_DIR ? underTemp('POLO_SNAPSHOT_DIR', env.POLO_SNAPSHOT_DIR) : '';
  const snapshotTgz = env.POLO_SNAPSHOT_TGZ ? underTemp('POLO_SNAPSHOT_TGZ', env.POLO_SNAPSHOT_TGZ) : '';
  const restoreDir = env.POLO_RESTORE_DIR ? underTemp('POLO_RESTORE_DIR', env.POLO_RESTORE_DIR) : '';
  const needsRoot = !data || !pgSocket || !migrateStaging || !snapshotDir || !snapshotTgz || !restoreDir;
  const root = !needsRoot
    ? ''
    : options.root
      ? underTemp('drill root', options.root)
      : mkdtempSync(join(resolve(tmpdir()), 'polo-restore-drill-'));
  const own = (value, leaf) => value || join(root, leaf);
  return {
    app,
    data: own(data, 'data'),
    pgSocket: own(pgSocket, 'pg-socket'),
    migrateStaging: own(migrateStaging, 'polo-migrate'),
    snapshotDir: own(snapshotDir, 'snapshot'),
    snapshotTgz: own(snapshotTgz, 'snapshot.tgz'),
    restoreDir: own(restoreDir, 'restore'),
  };
}
