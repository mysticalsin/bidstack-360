import type * as ApiModule from '@/lib/api';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RelationshipMap } from '@bidstack/shared';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: vi.fn() };
});

import { ApiError, api } from '@/lib/api';

import { WhoWorksWithThem } from './WhoWorksWithThem';

const COMPANY = 'c0000000-0000-4000-8000-000000000102';
const OWNER = 'b0000000-0000-4000-8000-000000000001';
const MSA = 'a0000000-0000-4000-8000-000000000102';

function emptyMap(): RelationshipMap {
  return {
    companyId: COMPANY,
    companies: [{ id: COMPANY, name: 'Northwind Pharma', relation: 'self', country: 'US' }],
    entities: [],
    people: [],
    rows: [],
    lines: [],
    countries: [],
  };
}

function readyMap(): RelationshipMap {
  return {
    ...emptyMap(),
    rows: [
      {
        kind: 'msa',
        id: MSA,
        label: 'HEMA global MSA',
        companyId: COMPANY,
        companyName: 'Northwind Pharma',
        entity: 'HEMA',
        line: 'health_economics',
        owner: { id: OWNER, name: 'Alex Owner' },
        lastActivityAt: '2026-10-01T00:00:00.000Z',
        valueMicros: null,
        currency: null,
        country: 'US',
      },
    ],
  };
}

function renderWho() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WhoWorksWithThem companyId={COMPANY} />
    </QueryClientProvider>,
  );
}

describe('who works with them on a whitespace row', () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
    vi.mocked(api).mockReset();
  });

  afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
  });

  it('does not call an unread map an empty group', () => {
    // WHY: a paused relationship-map read has no payload. The whitespace row
    // must not say nobody works with the account, and it must not show a zero.
    onlineManager.setOnline(false);
    renderWho();
    const panel = screen.getByTestId('who-works-with-them');
    expect(panel.textContent).toMatch(/has not arrived/);
    expect(panel.textContent).not.toMatch(/No one in the group/);
    expect(panel.textContent).not.toMatch(/\bnone\b/i);
    expect(panel.textContent).not.toMatch(/\b0\b/);
  });

  it('keeps a failed map off the empty sentence', async () => {
    // WHY: a failed read is not a settled empty group.
    vi.mocked(api).mockRejectedValue(new ApiError('missing', 404, { message: 'missing' }));
    renderWho();
    const panel = await screen.findByTestId('who-works-with-them');
    await waitFor(() => expect(panel.textContent).toMatch(/Couldn't load who works with them/));
    expect(panel.textContent).not.toMatch(/No one in the group/);
  });

  it('says the group is empty only after the map arrives with no work', async () => {
    // WHY: a finished map with no MSA, project, or revenue rows is the empty group.
    vi.mocked(api).mockResolvedValue(emptyMap());
    renderWho();
    expect(await screen.findByText('No one in the group works with them yet.')).toBeTruthy();
    expect(screen.getByTestId('who-works-with-them').textContent).not.toMatch(/has not arrived/);
  });

  it('shows the entity once the map arrives', async () => {
    // WHY: a settled row is the group that works with the account. It stays visible.
    vi.mocked(api).mockResolvedValue(readyMap());
    renderWho();
    const panel = await screen.findByTestId('who-works-with-them');
    await waitFor(() => expect(panel.textContent).toContain('HEMA'));
    expect(panel.textContent).toContain('Health economics');
    expect(panel.textContent).not.toMatch(/No one in the group/);
    expect(panel.textContent).not.toMatch(/has not arrived/);
  });
});
