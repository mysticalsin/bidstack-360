import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { QUEUE_HEARTBEAT_PAGE, queueHeartbeatDetail } from './serum-queue-heartbeat.js';

/**
 * The SERUM queue-heartbeat list reads one row past the page. A caption
 * that prints the loaded length as every queue is the false read.
 */
function queueHeartbeatListProbes(apiSrc: string): boolean {
  const start = apiSrc.indexOf('FROM queue_health');
  const query = apiSrc.slice(start, start + 900);
  const helperSrc = readFileSync(
    path.resolve(process.cwd(), 'src/routes/serum-queue-heartbeat.ts'),
    'utf8',
  );
  return (
    /export const QUEUE_HEARTBEAT_PAGE = 10/.test(helperSrc) &&
    /LIMIT \$\{QUEUE_HEARTBEAT_PAGE \+ 1\}/.test(query) &&
    /const queueHealthContinues = queueRows\.length > QUEUE_HEARTBEAT_PAGE/.test(apiSrc) &&
    /queueRows\.slice\(0, QUEUE_HEARTBEAT_PAGE\)/.test(apiSrc) &&
    /queueHeartbeatDetail\(/.test(apiSrc) &&
    !/COUNT\(\*\)/.test(query) &&
    !/LIMIT 10\b/.test(query)
  );
}

describe('queue heartbeat list caption', () => {
  it('does not call the loaded page every queue when a later row was loaded', () => {
    // WHY: GET /serum/status read queue_health with LIMIT 10 and the
    // SERUM status sentence printed that length as the queue heartbeat
    // rows returned. The settings observability line printed the same length
    // as the queue health rows available. The list draws that page. One
    // more loaded row means those drawn rows are not every queue. The
    // extra row is dropped. A shorter page keeps the old sentence. No
    // queue total is invented.
    const apiSrc = readFileSync(path.resolve(process.cwd(), 'src/routes/serum.ts'), 'utf8');
    const settingsSrc = readFileSync(
      path.resolve(process.cwd(), '../web/src/components/settings/SerumControlPlaneSection.tsx'),
      'utf8',
    );
    const missionSrc = readFileSync(
      path.resolve(process.cwd(), '../web/src/pages/SerumMissionControlPage.tsx'),
      'utf8',
    );
    expect(queueHeartbeatListProbes(apiSrc)).toBe(true);
    expect(settingsSrc).toContain("signal.id === 'queue-heartbeats'");
    expect(settingsSrc).toContain('not every queue');
    expect(settingsSrc).toContain(
      "'{{queueCount}} queue health rows and {{providerCount}} provider health rows available.'",
    );
    expect(missionSrc).toContain("signal.id === 'queue-heartbeats'");
    expect(missionSrc).toContain('not every queue');
    const start = apiSrc.indexOf('FROM queue_health');
    expect(apiSrc.slice(start, start + 900)).not.toMatch(/COUNT\(\*\)/);

    const drawn = QUEUE_HEARTBEAT_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = queueHeartbeatListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(queueHeartbeatDetail(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every queue.`,
    );

    expect(queueHeartbeatDetail(drawn, false, drawn)).toBe(
      `${drawn} queue heartbeat rows returned.`,
    );
    expect(queueHeartbeatDetail(1, false)).toBe('1 queue heartbeat row returned.');
    expect(queueHeartbeatDetail(drawn, false, drawn)).not.toMatch(/not every/i);

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(queueHeartbeatDetail(short.length, shortContinues, short.length)).toBe(
      `${short.length} queue heartbeat rows returned.`,
    );
    expect(queueHeartbeatDetail(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
