import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEBHOOK_LIST_PAGE, webhookListCaption } from './webhook-list-caption';

/**
 * The webhook list reads one row past the page. A caption that prints the
 * loaded length as every webhook is the false read.
 */
function webhookListProbes(apiSrc: string): boolean {
  const start = apiSrc.indexOf("'/webhook-subscriptions'");
  const get = apiSrc.slice(start, apiSrc.indexOf("'/webhook-subscriptions'", start + 1));
  return (
    /const WEBHOOK_LIST_PAGE = 500/.test(get) &&
    /take:\s*WEBHOOK_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > WEBHOOK_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, WEBHOOK_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    /pageContinues:\s*z\.boolean\(\)/.test(get) &&
    !/\.count\(/.test(get)
  );
}

describe('webhook list caption', () => {
  it('does not call the loaded page every webhook when a later row was loaded', () => {
    // WHY: GET /webhook-subscriptions fetched take:500 and the webhook section
    // printed that length as Total. The delivery tile counted the same page.
    // One more loaded row means those drawn rows are not every webhook. The
    // extra row is dropped. A shorter page keeps the bare count. No webhook
    // total is invented.
    const sectionSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/WebhooksSection.tsx'),
      'utf8',
    );
    const overviewSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/SettingsOverviewSection.tsx'),
      'utf8',
    );
    const hookSrc = readFileSync(
      path.resolve(process.cwd(), 'src/hooks/useWebhookSubscriptions.ts'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/webhook-subscriptions.ts'),
      'utf8',
    );
    expect(webhookListProbes(apiSrc)).toBe(true);
    expect(hookSrc).toContain('pageContinues: boolean');
    expect(hookSrc).not.toContain('api<WebhookSub[]>');
    expect(sectionSrc).toContain('webhookListCaption(subs.data.items.length, true)');
    expect(overviewSrc).toContain('webhookListCaption(webhooks.data.items.length, true)');
    const start = apiSrc.indexOf("'/webhook-subscriptions'");
    expect(apiSrc.slice(start, apiSrc.indexOf("'/webhook-subscriptions'", start + 1))).not.toMatch(
      /\.count\(/,
    );

    const drawn = WEBHOOK_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = webhookListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(webhookListCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every webhook`,
    );

    const short = loaded.slice(0, 2);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(webhookListCaption(short.length, shortContinues, short.length)).toBe(
      String(short.length),
    );
    expect(webhookListCaption(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
