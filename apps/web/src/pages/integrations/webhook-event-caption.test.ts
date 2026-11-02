import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEBHOOK_EVENT_PAGE, webhookEventCaption } from './webhook-event-caption';

/**
 * The webhook-event list reads one row past the page. A caption that prints
 * the loaded length as every event is the false read.
 */
function webhookEventListProbes(apiSrc: string): boolean {
  const start = apiSrc.indexOf("'/webhooks'");
  const get = apiSrc.slice(start);
  return (
    /const WEBHOOK_EVENT_PAGE = 50/.test(get) &&
    /take:\s*WEBHOOK_EVENT_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > WEBHOOK_EVENT_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, WEBHOOK_EVENT_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    /pageContinues:\s*z\.boolean\(\)/.test(get) &&
    !/take:\s*50\b/.test(get) &&
    !/\.count\(/.test(get)
  );
}

describe('webhook event list caption', () => {
  it('does not call the loaded page every event when a later row was loaded', () => {
    // WHY: GET /integrations/webhooks fetched take:50 and the integrations
    // tile printed that length as the webhook-event count. The event list
    // draws the same page. One more loaded row means those drawn rows are
    // not every event. The extra row is dropped. A shorter page keeps the
    // bare count. No event total is invented.
    const heroSrc = readFileSync(
      path.resolve(process.cwd(), 'src/pages/integrations/IntegrationHero.tsx'),
      'utf8',
    );
    const cardSrc = readFileSync(
      path.resolve(process.cwd(), 'src/pages/integrations/WebhookEventsCard.tsx'),
      'utf8',
    );
    const sectionSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/IntegrationsSection.tsx'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/dust-integration.ts'),
      'utf8',
    );
    expect(webhookEventListProbes(apiSrc)).toBe(true);
    expect(sectionSrc).toContain('pageContinues: boolean');
    expect(sectionSrc).toContain('api<WebhookEventPage>');
    expect(sectionSrc).not.toContain('api<{ items: WebhookEvent[] }>');
    expect(heroSrc).toContain('webhookEventCaption(summary.webhookEvents, true)');
    expect(heroSrc).toContain('AnimatedMetric value={String(summary.webhookEvents)}');
    expect(cardSrc).toContain('webhookEventCaption(events.length, true)');
    expect(cardSrc).toContain(
      "'A live evidence stream for Dust callbacks, CRM event subscribers and external automations.'",
    );
    const start = apiSrc.indexOf("'/webhooks'");
    expect(apiSrc.slice(start)).not.toMatch(/\.count\(/);

    const drawn = WEBHOOK_EVENT_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = webhookEventListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(webhookEventCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every event`,
    );

    expect(webhookEventCaption(drawn, false, drawn)).toBe(String(drawn));
    expect(webhookEventCaption(drawn, false, drawn)).not.toMatch(/not every/i);

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(webhookEventCaption(short.length, shortContinues, short.length)).toBe(
      `${short.length}`,
    );
    expect(webhookEventCaption(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
