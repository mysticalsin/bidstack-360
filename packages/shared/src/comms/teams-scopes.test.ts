import { describe, expect, it } from 'vitest';

import {
  TEAMS_CHANNEL_SCOPES,
  TEAMS_CHAT_SCOPES,
  WORKSPACE_READ_SCOPES,
  describeScopes,
  grantsTeamsChannelRead,
  grantsTeamsChatRead,
  microsoftRefreshScopes,
  readOnlyScopes,
} from './index.js';
import { TeamsImportRequest } from './teams.js';

const G = 'https://graph.microsoft.com/';

describe('Teams scopes', () => {
  it('asks only for read scopes', () => {
    for (const scope of [...TEAMS_CHAT_SCOPES, ...TEAMS_CHANNEL_SCOPES]) {
      expect(scope).not.toMatch(/Send|ReadWrite|Create/);
    }
    expect(describeScopes([...TEAMS_CHAT_SCOPES, ...TEAMS_CHANNEL_SCOPES]).every((g) => g.access === 'read')).toBe(
      true,
    );
  });

  it('keeps Chat.Read and channel reads from a granted scope string', () => {
    const granted = [...WORKSPACE_READ_SCOPES.microsoft, `${G}Chat.Read`, ...TEAMS_CHANNEL_SCOPES];
    expect(readOnlyScopes(granted)).toEqual(granted);
    expect(grantsTeamsChatRead(granted)).toBe(true);
    expect(grantsTeamsChannelRead(granted)).toBe(true);
  });

  it('drops Teams write scopes an older grant carried', () => {
    const granted = [`${G}Mail.Read`, `${G}Chat.ReadWrite`, `${G}ChatMessage.Send`, `${G}ChannelMessage.Send`];
    expect(readOnlyScopes(granted)).toEqual([`${G}Mail.Read`]);
    const refresh = microsoftRefreshScopes(granted);
    expect(refresh).toContain(`${G}Chat.Read`);
    expect(refresh.join(' ')).not.toMatch(/ReadWrite|Send/);
  });

  it('keeps Chat.Read across a token refresh', () => {
    const refresh = microsoftRefreshScopes([...WORKSPACE_READ_SCOPES.microsoft, `${G}Chat.Read`]);
    expect(refresh).toContain(`${G}Chat.Read`);
  });

  it('needs both directory and message reads for channel threads', () => {
    expect(grantsTeamsChannelRead([`${G}ChannelMessage.Read.All`])).toBe(false);
    expect(grantsTeamsChatRead(WORKSPACE_READ_SCOPES.microsoft)).toBe(false);
  });

  it('labels the Teams grant in plain words', () => {
    expect(describeScopes([`${G}Chat.Read`]).map((g) => g.label)).toEqual(['Read your Teams chats']);
  });
});

describe('TeamsImportRequest', () => {
  it('accepts a chat and a channel thread reference', () => {
    const base = { companyId: '00000000-0000-4000-8000-000000000020', messageIds: ['1'] };
    expect(TeamsImportRequest.parse({ ...base, ref: { kind: 'chat', chatId: '19:abc@thread.v2' } }).keepSyncing).toBe(
      false,
    );
    expect(
      TeamsImportRequest.safeParse({
        ...base,
        ref: { kind: 'channel_thread', teamId: 't', channelId: 'c', messageId: 'm' },
      }).success,
    ).toBe(true);
    expect(TeamsImportRequest.safeParse({ ...base, ref: { kind: 'channel_thread', teamId: 't' } }).success).toBe(
      false,
    );
  });
});
