// A missing diff is not an empty object. Inspect and export must not draw
// "{}" or offer that object as the raw payload when nothing was captured.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';

import type { AuditLogEntry } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      vars?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const values = typeof fallback === 'object' && fallback !== null ? fallback : vars;
      if (!values) return template;
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

import { safeStringify } from './audit-log-helpers';
import { AuditTable } from './AuditLogTable';

function entry(diff: AuditLogEntry['diff']): AuditLogEntry {
  return {
    id: '1',
    action: 'company.update',
    targetType: 'company',
    targetId: 'co-sample',
    userId: null,
    userName: 'Sample Admin',
    userEmail: 'sample.admin@example.com',
    diff,
    createdAt: '2026-11-25T12:00:00.000Z',
  };
}

function Harness({ rows }: { rows: AuditLogEntry[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <MemoryRouter>
      <AuditTable
        rows={rows}
        rawRowCount={rows.length}
        expanded={expanded}
        onToggle={(id) => setExpanded((current) => ({ ...current, [id]: !current[id] }))}
        canGoNewer={false}
        canGoOlder={false}
        page={1}
        onOlder={() => undefined}
        onNewer={() => undefined}
      />
    </MemoryRouter>
  );
}

function openDiff() {
  fireEvent.click(screen.getByRole('button', { name: /Inspect diff payload/ }));
}

describe('Audit diff payload when nothing was captured', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not draw a missing diff as an empty object', () => {
    // WHY: a null diff means the payload never arrived. "{}" and "use the
    // raw payload" tell a demo reader an empty object was captured.
    render(<Harness rows={[entry(null)]} />);
    openDiff();

    expect(screen.getByText('No raw evidence payload was captured for this event.')).toBeTruthy();
    expect(screen.queryByText('{}')).toBeNull();
    expect(
      screen.queryByText(
        'No structured diff was captured for this event. Use the raw payload when forensic detail is required.',
      ),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy JSON' })).toBeNull();
  });

  it('still shows an empty object that was stored', () => {
    // WHY: a stored empty object arrived. That payload stays visible.
    render(<Harness rows={[entry({})]} />);
    openDiff();

    expect(screen.getByText('{}')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeTruthy();
    expect(screen.queryByText('No raw evidence payload was captured for this event.')).toBeNull();
  });

  it('still shows a captured field change', () => {
    // WHY: a stored diff stays on the row. The not-captured sentence is only
    // for a payload that never arrived.
    render(<Harness rows={[entry({ status: { from: 'open', to: 'won' } })]} />);
    openDiff();

    expect(screen.getAllByText('Status: open to won').length).toBeGreaterThan(0);
    expect(screen.getByText(/"status"/)).toBeTruthy();
    expect(screen.queryByText('No raw evidence payload was captured for this event.')).toBeNull();
  });
});

describe('safeStringify', () => {
  it('does not turn a missing diff into an empty object', () => {
    // WHY: export and search reuse this helper. "{}" in a CSV is a captured
    // empty payload, not a row whose diff never arrived.
    expect(safeStringify(null)).toBe('');
    expect(safeStringify(undefined)).toBe('');
  });

  it('keeps a stored empty object and a stored field', () => {
    // WHY: a payload that arrived must export as itself.
    expect(safeStringify({})).toBe('{}');
    expect(safeStringify({ status: 'won' })).toBe('{"status":"won"}');
  });
});
