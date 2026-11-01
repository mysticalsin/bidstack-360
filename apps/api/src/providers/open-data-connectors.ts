import type { CrmConnector, OpenDataSignal, SourceAttribution } from '@bidstack/shared';

type UnscoredAttribution = Omit<SourceAttribution, 'confidence'> & { confidence: null };
type UnscoredOpenDataSignal = Omit<OpenDataSignal, 'confidence' | 'sourceAttribution'> & {
  confidence: null;
  sourceAttribution: UnscoredAttribution[];
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface OpenSignalInput {
  query?: string;
  ticker?: string;
  now?: Date;
  fetchImpl?: FetchLike;
}

interface SecTickerRow {
  cik_str?: number;
  ticker?: string;
  title?: string;
}

interface UsaSpendingAwardRow {
  ['Award ID']?: string;
  ['Recipient Name']?: string;
  ['Award Amount']?: number;
  ['Start Date']?: string;
  ['End Date']?: string;
  ['Awarding Agency']?: string;
  AwardingAgency?: string;
  RecipientName?: string;
  AwardAmount?: number;
  generated_unique_award_id?: string;
  id?: string;
}

export async function buildOpenDataSignals({
  query,
  ticker,
  now = new Date(),
  fetchImpl = fetch,
}: OpenSignalInput): Promise<UnscoredOpenDataSignal[]> {
  const signals: UnscoredOpenDataSignal[] = [];
  const normalizedQuery = query?.trim();
  const normalizedTicker = ticker?.trim().toUpperCase();

  if (normalizedTicker) {
    if (!normalizedTicker.includes(':')) {
      try {
        const secSignal = await fetchSecTickerSignal(normalizedTicker, now, fetchImpl);
        if (secSignal) signals.push(secSignal);
      } catch {
        // Live public APIs can rate-limit or be temporarily unavailable. The
        // connector status still renders so users see the source without us
        // fabricating a market or legal-entity signal.
      }
    }
    signals.push(tradingViewWidgetSignal(normalizedTicker, now));
  }

  if (normalizedQuery && normalizedQuery.length >= 3) {
    try {
      signals.push(...(await fetchUsaSpendingSignals(normalizedQuery, now, fetchImpl)));
    } catch {
      // Keep the cockpit usable if USAspending is slow or unreachable.
    }
  }

  return signals;
}

const NOT_A_LIVE_PROBE = 'Not a live probe.';

export function buildConnectorCatalog(now = new Date()): CrmConnector[] {
  const lastCheckedAt = now.toISOString();
  // An env var means the connector is configured. It does not mean the
  // provider answered. Healthy is reserved for a live probe.
  const credentialStatus = (envName: string): CrmConnector['status'] =>
    process.env[envName] ? 'unverified' : 'disabled';
  const credentialMessage = (envName: string, disabled: string) =>
    process.env[envName]
      ? `${envName} is set. ${NOT_A_LIVE_PROBE}`
      : `${disabled} (${envName} not set)`;
  const registered = (description: string) => `${description} ${NOT_A_LIVE_PROBE}`;
  const sillageConfigured = Boolean(process.env.SILLAGE_MCP_URL || process.env.SILLAGE_API_KEY);
  const sillageStatus: CrmConnector['status'] = sillageConfigured ? 'unverified' : 'disabled';
  const sillageMessage = sillageConfigured
    ? `Sillage credentials are set. ${NOT_A_LIVE_PROBE}`
    : 'Set SILLAGE_API_KEY or SILLAGE_MCP_URL to enable';
  const apolloMcpConfigured = Boolean(process.env.APOLLO_MCP_URL && process.env.APOLLO_MCP_BEARER_TOKEN);
  const apolloMcpPartial = Boolean(process.env.APOLLO_MCP_URL || process.env.APOLLO_MCP_BEARER_TOKEN);
  const apolloConfigured = apolloMcpConfigured || Boolean(process.env.APOLLO_API_KEY);
  const apolloStatus: CrmConnector['status'] = apolloConfigured
    ? 'unverified'
    : apolloMcpPartial
      ? 'degraded'
      : 'disabled';
  const apolloMessage = apolloConfigured
    ? `Apollo credentials are set. ${NOT_A_LIVE_PROBE}`
    : apolloMcpPartial
      ? 'Apollo MCP is partially configured; set both APOLLO_MCP_URL and APOLLO_MCP_BEARER_TOKEN.'
      : credentialMessage('APOLLO_API_KEY', 'Ready for Apollo MCP or REST credentials');

  return [
    {
      id: 'sec-edgar',
      name: 'SEC EDGAR',
      category: 'company',
      kind: 'open_api',
      status: 'unverified',
      requiresCredential: false,
      sourceUrl: 'https://data.sec.gov/',
      docsUrl: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces',
      lastCheckedAt,
      message: registered('Open company tickers, submissions, and company facts for public issuers.'),
      capabilities: ['public-company lookup', 'CIK mapping', 'company facts'],
    },
    {
      id: 'wikidata-wikimedia',
      name: 'Wikidata + Wikimedia Commons',
      category: 'company',
      kind: 'open_api',
      status: 'unverified',
      requiresCredential: false,
      sourceUrl: 'https://www.wikidata.org/wiki/Wikidata:Data_access',
      docsUrl: 'https://www.mediawiki.org/wiki/API:Main_page',
      lastCheckedAt,
      message: registered(
        'Open company profiles, official websites, logos, and images without credentials.',
      ),
      capabilities: ['company profile lookup', 'official website', 'logo lookup', 'images'],
    },
    {
      id: 'usaspending',
      name: 'USAspending',
      category: 'procurement',
      kind: 'open_api',
      status: 'unverified',
      requiresCredential: false,
      sourceUrl: 'https://api.usaspending.gov/',
      docsUrl: 'https://api.usaspending.gov/docs/',
      lastCheckedAt,
      message: registered('Open federal award intelligence for account and funding signals.'),
      capabilities: ['award search', 'recipient intelligence', 'agency context'],
    },
    {
      id: 'tradingview-widgets',
      name: 'TradingView Widgets',
      category: 'market',
      kind: 'official_widget',
      status: 'unverified',
      requiresCredential: false,
      sourceUrl: 'https://www.tradingview.com/widget-docs/',
      docsUrl: 'https://www.tradingview.com/widget-docs/faq/data/',
      lastCheckedAt,
      message: registered(
        'Official embeddable widgets; market data is not exposed as a raw public API.',
      ),
      capabilities: ['symbol overview widget', 'financial widget', 'technical-analysis widget'],
    },
    {
      id: 'apollo-organizations',
      name: 'Apollo Organizations',
      category: 'company',
      kind: 'credentialed_api',
      status: apolloStatus,
      requiresCredential: true,
      sourceUrl: 'https://api.apollo.io/',
      docsUrl: 'https://docs.apollo.io/docs/apollo-mcp',
      lastCheckedAt,
      message: apolloMessage,
      capabilities: [
        'company search',
        'firmographics',
        'buying intent',
        'hiring signals',
        'news and funding signals with public-news cross-check',
        'open job posting counts without phone numbers or contact leads',
      ],
    },
    {
      id: 'sillage',
      name: 'Sillage Buying Signals',
      // 'ai' is the closest fit in the shared CrmConnector category enum
      // (no separate 'intelligence' category exists) — matches how other
      // AI-signal connectors in this catalog would be classified.
      category: 'ai',
      kind: 'credentialed_api',
      status: sillageStatus,
      requiresCredential: true,
      sourceUrl: 'https://getsillage.com/',
      docsUrl: 'https://getsillage.com/',
      lastCheckedAt,
      message: sillageMessage,
      capabilities: ['Buying-intent signals', 'Account triggers'],
    },
    {
      id: 'sam-gov',
      name: 'SAM.gov',
      category: 'procurement',
      kind: 'credentialed_api',
      status: credentialStatus('SAM_GOV_API_KEY'),
      requiresCredential: true,
      sourceUrl: 'https://sam.gov/',
      docsUrl: 'https://open.gsa.gov/api/get-opportunities-public-api/',
      lastCheckedAt,
      message: credentialMessage(
        'SAM_GOV_API_KEY',
        'Official opportunity API requires an API key',
      ),
      capabilities: ['opportunity search', 'notice metadata', 'federal bid import'],
    },
    {
      id: 'companies-house',
      name: 'Companies House',
      category: 'company',
      kind: 'credentialed_api',
      status: credentialStatus('COMPANIES_HOUSE_API_KEY'),
      requiresCredential: true,
      sourceUrl: 'https://api.company-information.service.gov.uk/',
      docsUrl: 'https://developer.company-information.service.gov.uk/overview',
      lastCheckedAt,
      message: credentialMessage(
        'COMPANIES_HOUSE_API_KEY',
        'UK registry lookup requires an API key',
      ),
      capabilities: ['legal name lookup', 'officer data', 'filing status'],
    },
    {
      id: 'brandfetch',
      name: 'Brandfetch',
      category: 'logo',
      kind: 'credentialed_api',
      status: credentialStatus('BRANDFETCH_API_KEY'),
      requiresCredential: true,
      sourceUrl: 'https://api.brandfetch.io/',
      docsUrl: 'https://docs.brandfetch.com/docs/logo-link',
      lastCheckedAt,
      message: credentialMessage('BRANDFETCH_API_KEY', 'Favicon and initials fallback active'),
      capabilities: ['logo lookup', 'brand colors', 'domain matching'],
    },
    {
      id: 'logo-dev',
      name: 'Logo.dev',
      category: 'logo',
      kind: 'credentialed_api',
      status: credentialStatus('LOGO_DEV_TOKEN'),
      requiresCredential: true,
      sourceUrl: 'https://www.logo.dev/',
      docsUrl: 'https://www.logo.dev/docs/logo-images/introduction',
      lastCheckedAt,
      message: credentialMessage('LOGO_DEV_TOKEN', 'Favicon and initials fallback active'),
      capabilities: ['logo lookup', 'domain matching', 'fallback images'],
    },
    {
      id: 'gmail',
      name: 'Gmail',
      category: 'people',
      kind: 'credentialed_api',
      // A client id is configuration, not a live mailbox. Gmail stays available
      // in this version; Microsoft is the official account.
      status: process.env.GMAIL_CLIENT_ID ? 'unverified' : 'disabled',
      requiresCredential: true,
      sourceUrl: 'https://mail.google.com/',
      docsUrl: 'https://developers.google.com/gmail/api',
      lastCheckedAt,
      message: process.env.GMAIL_CLIENT_ID
        ? 'Gmail stays available in this version. The client id is configured; a person still has to connect their Google mailbox.'
        : 'Gmail stays available in this version. Set GMAIL_CLIENT_ID before someone can connect a Google mailbox.',
      capabilities: ['email sync', 'send email', 'activity history'],
    },
    {
      id: 'slack',
      name: 'Slack',
      category: 'people',
      kind: 'credentialed_api',
      status: credentialStatus('SLACK_CLIENT_ID'),
      requiresCredential: true,
      sourceUrl: 'https://slack.com/',
      docsUrl: 'https://api.slack.com/',
      lastCheckedAt,
      message: credentialMessage(
        'SLACK_CLIENT_ID',
        'Connect Slack workspace for DMs and alerts.',
      ),
      capabilities: ['chat write', 'channels read', 'user mapping'],
    },
    {
      id: 'microsoft',
      name: 'Microsoft Outlook',
      category: 'people',
      kind: 'credentialed_api',
      status: process.env.MICROSOFT_GRAPH_CLIENT_ID ? 'unverified' : 'disabled',
      requiresCredential: true,
      sourceUrl: 'https://outlook.live.com/',
      docsUrl: 'https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview',
      lastCheckedAt,
      message: process.env.MICROSOFT_GRAPH_CLIENT_ID
        ? 'Microsoft is the official account. The client id is configured; Outlook connects when a person signs in with Microsoft.'
        : 'Microsoft is the official account. Set MICROSOFT_GRAPH_CLIENT_ID before someone can connect Outlook.',
      capabilities: ['email sync', 'send email', 'activity history'],
    },
  ];
}

export async function fetchSecTickerSignal(
  ticker: string,
  now = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<UnscoredOpenDataSignal | null> {
  const rows = await fetchJson<Record<string, SecTickerRow>>(
    'https://www.sec.gov/files/company_tickers.json',
    fetchImpl,
    'SEC EDGAR company ticker lookup',
  );
  const match = Object.values(rows).find((row) => row.ticker?.toUpperCase() === ticker);
  if (!match?.title || !match.cik_str) return null;
  const cik = match.cik_str.toString().padStart(10, '0');

  return {
    id: `sec-edgar:${ticker}`,
    provider: 'SEC EDGAR',
    title: `${match.title} is mapped to ${ticker}`,
    summary: `SEC EDGAR resolves ${ticker} to CIK ${cik}; this can feed legal entity and public-company verification.`,
    url: `https://data.sec.gov/submissions/CIK${cik}.json`,
    observedAt: now.toISOString(),
    confidence: null,
    sourceAttribution: [
      attribution({
        source: 'sec_edgar',
        label: 'SEC EDGAR company tickers',
        sourceUrl: 'https://www.sec.gov/files/company_tickers.json',
        fetchedAt: now,
        providerMetadata: { cik, ticker, confidenceBasis: 'not_scored' },
      }),
    ],
    metadata: { cik, ticker, companyTitle: match.title },
  };
}

export async function fetchUsaSpendingSignals(
  query: string,
  now = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<UnscoredOpenDataSignal[]> {
  const endDate = now.toISOString().slice(0, 10);
  const response = await fetchJson<{ results?: UsaSpendingAwardRow[] }>(
    'https://api.usaspending.gov/api/v2/search/spending_by_award/',
    fetchImpl,
    'USAspending award search',
    {
      method: 'POST',
      body: JSON.stringify({
        filters: {
          keywords: [query],
          time_period: [{ start_date: '2024-01-01', end_date: endDate }],
        },
        fields: [
          'Award ID',
          'Recipient Name',
          'Award Amount',
          'Start Date',
          'End Date',
          'Awarding Agency',
        ],
        page: 1,
        limit: 3,
        sort: 'Award Amount',
        order: 'desc',
      }),
    },
  );

  return (response.results ?? []).slice(0, 3).map((row, index) => {
    const awardId = row['Award ID'] ?? row.generated_unique_award_id ?? row.id ?? `award-${index}`;
    const recipient = row['Recipient Name'] ?? row.RecipientName ?? query;
    const agency = row['Awarding Agency'] ?? row.AwardingAgency ?? 'Unknown agency';
    const amount = row['Award Amount'] ?? row.AwardAmount ?? null;
    const amountSummary =
      typeof amount === 'number'
        ? `${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD reported by USAspending`
        : 'amount not disclosed by USAspending';

    return {
      id: `usaspending:${awardId}`,
      provider: 'USAspending',
      title: `${recipient} award signal`,
      summary: `${agency} reported ${amountSummary} tied to "${query}".`,
      url: 'https://www.usaspending.gov/search/',
      observedAt: now.toISOString(),
      confidence: null,
      sourceAttribution: [
        attribution({
          source: 'usaspending',
          label: 'USAspending award search',
          sourceUrl: 'https://api.usaspending.gov/api/v2/search/spending_by_award/',
          fetchedAt: now,
          providerMetadata: { awardId, query, confidenceBasis: 'not_scored' },
        }),
      ],
      metadata: {
        awardId,
        recipient,
        agency,
        awardAmount: amount,
        startDate: row['Start Date'],
        endDate: row['End Date'],
      },
    };
  });
}

function tradingViewWidgetSignal(symbol: string, now: Date): UnscoredOpenDataSignal {
  return {
    id: `tradingview-widget:${symbol}`,
    provider: 'TradingView Widgets',
    title: `${symbol} market panel ready`,
    summary:
      'TradingView can render an official market widget in the CRM; raw quote data must come from a licensed market-data API.',
    url: 'https://www.tradingview.com/widget-docs/',
    observedAt: now.toISOString(),
    confidence: null,
    sourceAttribution: [
      attribution({
        source: 'tradingview_widgets',
        label: 'TradingView official widget documentation',
        sourceUrl: 'https://www.tradingview.com/widget-docs/',
        fetchedAt: now,
        providerMetadata: { symbol, confidenceBasis: 'not_scored' },
      }),
    ],
    metadata: { symbol, integrationMode: 'official_widget' },
  };
}

async function fetchJson<T>(
  url: string,
  fetchImpl: FetchLike,
  label: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', process.env.SEC_USER_AGENT ?? 'Polo PreSales contact@example.com');
    }
    const res = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers,
    });
    if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function attribution({
  source,
  label,
  sourceUrl,
  fetchedAt,
  providerMetadata,
}: {
  source: string;
  label: string;
  sourceUrl: string;
  fetchedAt: Date;
  providerMetadata: Record<string, unknown>;
}): UnscoredAttribution {
  return {
    source,
    label,
    sourceUrl,
    fetchedAt: fetchedAt.toISOString(),
    confidence: null,
    providerMetadata,
  };
}
