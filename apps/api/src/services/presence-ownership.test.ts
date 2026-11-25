// The demo team list reads one Redis row per person. The notification socket
// connects, writes that row, and on close deletes it. A reconnect (or the
// team-list heartbeat, which stores sessionId "http") writes a new row, and
// the old close then deletes that too. The dot goes offline while the
// visitor is still on the page. A close may delete only the row it owns.
// A blank session is not ownership: an empty heartbeat must not clear the team.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { shouldRemovePresenceRow } from './presence-ownership.js';

const VISITOR_ID = '11111111-1111-4111-8111-111111111111';
const SOCKET_SESSION = `${VISITOR_ID}:1700000000000`;
const NEWER_SOCKET = `${VISITOR_ID}:1700000005000`;
const TEAM_HEARTBEAT = 'http';

function row(sessionId: string, userId = VISITOR_ID): string {
  return JSON.stringify({
    userId,
    orgId: 'org-demo',
    name: '',
    avatarUrl: null,
    currentEntityType: null,
    currentEntityId: null,
    sessionId,
    lastSeenAt: 1_700_000_000_000,
  });
}

describe('presence row ownership', () => {
  it('lets a socket close remove only the row that socket wrote', () => {
    // WHY: the team dot keys off this row. Deleting a newer session, or the
    // team-list heartbeat, paints the signed-in demo visitor offline.
    expect(shouldRemovePresenceRow(row(SOCKET_SESSION), SOCKET_SESSION)).toBe(true);
    expect(shouldRemovePresenceRow(row(NEWER_SOCKET), SOCKET_SESSION)).toBe(false);
    expect(shouldRemovePresenceRow(row(TEAM_HEARTBEAT), SOCKET_SESSION)).toBe(false);
    expect(shouldRemovePresenceRow(null, SOCKET_SESSION)).toBe(false);
  });

  it('does not treat a blank session as ownership', () => {
    // WHY: the socket heartbeat stores name: '' and must not also store a
    // blank session that any close can claim. An empty close must not wipe
    // a real row, and an empty stored session is not a person we can clear.
    expect(shouldRemovePresenceRow(row(SOCKET_SESSION), '')).toBe(false);
    expect(shouldRemovePresenceRow(row(SOCKET_SESSION), '   ')).toBe(false);
    expect(shouldRemovePresenceRow(row(''), SOCKET_SESSION)).toBe(false);
    expect(shouldRemovePresenceRow(row(''), '')).toBe(false);
    expect(shouldRemovePresenceRow(JSON.stringify({ userId: VISITOR_ID }), SOCKET_SESSION)).toBe(
      false,
    );
    expect(shouldRemovePresenceRow('{', SOCKET_SESSION)).toBe(false);
    expect(shouldRemovePresenceRow('null', SOCKET_SESSION)).toBe(false);
  });

  it('is what the socket close uses, and a missed delete does not broadcast leave', () => {
    const service = readFileSync(path.resolve(__dirname, 'presence.service.ts'), 'utf8');
    const plugin = readFileSync(path.resolve(__dirname, '../plugins/realtime.ts'), 'utf8');

    expect(service).toContain('shouldRemovePresenceRow(raw, sessionId)');
    expect(service).toContain('if (Number(removed) !== 1) return;');
    expect(plugin).toContain('removePresence(auth.orgId, auth.userId, sessionId)');
  });
});
