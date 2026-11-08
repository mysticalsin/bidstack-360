import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_CHANNEL_PREFS,
  absoluteAppUrl,
  buildTeamsAdaptiveCard,
  coalescedTitle,
  computeAccountAudience,
  groupForAccountEvent,
  groupForNotificationType,
  isAllowedTeamsWebhookUrl,
  isOverAllocated,
  postTeamsCard,
  resolveChannelGroups,
  shouldCoalesce,
} from './index.js';

describe('computeAccountAudience', () => {
  const base = {
    actorUserId: 'actor',
    keyAccountOwnerId: 'kam',
    teamUserIds: ['t1', 't2', 'actor'],
    opportunityOwnerIds: ['o1', null, 'kam'],
    follows: [] as Array<{ userId: string; muted: boolean }>,
  };

  it('notifies team, key account owner, opp owners and followers, deduped', () => {
    const out = computeAccountAudience({ ...base, follows: [{ userId: 'f1', muted: false }, { userId: 't1', muted: false }] });
    expect(out.sort()).toEqual(['f1', 'kam', 'o1', 't1', 't2']);
  });

  it('never includes the actor, even when they are on the team and follow', () => {
    const out = computeAccountAudience({ ...base, follows: [{ userId: 'actor', muted: false }] });
    expect(out).not.toContain('actor');
  });

  it('a muted follow row silences an automatic follower', () => {
    const out = computeAccountAudience({ ...base, follows: [{ userId: 'kam', muted: true }, { userId: 't2', muted: true }] });
    expect(out.sort()).toEqual(['o1', 't1']);
  });

  it('a system event (no actor) reaches everyone', () => {
    expect(computeAccountAudience({ ...base, actorUserId: null })).toContain('actor');
  });
});

describe('coalescing', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  it('coalesces inside 10 minutes and not after', () => {
    expect(shouldCoalesce(new Date('2026-11-07T11:51:00Z'), now)).toBe(true);
    expect(shouldCoalesce(new Date('2026-11-07T11:49:59Z'), now)).toBe(false);
    expect(shouldCoalesce(null, now)).toBe(false);
  });
  it('titles carry the count', () => {
    expect(coalescedTitle(3, 'Pfizer')).toBe('3 new updates on Pfizer');
  });
});

describe('channel prefs', () => {
  it('defaults: in-app on, email and Teams off, no digest', () => {
    const g = resolveChannelGroups({});
    expect(g.account_activity).toEqual({ in_app: true, email: false, teams: false });
    expect(DEFAULT_CHANNEL_PREFS.dailyDigest).toBe(false);
  });
  it('keeps stored choices and ignores junk', () => {
    const g = resolveChannelGroups({ groups: { deals: { email: true, in_app: 'yes' }, tasks: 'bad' } });
    expect(g.deals).toEqual({ in_app: true, email: true, teams: false });
    expect(g.tasks).toEqual({ in_app: true, email: false, teams: false });
  });
  it('maps kinds and types to groups', () => {
    expect(groupForAccountEvent('opportunity_stage_changed')).toBe('deals');
    expect(groupForAccountEvent('task_completed')).toBe('tasks');
    expect(groupForAccountEvent('activity_logged')).toBe('account_activity');
    expect(groupForNotificationType('mention')).toBe('mentions');
    expect(groupForNotificationType('assignment')).toBeNull();
  });
});

describe('isAllowedTeamsWebhookUrl', () => {
  it.each([
    'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x',
    'https://default123.ab.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/x',
    'https://contoso.webhook.office.com/webhookb2/abc',
  ])('accepts %s', (url) => expect(isAllowedTeamsWebhookUrl(url)).toBe(true));

  it.each([
    'http://prod-12.westeurope.logic.azure.com/workflows/abc',
    'https://logic.azure.com.evil.example/workflows',
    'https://evil.example/?h=.logic.azure.com',
    'https://user:pw@prod.logic.azure.com/x',
    'https://prod.logic.azure.com:8443/x',
    'https://.logic.azure.com/x',
    'https://127.0.0.1/x',
    'not a url',
  ])('refuses %s', (url) => expect(isAllowedTeamsWebhookUrl(url)).toBe(false));
});

describe('Teams card', () => {
  it('builds an Adaptive Card message with an Open action', () => {
    const card = buildTeamsAdaptiveCard({ title: 'New meeting on Pfizer', body: 'Ana: kickoff', url: 'https://polo.example/companies/1' });
    const content = (card.attachments as Array<{ content: { actions: Array<{ url: string }> } }>)[0]!.content;
    expect(card.type).toBe('message');
    expect(content.actions[0]!.url).toBe('https://polo.example/companies/1');
  });

  it('refuses to post to a non-Microsoft host without calling fetch', async () => {
    const fetchImpl = vi.fn();
    const res = await postTeamsCard('https://evil.example/hook', {}, fetchImpl as unknown as typeof fetch);
    expect(res.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts with redirects refused', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const res = await postTeamsCard('https://prod.logic.azure.com/x', { a: 1 }, fetchImpl as unknown as typeof fetch);
    expect(res).toEqual({ ok: true, status: 202 });
    expect(fetchImpl.mock.calls[0]![1].redirect).toBe('error');
  });
});

describe('misc', () => {
  it('flags allocation over 100%', () => {
    expect(isOverAllocated(100)).toBe(false);
    expect(isOverAllocated(120)).toBe(true);
  });
  it('builds absolute links', () => {
    expect(absoluteAppUrl('https://polo.example/', '/companies/1')).toBe('https://polo.example/companies/1');
    expect(absoluteAppUrl('https://polo.example', null)).toBeNull();
  });
});
