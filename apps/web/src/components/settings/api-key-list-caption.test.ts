import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { API_KEY_LIST_PAGE, apiKeyListCaption } from './api-key-list-caption';

/**
 * The API-key list reads one row past the page. A caption that prints the
 * loaded length as every key is the false read.
 */
function apiKeyListProbes(apiSrc: string): boolean {
  const start = apiSrc.indexOf("'/api-keys'");
  const get = apiSrc.slice(start, apiSrc.indexOf("'/api-keys'", start + 1));
  return (
    /const API_KEY_LIST_PAGE = 500/.test(get) &&
    /take:\s*API_KEY_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > API_KEY_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, API_KEY_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    /pageContinues:\s*z\.boolean\(\)/.test(get) &&
    !/\.count\(/.test(get)
  );
}

describe('API key list caption', () => {
  it('does not call the loaded page every key when a later row was loaded', () => {
    // WHY: GET /api-keys fetched take:500 and the developer tile printed that
    // length as "{{value}} API keys". The key list drew the same page. One
    // more loaded row means those drawn rows are not every key. The extra row
    // is dropped. A shorter page keeps the bare count. No key total is
    // invented.
    const sectionSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/ApiKeysSection.tsx'),
      'utf8',
    );
    const overviewSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/SettingsOverviewSection.tsx'),
      'utf8',
    );
    const hookSrc = readFileSync(path.resolve(process.cwd(), 'src/hooks/useApiKeys.ts'), 'utf8');
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/dust-integration.ts'),
      'utf8',
    );
    expect(apiKeyListProbes(apiSrc)).toBe(true);
    expect(hookSrc).toContain('pageContinues: boolean');
    expect(hookSrc).not.toContain('api<{ items: ApiKeySummary[] }>');
    expect(sectionSrc).toContain('apiKeyListCaption(list.data.items.length, true)');
    expect(overviewSrc).toContain('apiKeyListCaption(apiKeys.data.items.length, true)');
    const start = apiSrc.indexOf("'/api-keys'");
    expect(apiSrc.slice(start, apiSrc.indexOf("'/api-keys'", start + 1))).not.toMatch(/\.count\(/);

    const drawn = API_KEY_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = apiKeyListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(apiKeyListCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every key`,
    );

    const short = loaded.slice(0, 2);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(apiKeyListCaption(short.length, shortContinues, short.length)).toBe(
      String(short.length),
    );
    expect(apiKeyListCaption(short.length, shortContinues, short.length)).not.toMatch(/not every/i);
  });
});
