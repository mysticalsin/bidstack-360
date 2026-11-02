import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROVIDER_HEARTBEAT_PAGE, providerHeartbeatDetail } from './serum-provider-heartbeat.js';

/**
 * The SERUM provider-heartbeat list reads one row past the page. A caption
 * that prints the loaded length as every provider is the false read.
 */
function providerHeartbeatListProbes(apiSrc: string): boolean {
  const start = apiSrc.indexOf('FROM provider_health');
  const query = apiSrc.slice(start, start + 900);
  const helperSrc = readFileSync(
    path.resolve(process.cwd(), 'src/routes/serum-provider-heartbeat.ts'),
    'utf8',
  );
  return (
    /export const PROVIDER_HEARTBEAT_PAGE = 8/.test(helperSrc) &&
    /LIMIT \$\{PROVIDER_HEARTBEAT_PAGE \+ 1\}/.test(query) &&
    /const providerHealthContinues = providerRows\.length > PROVIDER_HEARTBEAT_PAGE/.test(apiSrc) &&
    /providerRows\.slice\(0, PROVIDER_HEARTBEAT_PAGE\)/.test(apiSrc) &&
    /providerHeartbeatDetail\(/.test(apiSrc) &&
    !/COUNT\(\*\)/.test(query) &&
    !/LIMIT 8\b/.test(query)
  );
}

describe('provider heartbeat list caption', () => {
  it('does not call the loaded page every provider when a later row was loaded', () => {
    // WHY: GET /serum/status read provider_health with LIMIT 8 and the
    // SERUM status sentence printed that length as the provider heartbeat
    // rows returned. The settings observability line printed the same length
    // as the provider health rows available. The list draws that page. One
    // more loaded row means those drawn rows are not every provider. The
    // extra row is dropped. A shorter page keeps the old sentence. No
    // provider total is invented.
    const apiSrc = readFileSync(path.resolve(process.cwd(), 'src/routes/serum.ts'), 'utf8');
    const settingsSrc = readFileSync(
      path.resolve(process.cwd(), '../web/src/components/settings/SerumControlPlaneSection.tsx'),
      'utf8',
    );
    const missionSrc = readFileSync(
      path.resolve(process.cwd(), '../web/src/pages/SerumMissionControlPage.tsx'),
      'utf8',
    );
    expect(providerHeartbeatListProbes(apiSrc)).toBe(true);
    expect(settingsSrc).toContain("signal.id === 'provider-heartbeats'");
    expect(settingsSrc).toContain('not every provider');
    expect(settingsSrc).toContain(
      "'{{queueCount}} queue health rows and {{providerCount}} provider health rows available.'",
    );
    expect(missionSrc).toContain("signal.id === 'provider-heartbeats'");
    expect(missionSrc).toContain('not every provider');
    const start = apiSrc.indexOf('FROM provider_health');
    expect(apiSrc.slice(start, start + 900)).not.toMatch(/COUNT\(\*\)/);

    const drawn = PROVIDER_HEARTBEAT_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = providerHeartbeatListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(providerHeartbeatDetail(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every provider.`,
    );

    expect(providerHeartbeatDetail(drawn, false, drawn)).toBe(
      `${drawn} provider heartbeat rows returned.`,
    );
    expect(providerHeartbeatDetail(1, false)).toBe('1 provider heartbeat row returned.');
    expect(providerHeartbeatDetail(drawn, false, drawn)).not.toMatch(/not every/i);

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(providerHeartbeatDetail(short.length, shortContinues, short.length)).toBe(
      `${short.length} provider heartbeat rows returned.`,
    );
    expect(providerHeartbeatDetail(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
