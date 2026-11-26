// A paused or in-flight ERP status read has no payload yet. The card used
// the same "set ERP_MCP_URL" caption and "local" kit badge as a settled
// unset deployment. A failed read kept that local badge. The payload has
// not arrived, so it is not a local kit and it is not an empty lookup.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

import { ErpConnectorCard } from './ErpConnectorCard';

const STATUS_PATH = '/api/integrations/erp/status';
const KIT_PATH = '/api/integrations/erp/presales-kit';

const UNSET = {
  configured: false,
  url: null,
  database: null,
  reachable: false,
  toolCount: null,
  lastError: null,
};

const LIVE = {
  configured: true,
  url: 'http://erp.example/mcp',
  database: 'demo-book',
  reachable: true,
  toolCount: 2,
  lastError: null,
};

const KIT = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  configured: true,
  reachable: true,
  modules: [
    {
      id: 'partner-autocomplete',
      label: 'Partner autocomplete',
      erpModels: ['res.partner'],
      bidstackSurface: 'Company lookup',
      value: 'Search by legal name.',
      status: 'sidecar',
      availableTools: ['search_records'],
    },
  ],
  partnerAutocomplete: { inputs: ['legal name'], fallback: 'local book', validates: [] },
  fieldMap: [],
  nextActions: ['Map partner rows into the verified cache.'],
  lastError: null,
};

const NONE = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  configured: true,
  reachable: true,
  source: 'none',
  items: [],
  warnings: [],
};

const SET_URL = 'set ERP_MCP_URL + ERP_DB to enable';
const NOT_CONFIGURED = 'not configured';
const LOCAL = 'local';
const STATUS_WAITING = 'The status has not arrived.';
const KIT_WAITING = 'The ERP kit has not arrived.';
const KIT_FAILED = 'Could not load the ERP kit.';
const EMPTY_LOOKUP = 'No company suggestions yet';

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ErpConnectorCard />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

describe('ErpConnectorCard unread ERP status', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused ERP status read a local kit', async () => {
    // WHY: a paused first read has isLoading false and no status. The card
    // told the reader to set ERP_MCP_URL and badged the operating kit local,
    // while the payload has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderCard();

    expect(await screen.findByText(STATUS_WAITING)).toBeTruthy();
    expect(screen.queryByText(SET_URL)).toBeNull();
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull();
    expect(screen.queryByText(LOCAL)).toBeNull();
    expect(screen.queryByText(/ERP MCP sidecar/)).toBeNull();
  });

  it('does not call an in-flight ERP status read a local kit', async () => {
    // WHY: the skeleton alone still sat under a "set ERP_MCP_URL" caption
    // and a local kit badge. A slow read is not an unset ERP.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderCard();

    expect(await screen.findByText(STATUS_WAITING)).toBeTruthy();
    expect(screen.queryByText(SET_URL)).toBeNull();
    expect(screen.queryByText(LOCAL)).toBeNull();
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull();
  });

  it('does not call a failed ERP status read a local kit', async () => {
    // WHY: a failed status read is not evidence the kit is local. The error
    // stays, and the operating kit does not badge itself available.
    apiMock.mockImplementation((path: string) => {
      if (path === STATUS_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderCard();

    expect(
      await screen.findByRole('heading', { name: "Couldn't reach the ERP status endpoint" }, { timeout: 6000 }),
    ).toBeTruthy();
    expect(screen.getByText(/It has not arrived/)).toBeTruthy();
    expect(screen.queryByText(LOCAL)).toBeNull();
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull();
    expect(screen.queryByText(SET_URL)).toBeNull();
  });

  it('still says ERP is unset after a settled status with configured false', async () => {
    // WHY: a status payload that arrived unset is not a slow network. The
    // set-URL line and the local kit badge stay for that settled read.
    apiMock.mockImplementation((path: string) => {
      if (path === STATUS_PATH) return Promise.resolve(UNSET);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderCard();

    expect(await screen.findByText(NOT_CONFIGURED)).toBeTruthy();
    expect(screen.getByText(SET_URL)).toBeTruthy();
    expect(screen.getByText(LOCAL)).toBeTruthy();
    expect(screen.getByText(/ERP MCP sidecar/)).toBeTruthy();
    expect(screen.queryByText(STATUS_WAITING)).toBeNull();
  });

  it('does not call an in-flight ERP kit a local kit', async () => {
    // WHY: once status says ERP is configured, the kit request can still be
    // in flight. That gap was badged local, which reads as available.
    apiMock.mockImplementation((path: string) => {
      if (path === STATUS_PATH) return Promise.resolve(LIVE);
      if (path === KIT_PATH) return hang();
      if (String(path).startsWith('/api/integrations/erp/company-autocomplete')) return hang();
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderCard();

    expect(await screen.findByText(KIT_WAITING)).toBeTruthy();
    expect(screen.queryByText(LOCAL)).toBeNull();
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull();
  });

  it('does not call a failed ERP kit a local kit', async () => {
    // WHY: a failed kit read has no modules. Badging it local says a local
    // kit is available when the payload did not arrive.
    apiMock.mockImplementation((path: string) => {
      if (path === STATUS_PATH) return Promise.resolve(LIVE);
      if (path === KIT_PATH) return Promise.reject(new Error('kit down'));
      if (String(path).startsWith('/api/integrations/erp/company-autocomplete')) return Promise.resolve(NONE);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderCard();

    expect(await screen.findByText(KIT_FAILED)).toBeTruthy();
    expect(screen.getByText(/It has not arrived/)).toBeTruthy();
    expect(screen.queryByText(LOCAL)).toBeNull();
  });

  it('still shows a kit that has arrived', async () => {
    // WHY: a loaded sidecar kit stays on the card. The unread line must not
    // replace modules the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === STATUS_PATH) return Promise.resolve(LIVE);
      if (path === KIT_PATH) return Promise.resolve(KIT);
      if (String(path).startsWith('/api/integrations/erp/company-autocomplete')) return Promise.resolve(NONE);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderCard();

    expect(await screen.findByText('Search by legal name.')).toBeTruthy();
    expect(screen.getAllByText('sidecar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('demo-book').length).toBeGreaterThan(0);
    expect(screen.queryByText(KIT_WAITING)).toBeNull();
    expect(screen.queryByText(STATUS_WAITING)).toBeNull();
  });

  it('still says a settled lookup found none', async () => {
    // WHY: a lookup payload that arrived empty is a miss. That line stays
    // "none" so a real empty book is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === STATUS_PATH) return Promise.resolve(LIVE);
      if (path === KIT_PATH) return Promise.resolve(KIT);
      if (String(path).startsWith('/api/integrations/erp/company-autocomplete')) return Promise.resolve(NONE);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderCard();

    expect(await screen.findByText('none')).toBeTruthy();
    expect(screen.getByText(new RegExp(EMPTY_LOOKUP))).toBeTruthy();
    expect(screen.queryByText(KIT_WAITING)).toBeNull();
  });
});
