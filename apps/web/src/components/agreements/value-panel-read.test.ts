import { describe, expect, it } from 'vitest';

import {
  VALUE_PANEL_CHECKING,
  VALUE_PANEL_FAILED,
  VALUE_PANEL_REFRESH_FAILED,
  valuePanelRead,
} from './value-panel-read';

// WHY: The agreement detail value panel used one sentence for a paused read,
// a failed read, and a payload that never arrived. That sentence said the
// panel was unavailable. A settled empty list is the only case that may say
// there are no extra value items. Reference text must not price a number as euros.

const BANNED = /unavailable|not found|none|empty|€|EUR|euros|[\u2014\u2013]/i;

describe('value panel read', () => {
  it('does not call a missing payload a failure', () => {
    expect(valuePanelRead({ isError: false, items: null })).toBe('checking');
    expect(VALUE_PANEL_CHECKING).toBe('Checking value opportunities. They have not arrived.');
    expect(VALUE_PANEL_CHECKING).not.toMatch(BANNED);
  });

  it('calls a failed read with no rows a failure', () => {
    expect(valuePanelRead({ isError: true, items: null })).toBe('failed');
    expect(VALUE_PANEL_FAILED).not.toMatch(BANNED);
  });

  it('keeps rows when a refresh fails, including a prior empty list', () => {
    expect(valuePanelRead({ isError: true, items: [{ id: 'uncovered:it' }] })).toBe('refresh-failed');
    expect(valuePanelRead({ isError: true, items: [] })).toBe('refresh-failed');
    expect(VALUE_PANEL_REFRESH_FAILED).not.toMatch(BANNED);
  });

  it('keeps a settled empty list and a settled item', () => {
    expect(valuePanelRead({ isError: false, items: [] })).toBe('empty');
    expect(valuePanelRead({ isError: false, items: [{ id: 'uncovered:it' }] })).toBe('ready');
  });

  it('calls a settled payload with no item list a failure', () => {
    expect(valuePanelRead({ isError: false, items: null, badPayload: true })).toBe('failed');
  });
});
