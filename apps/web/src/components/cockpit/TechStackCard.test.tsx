import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps, ElementType, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TechStackCard } from './TechStackCard';
import type {
  AccountCockpitSnapshot,
  CrmCompany,
  TechnicalStackCategory,
  TechnicalStackState,
} from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  technicalStackState: undefined as TechnicalStackState | undefined,
  saveStack: vi.fn(),
  refreshStack: vi.fn(),
  acceptSuggestion: vi.fn(),
  dismissSuggestion: vi.fn(),
  refetchTechnicalStack: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/components/company/TechLogo', () => ({
  TechLogo: ({ name }: { name: string }) => <span aria-hidden>{name.slice(0, 1)}</span>,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/hooks/useCompanyTechnicalStack', () => ({
  useCompanyTechnicalStack: () => ({
    data: hookMocks.technicalStackState,
    isFetching: false,
    refetch: hookMocks.refetchTechnicalStack,
  }),
  useSaveCompanyTechnicalStack: () => ({
    mutateAsync: hookMocks.saveStack,
    isPending: false,
  }),
  useRefreshCompanyTechnicalStack: () => ({
    mutateAsync: hookMocks.refreshStack,
    isPending: false,
  }),
  useAcceptTechnicalStackSuggestion: () => ({
    mutateAsync: hookMocks.acceptSuggestion,
    isPending: false,
  }),
  useDismissTechnicalStackSuggestion: () => ({
    mutateAsync: hookMocks.dismissSuggestion,
    isPending: false,
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionComponent = (tag: ElementType) => {
    const Component = React.forwardRef<
      HTMLElement,
      ComponentProps<'div'> & { children?: ReactNode }
    >(({ children, ...props }, ref) => {
      const { animate, initial, transition, whileHover, whileTap, ...domProps } = props as Record<
        string,
        unknown
      >;
      void animate;
      void initial;
      void transition;
      void whileHover;
      void whileTap;
      return React.createElement(tag, { ...domProps, ref }, children);
    });
    Component.displayName = `Motion${String(tag)}`;
    return Component;
  };

  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => motionComponent(tag),
      },
    ),
    useReducedMotion: () => true,
  };
});

beforeEach(() => {
  hookMocks.technicalStackState = undefined;
  hookMocks.saveStack.mockResolvedValue({});
  hookMocks.refreshStack.mockResolvedValue({
    state: {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: cockpit().technicalStack,
      effectiveStack: cockpit().technicalStack,
      suggestions: [],
      updatedAt: null,
    },
    providers: [],
  });
  hookMocks.acceptSuggestion.mockResolvedValue({});
  hookMocks.dismissSuggestion.mockResolvedValue({});
  hookMocks.refetchTechnicalStack.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function company(): CrmCompany {
  return {
    id: 'acme-north',
    source: 'verified_data',
    name: 'Acme North',
    legalName: 'Acme North SAS',
    domain: 'acme.example',
    website: 'https://acme.example/',
    industry: 'Technology',
    imageUrl: null,
    employeeCount: 1250,
    annualRevenueMicros: null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    technicalStack: [],
    confidence: 0.94,
    sourceAttribution: [],
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}

function cockpit(): AccountCockpitSnapshot {
  return {
    company: company(),
    externalLastSyncedAt: null,
    kpis: [],
    revenueEvolution: [],
    winLoss: { wonCount: 0, lostCount: 0, wonValueMicros: 0, lostValueMicros: 0, winRate: 0 },
    technicalStack: [
      {
        label: 'Cloud',
        items: [
          { name: 'Azure', source: 'enrichment:apollo', confidence: 0.91 },
          { name: 'Snowflake', source: 'manual', confidence: 1 },
        ],
      },
    ],
    health: { score: 80, band: 'good', counts: {}, factors: [] },
    keyContacts: [],
    recentActivity: [],
    risks: [],
    compliance: [],
    roadmap: [],
  };
}

describe('TechStackCard provenance', () => {
  it('shows source and confidence metadata on stack pills', () => {
    render(<TechStackCard cockpit={cockpit()} />);

    expect(screen.getByText('Azure')).toBeTruthy();
    expect(screen.getAllByText('Apollo').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Azure source: enrichment:apollo. Confidence 91%.')).toBeTruthy();
    expect(screen.getAllByText('Manual').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Snowflake source: manual. Confidence 100%.')).toBeTruthy();
  });

  it('saves edited stack entries as manual data', async () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.change(screen.getByLabelText('Vendor 1 in Cloud'), {
      target: { value: 'Databricks' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Databricks', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
      ]);
    });
  });

  it('seeds edit mode from the visible cockpit stack when no override exists yet', () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: [],
      providerStack: [],
      effectiveStack: [],
      suggestions: [],
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));

    expect((screen.getByLabelText('Vendor 1 in Cloud') as HTMLInputElement).value).toBe('Azure');
  });

  it('gives an empty account a source-backed add start point', async () => {
    const emptyCockpit = { ...cockpit(), technicalStack: [] };
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: [],
      providerStack: [],
      effectiveStack: [],
      suggestions: [],
      updatedAt: null,
    };

    render(<TechStackCard cockpit={emptyCockpit} />);

    const startOptions = screen.getByLabelText('Technical stack start options');
    expect(within(startOptions).getByText('Build the stack from evidence')).toBeTruthy();
    expect(within(startOptions).getByText('Apollo')).toBeTruthy();
    expect(within(startOptions).getByText('Seamless.AI')).toBeTruthy();
    expect(within(startOptions).getByText('Tech Intel')).toBeTruthy();
    expect(within(startOptions).getByText('Configured MCPs')).toBeTruthy();
    expect(within(startOptions).getByText('Other sources')).toBeTruthy();
    expect(
      within(startOptions).getByRole('button', {
        name: 'Add technical stack manually',
      }),
    ).toBeTruthy();

    fireEvent.click(
      within(startOptions).getByRole('button', {
        name: 'Pull source technologies into empty technical stack',
      }),
    );
    await waitFor(() => expect(hookMocks.refreshStack).toHaveBeenCalledTimes(1));

    expect(screen.getByLabelText('Provider source pull')).toBeTruthy();
    expect(screen.getByLabelText('New stack vendor')).toBeTruthy();
  });

  it('gives populated stacks a source-backed add launchpad that pulls providers first', async () => {
    hookMocks.refreshStack.mockResolvedValue({
      state: {
        companyKey: 'acme-north',
        manualStack: cockpit().technicalStack,
        providerStack: [
          ...cockpit().technicalStack,
          {
            label: 'ERP',
            items: [{ name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 }],
          },
        ],
        effectiveStack: cockpit().technicalStack,
        suggestions: [
          {
            id: 'erp:sap',
            label: 'ERP',
            item: { name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 },
            providerUpdatedAt: '2026-06-16T12:00:00.000Z',
          },
        ],
        updatedAt: null,
      },
      providers: [
        {
          id: 'apollo',
          label: 'Apollo',
          status: 'queued',
          transport: 'mcp',
          message: 'Apollo company intelligence queued through the configured MCP lane.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'seamless',
          label: 'Seamless.AI',
          status: 'synced',
          transport: 'mcp',
          message: 'Seamless.AI MCP returned company technology signals.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'tech_intel',
          label: 'BuiltWith MCP',
          status: 'disabled',
          transport: null,
          message: 'Technology intelligence MCP is not configured.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'open_data',
          label: 'Open data',
          status: 'synced',
          transport: 'open_data',
          message: 'Open company verification checked domain, logo, and public profile sources.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
      ],
    });

    render(<TechStackCard cockpit={cockpit()} />);

    const launchpad = screen.getByLabelText('Source-backed stack add launchpad');
    expect(within(launchpad).getByText('Add from verified sources')).toBeTruthy();
    expect(within(launchpad).getByText('Apollo')).toBeTruthy();
    expect(within(launchpad).getByText('Seamless.AI')).toBeTruthy();
    expect(within(launchpad).getByText('Tech Intel')).toBeTruthy();
    expect(within(launchpad).getByText('Other sources')).toBeTruthy();

    fireEvent.click(
      within(launchpad).getByRole('button', {
        name: 'Pull and review technical stack sources from Apollo, Seamless, Tech Intel MCPs, and attributed sources',
      }),
    );

    await waitFor(() => expect(hookMocks.refreshStack).toHaveBeenCalledTimes(1));

    expect(screen.getByLabelText('Provider source pull')).toBeTruthy();
    expect(screen.getByText('Queued MCP')).toBeTruthy();
    expect(screen.getAllByText('Synced via MCP').length).toBeGreaterThanOrEqual(1);
  });

  it('adds and removes stack entries before saving', async () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    expect(screen.getByText('Add verified technology')).toBeTruthy();
    expect(screen.getByText('Pull source evidence, then curate manual truth')).toBeTruthy();
    const guided = screen.getByLabelText('Guided technical stack add');
    expect(within(guided).getByText('Start with source intelligence')).toBeTruthy();
    fireEvent.click(
      within(guided).getByRole('button', {
        name: 'Pull technical stack sources from guided add',
      }),
    );
    await waitFor(() => expect(hookMocks.refreshStack).toHaveBeenCalledTimes(1));
    expect(
      screen.getAllByLabelText('Azure source: enrichment:apollo. Confidence 91%.').length,
    ).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Azure' }));
    fireEvent.change(screen.getByLabelText('New stack category'), {
      target: { value: 'Cloud' },
    });
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'ServiceNow' },
    });
    fireEvent.click(
      within(guided).getByRole('button', {
        name: 'Stage typed technical stack entries from guided add',
      }),
    );
    const staged = screen.getByLabelText('Recently staged stack entries');
    expect(within(staged).getByText('ServiceNow')).toBeTruthy();
    expect(within(staged).getByText('Cloud')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Snowflake', source: 'manual', confidence: 1 },
            { name: 'ServiceNow', source: 'manual', confidence: 1 },
          ],
        },
      ]);
    });
  });

  it('keeps quick suggestions useful for the active comma-separated token', () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'Salesforce, tab' },
    });

    const suggestions = screen.getByLabelText('Suggested technologies');
    expect(within(suggestions).getByRole('button', { name: 'Add Tableau to Data' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add Tableau to Data' }));
    const staged = screen.getByLabelText('Recently staged stack entries');
    expect(within(staged).getByText('Tableau')).toBeTruthy();
    expect(within(staged).getByText('Data')).toBeTruthy();
  });

  it('promotes provider-backed matches while typing a manual vendor', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'Cloud',
          items: [{ name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'cloud:aws',
          label: 'Cloud',
          item: { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    const vendorInput = screen.getByLabelText('New stack vendor') as HTMLTextAreaElement;
    fireEvent.change(vendorInput, { target: { value: 'aw' } });

    const matches = screen.getByLabelText('Provider-backed technology matches');
    const match = within(matches).getByRole('button', {
      name: 'Use AWS from Apollo source match',
    });
    expect(within(match).getByText('82%')).toBeTruthy();
    const assistant = screen.getByLabelText('Source-backed add assistant');
    expect(within(assistant).getByText('Source-first add')).toBeTruthy();
    const acceptBest = within(assistant).getByRole('button', {
      name: 'Accept source-backed match AWS',
    });
    expect(within(acceptBest).getByText('82%')).toBeTruthy();
    const guided = screen.getByLabelText('Guided technical stack add');
    expect(within(guided).getByText('Best source match ready')).toBeTruthy();

    fireEvent.click(
      within(guided).getByRole('button', {
        name: 'Accept source-backed match AWS from guided add',
      }),
    );
    expect(vendorInput.value).toBe('');
    const staged = screen.getByLabelText('Recently staged stack entries');
    expect(within(staged).getByText('AWS')).toBeTruthy();
    expect(within(staged).getByText('Apollo')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
            { name: 'AWS', source: 'manual:accepted:enrichment:apollo', confidence: 1 },
          ],
        },
      ]);
    });
  });

  it('recommends the strongest provider-backed source before manual typing', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'ERP',
          items: [{ name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 }],
        },
        {
          label: 'Cloud',
          items: [{ name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'cloud:aws',
          label: 'Cloud',
          item: { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
        {
          id: 'erp:sap',
          label: 'ERP',
          item: { name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    const assistant = screen.getByLabelText('Source-backed add assistant');
    const acceptBest = within(assistant).getByRole('button', {
      name: 'Accept source-backed match SAP',
    });
    expect(within(acceptBest).getByText('90%')).toBeTruthy();

    fireEvent.click(acceptBest);

    const proof = screen.getByLabelText('Accepted source-backed draft');
    expect(within(proof).getByText('Ready to save')).toBeTruthy();
    expect(proof.textContent).toContain('1Seamless');
    expect(assistant.textContent).toContain('1 accepted');
    const staged = screen.getByLabelText('Recently staged stack entries');
    expect(within(staged).getByText('SAP')).toBeTruthy();
    expect(within(staged).getByText('Seamless')).toBeTruthy();
  });

  it('stages exact typed provider matches with accepted source provenance', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'Cloud',
          items: [{ name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'cloud:aws',
          label: 'Cloud',
          item: { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'AWS' },
    });

    expect(screen.getByLabelText('Technology intake summary').textContent).toContain(
      '1 source match',
    );
    const preview = screen.getByLabelText('Technology add preview');
    expect(within(preview).getByText('AWS')).toBeTruthy();
    expect(within(preview).getByText('Apollo')).toBeTruthy();
    const review = screen.getByLabelText('Source-aware staging review');
    expect(within(review).getByText('Staging review')).toBeTruthy();
    expect(within(review).getByText('Source-backed')).toBeTruthy();
    expect(within(review).getByText('Stage keeps provider provenance.')).toBeTruthy();
    expect(within(review).getByText('Apollo')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    const staged = screen.getByLabelText('Recently staged stack entries');
    expect(within(staged).getByText('AWS')).toBeTruthy();
    expect(within(staged).getByText('Apollo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
            { name: 'AWS', source: 'manual:accepted:enrichment:apollo', confidence: 1 },
          ],
        },
      ]);
    });
  });

  it('uses the strongest source when multiple providers detect the same typed vendor', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'ITSM',
          items: [
            { name: 'ServiceNow', source: 'enrichment:apollo', confidence: 0.73 },
            { name: 'ServiceNow', source: 'enrichment:seamless', confidence: 0.91 },
          ],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'itsm:servicenow-apollo',
          label: 'ITSM',
          item: { name: 'ServiceNow', source: 'enrichment:apollo', confidence: 0.73 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
        {
          id: 'itsm:servicenow-seamless',
          label: 'ITSM',
          item: { name: 'ServiceNow', source: 'enrichment:seamless', confidence: 0.91 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'servicenow' },
    });

    const matches = screen.getByLabelText('Provider-backed technology matches');
    expect(within(matches).getAllByText('ServiceNow')).toHaveLength(1);
    expect(within(matches).getByText('Seamless')).toBeTruthy();
    expect(within(matches).queryByText('Apollo')).toBeNull();
    const assistant = screen.getByLabelText('Source-backed add assistant');
    expect(
      within(assistant).getByRole('button', {
        name: 'Accept source-backed match ServiceNow',
      }).textContent,
    ).toContain('91%');

    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    const staged = screen.getByLabelText('Recently staged stack entries');
    expect(within(staged).getByText('ServiceNow')).toBeTruthy();
    expect(within(staged).getByText('Seamless')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'ITSM',
          items: [
            { name: 'ServiceNow', source: 'manual:accepted:enrichment:seamless', confidence: 1 },
          ],
        },
      ]);
    });
  });

  it('keeps other attributed provider sources reviewable and labeled', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'Security',
          items: [{ name: 'Netskope', source: 'enrichment:partner_scan', confidence: 0.79 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'security:netskope',
          label: 'Security',
          item: { name: 'Netskope', source: 'enrichment:partner_scan', confidence: 0.79 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    expect(screen.getByLabelText('Technical stack sources').textContent).toContain(
      'Other sources',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));

    const sourceMap = screen.getByLabelText('Source readiness map');
    expect(within(sourceMap).getByText('Other sources')).toBeTruthy();
    expect(within(sourceMap).getByText('Attributed source')).toBeTruthy();
    expect(
      within(sourceMap).getByRole('button', {
        name: 'Review Other sources readiness and source suggestions',
      }),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'netskope' },
    });

    const review = screen.getByLabelText('Source-aware staging review');
    expect(within(review).getByText('Source-backed')).toBeTruthy();
    expect(within(review).getByText('Partner Scan')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    const staged = screen.getByLabelText('Recently staged stack entries');
    expect(within(staged).getByText('Netskope')).toBeTruthy();
    expect(within(staged).getByText('Partner Scan')).toBeTruthy();
    const proof = screen.getByLabelText('Accepted source-backed draft');
    expect(proof.textContent).toContain('1Partner Scan');

    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'Security',
          items: [
            {
              name: 'Netskope',
              source: 'manual:accepted:enrichment:partner_scan',
              confidence: 1,
            },
          ],
        },
      ]);
    });
  });

  it('guides typed technologies through source verification before staging', async () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'Datadog' },
    });

    const guide = screen.getByLabelText('Source verification guide');
    expect(within(guide).getByText('Verify before staging')).toBeTruthy();
    expect(guide.textContent).toContain('Apollo, Seamless, Tech Intel MCPs, and open data');

    fireEvent.click(
      within(guide).getByRole('button', {
        name: 'Verify typed technologies with Apollo MCP/API, Seamless MCP/API, Tech Intel MCPs, and open data',
      }),
    );

    await waitFor(() => expect(hookMocks.refreshStack).toHaveBeenCalledTimes(1));
  });

  it('shows manual-after-source-check outcome when provider pull has no typed match', async () => {
    hookMocks.refreshStack.mockResolvedValue({
      state: {
        companyKey: 'acme-north',
        manualStack: cockpit().technicalStack,
        providerStack: cockpit().technicalStack,
        effectiveStack: cockpit().technicalStack,
        suggestions: [],
        updatedAt: null,
      },
      providers: [
        {
          id: 'apollo',
          label: 'Apollo',
          status: 'queued',
          transport: 'mcp',
          message: 'Apollo company intelligence queued through the configured MCP lane.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'seamless',
          label: 'Seamless.AI',
          status: 'synced',
          transport: 'mcp',
          message: 'Seamless.AI MCP was checked but returned no technology signals.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'tech_intel',
          label: 'Tech Intel MCP',
          status: 'unavailable',
          transport: 'mcp',
          message: 'Tech Intel MCP was checked but returned no technology signals.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'open_data',
          label: 'Open data',
          status: 'synced',
          transport: 'open_data',
          message: 'Open company verification checked domain, logo, and public profile sources.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
      ],
    });

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.click(
      within(screen.getByLabelText('Source-backed add assistant')).getByRole('button', {
        name: 'Pull provider sources before adding technology',
      }),
    );
    await waitFor(() => expect(hookMocks.refreshStack).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'Datadog' },
    });

    const review = screen.getByLabelText('Source-aware staging review');
    expect(within(review).getByText('Datadog')).toBeTruthy();
    expect(within(review).getByText('Manual after source check')).toBeTruthy();
    expect(within(review).getByText('No current source match. Stage as DevOps.')).toBeTruthy();
    expect(review.textContent).toContain(
      'Exact Apollo, Seamless, configured Tech Intel MCP, and other source matches keep provider provenance.',
    );
  });

  it('explains that exact provider matches stage with source provenance', () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'Cloud',
          items: [{ name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'cloud:aws',
          label: 'Cloud',
          item: { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'AWS' },
    });

    const guide = screen.getByLabelText('Source verification guide');
    expect(within(guide).getByText('Stage source-backed')).toBeTruthy();
    expect(guide.textContent).toContain('AWS');
    expect(guide.textContent).toContain('Apollo');
    expect(guide.textContent).toContain('provider provenance');
  });

  it('pastes multiple vendors and auto-categorizes them before saving', async () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    expect(screen.getByLabelText('Technology bulk intake')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'Datadog, Okta' },
    });
    const preview = screen.getByLabelText('Technology add preview');
    expect(preview).toBeTruthy();
    expect(within(preview).getByText('Datadog')).toBeTruthy();
    expect(within(preview).getByText('DevOps')).toBeTruthy();
    expect(within(preview).getByText('Okta')).toBeTruthy();
    expect(within(preview).getByText('Security')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'DevOps',
          items: [{ name: 'Datadog', source: 'manual', confidence: 1 }],
        },
        {
          label: 'Security',
          items: [{ name: 'Okta', source: 'manual', confidence: 1 }],
        },
      ]);
    });
  });

  it('stages vendor intake with a fast keyboard submit before saving', async () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    const vendorInput = screen.getByLabelText('New stack vendor');
    fireEvent.change(vendorInput, {
      target: { value: 'Security: CrowdStrike' },
    });
    fireEvent.keyDown(vendorInput, { key: 'Enter', ctrlKey: true });

    const staged = screen.getByLabelText('Recently staged stack entries');
    expect(within(staged).getByText('CrowdStrike')).toBeTruthy();
    expect(within(staged).getByText('Security')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'Security',
          items: [{ name: 'CrowdStrike', source: 'manual', confidence: 1 }],
        },
      ]);
    });
  });

  it('clears staged bulk intake without changing the draft stack', () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'Security: Okta, CrowdStrike' },
    });

    expect(screen.getByLabelText('Technology add preview')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear vendor intake' }));

    expect((screen.getByLabelText('New stack vendor') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByLabelText('Technology add preview')).toBeNull();
    expect((screen.getByRole('button', { name: 'Add vendor' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText('Vendor 1 in Cloud') as HTMLInputElement).value).toBe('Azure');
  });

  it('honors category-prefixed paste entries before saving', async () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'Security: Okta, CrowdStrike\nData - Databricks' },
    });

    const summary = screen.getByLabelText('Technology intake summary');
    expect(summary.textContent).toContain('3 ready');
    expect(summary.textContent).toContain('2 categories');

    const preview = screen.getByLabelText('Technology add preview');
    expect(within(preview).getByText('Okta')).toBeTruthy();
    expect(within(preview).getAllByText('Security').length).toBeGreaterThanOrEqual(1);
    expect(within(preview).getByText('Databricks')).toBeTruthy();
    expect(within(preview).getByText('Data')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'Security',
          items: [
            { name: 'Okta', source: 'manual', confidence: 1 },
            { name: 'CrowdStrike', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'Data',
          items: [{ name: 'Databricks', source: 'manual', confidence: 1 }],
        },
      ]);
    });
  });

  it('adds dropped stack text through the bulk intake surface', async () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.drop(screen.getByLabelText('Technology bulk intake'), {
      dataTransfer: {
        files: [],
        items: [],
        types: ['text/plain'],
        getData: (type: string) =>
          type === 'text/plain' ? 'Security: CrowdStrike\nData: Databricks' : '',
      },
    });

    await waitFor(() => {
      expect((screen.getByLabelText('New stack vendor') as HTMLTextAreaElement).value).toContain(
        'CrowdStrike',
      );
    });

    const preview = screen.getByLabelText('Technology add preview');
    expect(within(preview).getByText('CrowdStrike')).toBeTruthy();
    expect(within(preview).getByText('Databricks')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'Security',
          items: [{ name: 'CrowdStrike', source: 'manual', confidence: 1 }],
        },
        {
          label: 'Data',
          items: [{ name: 'Databricks', source: 'manual', confidence: 1 }],
        },
      ]);
    });
  });

  it('imports a stack file through the bulk intake surface', async () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    const stackFile = new File(['Marketing: Marketo\nCommerce: Shopify'], 'stack.csv', {
      type: 'text/csv',
    });
    expect(screen.getByRole('button', { name: 'Import stack file' })).toBeTruthy();

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [stackFile] },
    });

    await waitFor(() => {
      expect((screen.getByLabelText('New stack vendor') as HTMLTextAreaElement).value).toContain(
        'Marketo',
      );
    });

    expect(screen.getByText('stack.csv')).toBeTruthy();
    const preview = screen.getByLabelText('Technology add preview');
    expect(within(preview).getByText('Marketo')).toBeTruthy();
    expect(within(preview).getByText('Marketing')).toBeTruthy();
    expect(within(preview).getByText('Shopify')).toBeTruthy();
    expect(within(preview).getByText('Commerce')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'Marketing',
          items: [{ name: 'Marketo', source: 'manual', confidence: 1 }],
        },
        {
          label: 'Commerce',
          items: [{ name: 'Shopify', source: 'manual', confidence: 1 }],
        },
      ]);
    });
  });

  it('imports provider-style source exports without staging headers or source columns', async () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: {
        value: 'technology,category,source\nServiceNow,ITSM,Seamless\nCloudflare,Security,BuiltWith MCP',
      },
    });

    const summary = screen.getByLabelText('Technology intake summary');
    expect(summary.textContent).toContain('2 ready');
    expect(summary.textContent).toContain('2 categories');

    const preview = screen.getByLabelText('Technology add preview');
    expect(within(preview).getByText('ServiceNow')).toBeTruthy();
    expect(within(preview).getByText('ITSM')).toBeTruthy();
    expect(within(preview).getByText('Cloudflare')).toBeTruthy();
    expect(within(preview).getByText('Security')).toBeTruthy();
    expect(within(preview).queryByText('technology')).toBeNull();
    expect(within(preview).queryByText('source')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'ITSM',
          items: [{ name: 'ServiceNow', source: 'manual', confidence: 1 }],
        },
        {
          label: 'Security',
          items: [{ name: 'Cloudflare', source: 'manual', confidence: 1 }],
        },
      ]);
    });
  });

  it('adds provider-detected technology inside edit mode with accepted provenance', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'Cloud',
          items: [{ name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'cloud:aws',
          label: 'Cloud',
          item: { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    expect(screen.getByLabelText('Detected source technologies')).toBeTruthy();
    expect(screen.getByLabelText('Provider stack metrics').textContent).toContain('1 to review');
    fireEvent.click(screen.getByRole('button', { name: 'Add AWS from Apollo' }));
    const staged = screen.getByLabelText('Recently staged stack entries');
    expect(within(staged).getByText('AWS')).toBeTruthy();
    expect(within(staged).getByText('Apollo')).toBeTruthy();
    expect(screen.getByLabelText('Provider stack metrics').textContent).toContain('0 to review');
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
            { name: 'AWS', source: 'manual:accepted:enrichment:apollo', confidence: 1 },
          ],
        },
      ]);
    });
  });

  it('adds Tech Intel MCP discoveries with accepted provenance', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'BuiltWith MCP technologies',
          items: [
            {
              name: 'Cloudflare',
              source: 'enrichment:tech_stack_mcp:builtwith_mcp',
              confidence: 0.86,
            },
          ],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'builtwith-mcp-technologies:cloudflare',
          label: 'BuiltWith MCP technologies',
          item: {
            name: 'Cloudflare',
            source: 'enrichment:tech_stack_mcp:builtwith_mcp',
            confidence: 0.86,
          },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    expect(screen.getAllByText('86%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('BuiltWith MCP')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Cloudflare from BuiltWith MCP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'BuiltWith MCP technologies',
          items: [
            {
              name: 'Cloudflare',
              source: 'manual:accepted:enrichment:tech_stack_mcp:builtwith_mcp',
              confidence: 1,
            },
          ],
        },
      ]);
    });
  });

  it('opens the editor review flow when a provider pull returns new stack suggestions', async () => {
    const refreshedState: TechnicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'Cloud',
          items: [{ name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'cloud:aws',
          label: 'Cloud',
          item: { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: '2026-06-16T12:00:00.000Z',
    };
    hookMocks.refreshStack.mockImplementation(async () => {
      hookMocks.technicalStackState = refreshedState;
      return {
        state: refreshedState,
        providers: [
          {
            id: 'apollo',
            label: 'Apollo',
            status: 'queued',
            transport: 'mcp',
            message: 'Apollo company intelligence queued; MCP is preferred when configured.',
            lastCheckedAt: '2026-06-17T12:00:00.000Z',
          },
          {
            id: 'seamless',
            label: 'Seamless.AI',
            status: 'synced',
            transport: 'mcp',
            message: 'Seamless.AI MCP returned company technology signals.',
            lastCheckedAt: '2026-06-17T12:00:00.000Z',
          },
          {
            id: 'tech_intel',
            label: 'Tech Intel MCP',
            status: 'synced',
            transport: 'mcp',
            message: 'Tech Intel MCP returned company technology signals.',
            lastCheckedAt: '2026-06-17T12:00:00.000Z',
          },
          {
            id: 'open_data',
            label: 'Open data',
            status: 'synced',
            transport: 'open_data',
            message: 'Open company verification checked domain, logo, and public profile sources.',
            lastCheckedAt: '2026-06-17T12:00:00.000Z',
          },
        ],
      };
    });

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Pull technical stack from Apollo MCP/API, Seamless MCP/API, Tech Intel MCPs, and open data',
      }),
    );

    await waitFor(() => expect(screen.getByLabelText('Provider source pull')).toBeTruthy());
    expect(screen.getByText('Provider pull')).toBeTruthy();
    expect(screen.getByLabelText('Detected source technologies')).toBeTruthy();
    const assistant = screen.getByLabelText('Source-backed add assistant');
    expect(within(assistant).getByText('Apollo')).toBeTruthy();
    expect(within(assistant).getByText('Seamless.AI')).toBeTruthy();
    expect(within(assistant).getByText('Tech Intel MCP')).toBeTruthy();
    expect(within(assistant).getByText('Open data')).toBeTruthy();
    const apolloSuggestion = screen.getByRole('button', { name: 'Add AWS from Apollo' });
    expect(apolloSuggestion).toBeTruthy();
    expect(within(apolloSuggestion).getByText('MCP')).toBeTruthy();
  });

  it('opens the complete provider review queue from compact card suggestions', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        {
          label: 'Cloud',
          items: [
            { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
            { name: 'Google Cloud', source: 'enrichment:apollo', confidence: 0.81 },
          ],
        },
        {
          label: 'ERP',
          items: [{ name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 }],
        },
        {
          label: 'ITSM',
          items: [{ name: 'ServiceNow', source: 'enrichment:tech_stack_mcp', confidence: 0.86 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'cloud:aws',
          label: 'Cloud',
          item: { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
        {
          id: 'cloud:google-cloud',
          label: 'Cloud',
          item: { name: 'Google Cloud', source: 'enrichment:apollo', confidence: 0.81 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
        {
          id: 'erp:sap',
          label: 'ERP',
          item: { name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
        {
          id: 'itsm:servicenow',
          label: 'ITSM',
          item: { name: 'ServiceNow', source: 'enrichment:tech_stack_mcp', confidence: 0.86 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    expect(screen.getByText('Provider updates')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review all' }));

    expect(screen.getByLabelText('Detected source technologies')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add ServiceNow from Tech Intel' })).toBeTruthy();
    const breakdown = screen.getByLabelText('Provider review breakdown');
    expect(breakdown.textContent).toContain('2Apollo');
    expect(breakdown.textContent).toContain('1Seamless');
    expect(breakdown.textContent).toContain('1Tech Intel');
    const scorecards = screen.getByLabelText('Source review scorecards');
    const apolloScorecard = within(scorecards).getByRole('button', {
      name: 'Review Apollo source scorecard',
    });
    expect(apolloScorecard.textContent).toContain('2Apollo');
    expect(apolloScorecard.textContent).toContain('82% avg');
    expect(apolloScorecard.textContent).toContain('Top AWS');
    const sourceMap = screen.getByLabelText('Source readiness map');
    const apolloRow = within(sourceMap).getByRole('button', {
      name: 'Review Apollo readiness and source suggestions',
    });
    expect(apolloRow.textContent).toContain('MCP/API pull');
    expect(apolloRow.textContent).toContain('Review ready');
    expect(apolloRow.textContent).toContain('Review 2');
    const techIntelRow = within(sourceMap).getByRole('button', {
      name: 'Review Tech Intel MCP readiness and source suggestions',
    });
    expect(techIntelRow.textContent).toContain('MCP first');
    expect(techIntelRow.textContent).toContain('Review 1');
    expect(screen.getByRole('tab', { name: /All\s*4/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Apollo\s*2/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Seamless\s*1/ })).toBeTruthy();
  });

  it('keeps source pulling available while editing the manual stack', async () => {
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    expect(screen.getByLabelText('Provider source pull')).toBeTruthy();
    expect(screen.getByText('Provider pull')).toBeTruthy();
    const assistant = screen.getByLabelText('Source-backed add assistant');
    expect(within(assistant).getByText('Source-first add')).toBeTruthy();
    expect(screen.getByLabelText('MCP provider coverage')).toBeTruthy();
    expect(within(assistant).getByText('Apollo')).toBeTruthy();
    expect(within(assistant).getByText('Seamless.AI')).toBeTruthy();
    expect(within(assistant).getByText('Tech Intel MCP')).toBeTruthy();
    expect(within(assistant).getByText('Open data')).toBeTruthy();
    expect(screen.getByLabelText('Provider stack metrics').textContent).toContain('0 to review');
    expect(
      screen.getByRole('button', { name: 'Pull source technologies from empty queue' }),
    ).toBeTruthy();
    fireEvent.click(
      within(assistant).getByRole('button', {
        name: 'Pull provider sources before adding technology',
      }),
    );

    await waitFor(() => expect(hookMocks.refreshStack).toHaveBeenCalledTimes(1));
  });

  it('preserves unsaved manual draft entries when provider sources are pulled mid-edit', async () => {
    hookMocks.refreshStack.mockResolvedValue({
      state: {
        companyKey: 'acme-north',
        manualStack: cockpit().technicalStack,
        providerStack: [
          ...cockpit().technicalStack,
          {
            label: 'ERP',
            items: [{ name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 }],
          },
        ],
        effectiveStack: cockpit().technicalStack,
        suggestions: [
          {
            id: 'erp:sap',
            label: 'ERP',
            item: { name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 },
            providerUpdatedAt: '2026-06-16T12:00:00.000Z',
          },
        ],
        updatedAt: null,
      },
      providers: [
        {
          id: 'seamless',
          label: 'Seamless.AI',
          status: 'synced',
          transport: 'mcp',
          message: 'Seamless.AI MCP returned company technology signals.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
      ],
    });

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.change(screen.getByLabelText('New stack category'), {
      target: { value: 'QA' },
    });
    fireEvent.change(screen.getByLabelText('New stack vendor'), {
      target: { value: 'Playwright Enterprise Grid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));

    expect((screen.getByLabelText('Vendor 1 in QA') as HTMLInputElement).value).toBe(
      'Playwright Enterprise Grid',
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Pull technical stack from Apollo MCP/API, Seamless MCP/API, Tech Intel MCPs, and open data',
      }),
    );

    await waitFor(() => expect(hookMocks.refreshStack).toHaveBeenCalledTimes(1));

    expect((screen.getByLabelText('Vendor 1 in QA') as HTMLInputElement).value).toBe(
      'Playwright Enterprise Grid',
    );
    expect(screen.getAllByText('Synced via MCP').length).toBeGreaterThanOrEqual(1);
  });

  it('bulk accepts detected provider technologies before saving', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'Cloud',
          items: [{ name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 }],
        },
        {
          label: 'ERP',
          items: [{ name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'cloud:aws',
          label: 'Cloud',
          item: { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
        {
          id: 'erp:sap',
          label: 'ERP',
          item: { name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };
    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept all source suggestions' }));
    const staged = screen.getByLabelText('Recently staged stack entries');
    expect(within(staged).getByText('AWS')).toBeTruthy();
    expect(within(staged).getByText('SAP')).toBeTruthy();
    const proof = screen.getByLabelText('Accepted source-backed draft');
    expect(proof.textContent).toContain('1Apollo');
    expect(proof.textContent).toContain('1Seamless');
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
            { name: 'AWS', source: 'manual:accepted:enrichment:apollo', confidence: 1 },
          ],
        },
        {
          label: 'ERP',
          items: [{ name: 'SAP', source: 'manual:accepted:enrichment:seamless', confidence: 1 }],
        },
      ]);
    });
  });

  it('filters provider suggestions and accepts the reviewed source slice', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'Cloud',
          items: [{ name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 }],
        },
        {
          label: 'ERP',
          items: [{ name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 }],
        },
        {
          label: 'ITSM',
          items: [{ name: 'ServiceNow', source: 'enrichment:tech_stack_mcp', confidence: 0.86 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'cloud:aws',
          label: 'Cloud',
          item: { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
        {
          id: 'erp:sap',
          label: 'ERP',
          item: { name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
        {
          id: 'itsm:servicenow',
          label: 'ITSM',
          item: { name: 'ServiceNow', source: 'enrichment:tech_stack_mcp', confidence: 0.86 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Review Seamless.AI source suggestions' }),
    );

    expect(screen.getByRole('button', { name: 'Add SAP from Seamless' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add AWS from Apollo' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Accept Seamless source suggestions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      expect(hookMocks.saveStack).toHaveBeenCalledWith([
        {
          label: 'Cloud',
          items: [
            { name: 'Azure', source: 'manual', confidence: 1 },
            { name: 'Snowflake', source: 'manual', confidence: 1 },
          ],
        },
        {
          label: 'ERP',
          items: [{ name: 'SAP', source: 'manual:accepted:enrichment:seamless', confidence: 1 }],
        },
      ]);
    });
  });

  it('signals when the provider review queue is visually capped', () => {
    const suggestions = Array.from({ length: 10 }, (_value, index) => ({
      id: `cloud:provider-${index}`,
      label: 'Cloud',
      item: {
        name: `Provider Stack ${index + 1}`,
        source: index % 2 === 0 ? 'enrichment:apollo' : 'enrichment:seamless',
        confidence: 0.82,
      },
      providerUpdatedAt: '2026-06-16T12:00:00.000Z',
    }));
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'Cloud',
          items: suggestions.map((suggestion) => suggestion.item),
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions,
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));

    expect(screen.getByText(/Showing first 8/)).toBeTruthy();
    expect(screen.getByText(/full current source filter/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept all source suggestions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Provider Stack 9 from Apollo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Provider Stack 8 from Seamless' })).toBeNull();
  });

  it('stages the full active provider filter when the review queue is visually capped', async () => {
    const suggestions = Array.from({ length: 10 }, (_value, index) => ({
      id: `cloud:provider-${index}`,
      label: 'Cloud',
      item: {
        name: `Provider Stack ${index + 1}`,
        source: index % 2 === 0 ? 'enrichment:apollo' : 'enrichment:seamless',
        confidence: 0.82,
      },
      providerUpdatedAt: '2026-06-16T12:00:00.000Z',
    }));
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        ...cockpit().technicalStack,
        {
          label: 'Cloud',
          items: suggestions.map((suggestion) => suggestion.item),
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions,
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit technical stack' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept all source suggestions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save technical stack' }));

    await waitFor(() => {
      const savedStack = hookMocks.saveStack.mock.calls[0]?.[0] as TechnicalStackCategory[];
      const savedNames = savedStack.flatMap((category) => category.items.map((item) => item.name));
      expect(savedNames).toContain('Provider Stack 9');
      expect(savedNames).toContain('Provider Stack 8');
      expect(savedNames).toContain('Provider Stack 10');
      expect(savedNames.filter((name) => name.startsWith('Provider Stack'))).toHaveLength(10);
    });
  });

  it('pulls provider sources and shows the refresh posture', async () => {
    hookMocks.refreshStack.mockResolvedValue({
      state: {
        companyKey: 'acme-north',
        manualStack: cockpit().technicalStack,
        providerStack: [
          ...cockpit().technicalStack,
          {
            label: 'Seamless technologies',
            items: [{ name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 }],
          },
        ],
        effectiveStack: [
          ...cockpit().technicalStack,
          {
            label: 'Seamless technologies',
            items: [{ name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 }],
          },
        ],
        suggestions: [],
        updatedAt: null,
      },
      providers: [
        {
          id: 'apollo',
          label: 'Apollo',
          status: 'queued',
          transport: 'mcp',
          message: 'Apollo company intelligence queued; MCP is preferred when configured.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'seamless',
          label: 'Seamless.AI',
          status: 'synced',
          transport: 'api',
          message: 'Seamless.AI returned company technology signals.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'tech_intel',
          label: 'Tech Intel MCP',
          status: 'disabled',
          transport: null,
          message: 'Technology intelligence MCP is not configured.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'open_data',
          label: 'Open data',
          status: 'synced',
          transport: 'open_data',
          message: 'Open company verification checked domain, logo, and public profile sources.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
      ],
    });

    render(<TechStackCard cockpit={cockpit()} />);

    expect(screen.getByText('Pull sources')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Pull technical stack from Apollo MCP/API, Seamless MCP/API, Tech Intel MCPs, and open data',
      }),
    );

    await waitFor(() => expect(hookMocks.refreshStack).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Technical stack sources')).toBeTruthy();
    expect(screen.getByText('Queued MCP')).toBeTruthy();
    expect(screen.getAllByText('Synced').length).toBeGreaterThanOrEqual(1);

    expect(screen.getByLabelText('Provider source pull')).toBeTruthy();
    const sourceMap = screen.getByLabelText('Source readiness map');
    expect(within(sourceMap).getByText('MCP first')).toBeTruthy();
    expect(within(sourceMap).getByText('API fallback')).toBeTruthy();
    expect(within(sourceMap).getByText('MCP required')).toBeTruthy();
    expect(within(sourceMap).getByText('Valid open data')).toBeTruthy();
    expect(within(sourceMap).getByText('Polling')).toBeTruthy();
    expect(within(sourceMap).getByText('Connect')).toBeTruthy();

    const assistant = screen.getByLabelText('Source-backed add assistant');
    expect(within(assistant).getByText('Queued via MCP')).toBeTruthy();
    expect(within(assistant).getByText('Synced via API')).toBeTruthy();
    expect(within(assistant).getByText('not configured')).toBeTruthy();
    expect(within(assistant).getByText('Valid open data')).toBeTruthy();
    expect(within(assistant).getAllByText('No new deltas').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps refetching while an Apollo MCP/API source pull is queued', async () => {
    vi.useFakeTimers();
    hookMocks.refreshStack.mockResolvedValue({
      state: {
        companyKey: 'acme-north',
        manualStack: cockpit().technicalStack,
        providerStack: cockpit().technicalStack,
        effectiveStack: cockpit().technicalStack,
        suggestions: [],
        updatedAt: null,
      },
      providers: [
        {
          id: 'apollo',
          label: 'Apollo',
          status: 'queued',
          transport: 'mcp',
          message: 'Apollo company intelligence queued through the configured MCP lane.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'seamless',
          label: 'Seamless.AI',
          status: 'disabled',
          transport: null,
          message: 'Seamless.AI MCP/API credentials are not configured.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'tech_intel',
          label: 'Tech Intel MCP',
          status: 'disabled',
          transport: null,
          message: 'Technology intelligence MCP is not configured.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
        {
          id: 'open_data',
          label: 'Open data',
          status: 'synced',
          transport: 'open_data',
          message: 'Open company verification checked domain, logo, and public profile sources.',
          lastCheckedAt: '2026-06-17T12:00:00.000Z',
        },
      ],
    });

    try {
      render(<TechStackCard cockpit={cockpit()} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'Pull technical stack from Apollo MCP/API, Seamless MCP/API, Tech Intel MCPs, and open data',
          }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText('Queued MCP')).toBeTruthy();
      expect(hookMocks.refetchTechnicalStack).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });

      expect(hookMocks.refetchTechnicalStack).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts and dismisses provider stack suggestions', async () => {
    hookMocks.technicalStackState = {
      companyKey: 'acme-north',
      manualStack: cockpit().technicalStack,
      providerStack: [
        {
          label: 'Cloud',
          items: [{ name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 }],
        },
      ],
      effectiveStack: cockpit().technicalStack,
      suggestions: [
        {
          id: 'cloud:aws',
          label: 'Cloud',
          item: { name: 'AWS', source: 'enrichment:apollo', confidence: 0.82 },
          providerUpdatedAt: '2026-06-16T12:00:00.000Z',
        },
      ],
      updatedAt: null,
    };

    render(<TechStackCard cockpit={cockpit()} />);

    expect(screen.getByRole('button', { name: 'Review all' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept AWS' }));
    await waitFor(() => expect(hookMocks.acceptSuggestion).toHaveBeenCalledWith('cloud:aws'));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss AWS' }));
    await waitFor(() => expect(hookMocks.dismissSuggestion).toHaveBeenCalledWith('cloud:aws'));
  });
});
