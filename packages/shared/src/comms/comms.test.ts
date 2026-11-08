import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_READ_SCOPES,
  describeScopes,
  grantsCalendarRead,
  grantsCalendarWrite,
  grantsMailRead,
  grantsMailSend,
  googleEventTime,
  graphEventTime,
  maySendMail,
  mayWriteCalendar,
  readOnlyScopes,
  zonedWallTimeToUtc,
} from './index.js';

describe('workspace scopes', () => {
  it('requests read-only scopes by default for both providers', () => {
    for (const provider of ['google', 'microsoft'] as const) {
      const scopes = WORKSPACE_READ_SCOPES[provider];
      expect(grantsMailRead(scopes)).toBe(true);
      expect(grantsCalendarRead(scopes)).toBe(true);
      expect(grantsMailSend(scopes)).toBe(false);
      expect(grantsCalendarWrite(scopes)).toBe(false);
      expect(scopes.join(' ')).not.toMatch(/send|ReadWrite|modify|compose|auth\/calendar(\s|$)/i);
    }
  });

  it('keeps refresh access on Microsoft so sync survives the one-hour token', () => {
    expect(WORKSPACE_READ_SCOPES.microsoft).toContain('offline_access');
  });

  it('describes scopes in plain words and flags write access', () => {
    const grants = describeScopes([
      'openid',
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ]);
    expect(grants.map((g) => g.label)).toEqual([
      'See your email address',
      'Read your email',
      'Read your calendar',
      'Send email as you',
    ]);
    expect(grants.find((g) => g.key === 'mail_send')?.access).toBe('write');
    expect(grants.find((g) => g.key === 'mail_read')?.access).toBe('read');
  });

  it('understands Microsoft scope spellings with and without the Graph prefix', () => {
    const grants = describeScopes([
      'https://graph.microsoft.com/Mail.Read',
      'Calendars.Read',
      'offline_access',
      'User.Read',
    ]);
    expect(grants.map((g) => g.key)).toEqual(['identity', 'offline', 'mail_read', 'calendar_read']);
    expect(grantsCalendarRead(['Calendars.ReadWrite'])).toBe(true);
    expect(grantsCalendarWrite(['https://graph.microsoft.com/Calendars.ReadWrite'])).toBe(true);
  });

  it('keeps only read scopes from what the provider returns on reconnect', () => {
    const returned = [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://graph.microsoft.com/Mail.Send',
      'Calendars.ReadWrite',
      'offline_access',
      'https://www.googleapis.com/auth/drive',
    ];
    expect(readOnlyScopes(returned)).toEqual([
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      'offline_access',
    ]);
  });

  it('never allows provider writes, even on a legacy send or write grant', () => {
    const legacy = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar'];
    expect(grantsMailSend(legacy)).toBe(true);
    expect(maySendMail(legacy)).toBe(false);
    expect(mayWriteCalendar(legacy)).toBe(false);
  });
});

describe('provider event times', () => {
  it('reads Graph UTC wall times as UTC, not server local time', () => {
    const t = graphEventTime({ dateTime: '2026-11-06T15:00:00.0000000', timeZone: 'UTC' }, false);
    expect(t.toISOString()).toBe('2026-11-06T15:00:00.000Z');
  });

  it('converts a Graph time in a named zone through that zone', () => {
    const t = graphEventTime({ dateTime: '2026-07-01T09:30:00.0000000', timeZone: 'America/Toronto' }, false);
    expect(t.toISOString()).toBe('2026-07-01T13:30:00.000Z');
  });

  it('pins Graph all-day events to the calendar date', () => {
    const t = graphEventTime({ dateTime: '2026-11-06T00:00:00.0000000', timeZone: 'America/Toronto' }, true);
    expect(t.toISOString()).toBe('2026-11-06T00:00:00.000Z');
  });

  it('pins Google all-day dates and honours explicit offsets', () => {
    expect(googleEventTime({ date: '2026-11-06' }).toISOString()).toBe('2026-11-06T00:00:00.000Z');
    expect(googleEventTime({ dateTime: '2026-11-06T10:00:00-05:00' }).toISOString()).toBe(
      '2026-11-06T15:00:00.000Z',
    );
  });

  it('handles both sides of the Toronto DST change', () => {
    expect(zonedWallTimeToUtc('2026-11-01T00:30:00', 'America/Toronto').toISOString()).toBe(
      '2026-11-01T04:30:00.000Z',
    );
    expect(zonedWallTimeToUtc('2026-11-02T00:30:00', 'America/Toronto').toISOString()).toBe(
      '2026-11-02T05:30:00.000Z',
    );
  });
});
