import type { CrmConnector, OpenDataSignal, SourceAttribution } from '@bidstack/shared';

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
}: OpenSignalInput): Promise<OpenDataSignal[]> {
  const signals: OpenDataSignal[] = [];
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

export function buildConnectorCatalog(now = new Date()): CrmConnector[] {
  const lastCheckedAt = now.toISOString();
  const credentialStatus = (envName: string): CrmConnector['status'] =>
    process.env[envName] ? 'healthy' : 'disabled';
  const credentialMessage = (envName: string, enabled: string, disabled: string) =>
    process.env[envName] ? enabled : `${disabled} (${envName} not set)`;

  return [
    {
      id: 'sec-edgar',
      name: 'SEC EDGAR',
      category: 'company',
      kind: 'open_api',
      status: 'healthy',
      requiresCredential: false,
      sourceUrl: 'https://data.sec.gov/',
      docsUrl: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces',
      lastCheckedAt,
      message: 'Open company tickers, submissions, and company facts for public issuers.',
      capabilities: ['public-company lookup', 'CIK mapping', 'company facts'],
    },
    {
      id: 'wikidata-wikimedia',
      name: 'Wikidata + Wikimedia Commons',
      category: 'company',
      kind: 'open_api',
      status: 'healthy',
      requiresCredential: false,
      sourceUrl: 'https://www.wikidata.org/wiki/Wikidata:Data_access',
      docsUrl: 'https://www.mediawiki.org/wiki/API:Main_page',
      lastCheckedAt,
      message: 'Open company profiles, official websites, logos, and images without credentials.',
      capabilities: ['company profile lookup', 'official website', 'logo lookup', 'images'],
    },
    {
      id: 'usaspending',
      name: 'USAspending',
      category: 'procurement',
      kind: 'open_api',
      status: 'healthy',
      requiresCredential: false,
      sourceUrl: 'https://api.usaspending.gov/',
      docsUrl: 'https://api.usaspending.gov/docs/',
      lastCheckedAt,
      message: 'Open federal award intelligence for account and funding signals.',
      capabilities: ['award search', 'recipient intelligence', 'agency context'],
    },
    {
      id: 'tradingview-widgets',
      name: 'TradingView Widgets',
      category: 'market',
      kind: 'official_widget',
      status: 'healthy',
      requiresCredential: false,
      sourceUrl: 'https://www.tradingview.com/widget-docs/',
      docsUrl: 'https://www.tradingview.com/widget-docs/faq/data/',
      lastCheckedAt,
      message: 'Official embeddable widgets; market data is not exposed as a raw public API.',
      capabilities: ['symbol overview widget', 'financial widget', 'technical-analysis widget'],
    },
    {
      id: 'apollo-organizations',
      name: 'Apollo Organizations',
      category: 'people',
      kind: 'credentialed_api',
      status: process.env.APOLLO_MCP_URL || process.env.APOLLO_API_KEY ? 'healthy' : 'disabled',
      requiresCredential: true,
      sourceUrl: 'https://api.apollo.io/',
      docsUrl: 'https://docs.apollo.io/docs/apollo-mcp-server-documentation',
      lastCheckedAt,
      message: process.env.APOLLO_MCP_URL
        ? 'Apollo MCP company search enabled; enrichment credit tools remain opt-in.'
        : credentialMessage(
            'APOLLO_API_KEY',
            'Apollo REST organization enrichment enabled; this can consume credits.',
            'Ready for Apollo MCP or REST credentials',
          ),
      capabilities: [
        'company search',
        'firmographics',
        'buying intent',
        'hiring signals',
        'leadership signals without emails or phone numbers',
      ],
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
        'Federal opportunity importer enabled.',
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
        'UK company registry verification enabled.',
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
      message: credentialMessage(
        'BRANDFETCH_API_KEY',
        'Logo and brand asset lookup enabled.',
        'Favicon and initials fallback active',
      ),
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
      message: credentialMessage(
        'LOGO_DEV_TOKEN',
        'Primary logo lookup enabled.',
        'Favicon and initials fallback active',
      ),
      capabilities: ['logo lookup', 'domain matching', 'fallback images'],
    },
    {
      id: 'gmail',
      name: 'Gmail',
      category: 'people',
      kind: 'credentialed_api',
      status: credentialStatus('GMAIL_CLIENT_ID'),
      requiresCredential: true,
      sourceUrl: 'https://mail.google.com/',
      docsUrl: 'https://developers.google.com/gmail/api',
      lastCheckedAt,
      message: credentialMessage(
        'GMAIL_CLIENT_ID',
        'Gmail connection active.',
        'Connect Gmail account to sync user mailbox.',
      ),
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
        'Slack connection active.',
        'Connect Slack workspace for DMs and alerts.',
      ),
      capabilities: ['chat write', 'channels read', 'user mapping'],
    },
    {
      id: 'microsoft',
      name: 'Microsoft Outlook',
      category: 'people',
      kind: 'credentialed_api',
      status: credentialStatus('MICROSOFT_GRAPH_CLIENT_ID'),
      requiresCredential: true,
      sourceUrl: 'https://outlook.live.com/',
      docsUrl: 'https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview',
      lastCheckedAt,
      message: credentialMessage(
        'MICROSOFT_GRAPH_CLIENT_ID',
        'Outlook Mail connection active.',
        'Connect Microsoft 365 to sync Outlook mailbox.',
      ),
      capabilities: ['email sync', 'send email', 'activity history'],
    },
  ];
}

export async function fetchSecTickerSignal(
  ticker: string,
  now = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<OpenDataSignal | null> {
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
    confidence: 0.93,
    sourceAttribution: [
      attribution({
        source: 'sec_edgar',
        label: 'SEC EDGAR company tickers',
        sourceUrl: 'https://www.sec.gov/files/company_tickers.json',
        fetchedAt: now,
        confidence: 0.93,
        providerMetadata: { cik, ticker },
      }),
    ],
    metadata: { cik, ticker, companyTitle: match.title },
  };
}

export async function fetchUsaSpendingSignals(
  query: string,
  now = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<OpenDataSignal[]> {
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
        ? `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : 'undisclosed value';

    return {
      id: `usaspending:${awardId}`,
      provider: 'USAspending',
      title: `${recipient} award signal`,
      summary: `${agency} reported ${amountSummary} tied to "${query}".`,
      url: 'https://www.usaspending.gov/search/',
      observedAt: now.toISOString(),
      confidence: 0.86,
      sourceAttribution: [
        attribution({
          source: 'usaspending',
          label: 'USAspending award search',
          sourceUrl: 'https://api.usaspending.gov/api/v2/search/spending_by_award/',
          fetchedAt: now,
          confidence: 0.86,
          providerMetadata: { awardId, query },
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

function tradingViewWidgetSignal(symbol: string, now: Date): OpenDataSignal {
  return {
    id: `tradingview-widget:${symbol}`,
    provider: 'TradingView Widgets',
    title: `${symbol} market panel ready`,
    summary:
      'TradingView can render an official market widget in the CRM; raw quote data must come from a licensed market-data API.',
    url: 'https://www.tradingview.com/widget-docs/',
    observedAt: now.toISOString(),
    confidence: 0.8,
    sourceAttribution: [
      attribution({
        source: 'tradingview_widgets',
        label: 'TradingView official widget documentation',
        sourceUrl: 'https://www.tradingview.com/widget-docs/',
        fetchedAt: now,
        confidence: 0.8,
        providerMetadata: { symbol },
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
      headers.set('User-Agent', process.env.SEC_USER_AGENT ?? 'BidStack360 contact@example.com');
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
  confidence,
  providerMetadata,
}: {
  source: string;
  label: string;
  sourceUrl: string;
  fetchedAt: Date;
  confidence: number;
  providerMetadata: Record<string, unknown>;
}): SourceAttribution {
  return {
    source,
    label,
    sourceUrl,
    fetchedAt: fetchedAt.toISOString(),
    confidence,
    providerMetadata,
  };
}
