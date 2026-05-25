#!/usr/bin/env node
/**
 * Windows Prisma DLL Lock Workaround
 *
 * On Windows, `prisma generate` fails with EPERM when trying to rename
 * `query_engine-windows.dll.node` because Node processes (API server,
 * test runners) hold a lock on it.
 *
 * This script renames the locked DLL to a `.old` suffix before Prisma
 * tries to overwrite it, preventing the EPERM error.
 */
/* global process, console */
import { renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_DIR = join(process.cwd(), 'generated', 'client');
const DLL_NAME = 'query_engine-windows.dll.node';
const DLL_PATH = join(CLIENT_DIR, DLL_NAME);

if (existsSync(DLL_PATH)) {
  const timestamp = Date.now();
  const backupPath = join(CLIENT_DIR, `${DLL_NAME}.${timestamp}.old`);
  try {
    renameSync(DLL_PATH, backupPath);
    console.log(`[pre-generate] Renamed locked DLL to ${backupPath}`);
  } catch (err) {
    // If rename fails, Prisma's own retry logic may handle it.
    // We don't throw here so the generate script can still attempt.
    console.warn(`[pre-generate] Could not rename DLL: ${err.message}`);
  }
}
