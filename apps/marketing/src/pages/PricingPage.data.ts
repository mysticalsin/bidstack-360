/**
 * PricingPage.data.ts — Static content for the Pricing page.
 *
 * Extracted from PricingPage.tsx (BS-R1 file-size refactor).
 * Keep these prices + feature lists in sync with the Wave 2 Stripe billing config.
 */

export interface Tier {
  name: string;
  tagline: string;
  monthly: number | 'custom';
  annual: number | 'custom';
  currency: string;
  cadence: string;
  cta: { label: string; href: string };
  highlight?: boolean;
  features: string[];
  excluded?: string[];
}

export const TIERS: Tier[] = [
  {
    name: 'Free',
    tagline: 'For solo founders and pilots.',
    monthly: 0,
    annual: 0,
    currency: '€',
    cadence: 'forever',
    cta: { label: 'Start free', href: 'https://app.bidstack.dev/sign-up' },
    features: [
      'Up to 3 users',
      '100 active opportunities',
      'Kanban + list views',
      'Basic dashboards',
      'Email & chat support',
      'GDPR data export',
      'Single workspace',
    ],
    excluded: [
      'AI co-pilots',
      'Custom workflows',
      'API access',
      'SSO',
      'Audit log retention beyond 30 days',
    ],
  },
  {
    name: 'Pro',
    tagline: 'For growing bid teams.',
    monthly: 39,
    annual: 31,
    currency: '€',
    cadence: 'per user / month',
    cta: { label: 'Start 14-day trial', href: 'https://app.bidstack.dev/sign-up?plan=pro' },
    highlight: true,
    features: [
      'Unlimited users',
      'Unlimited opportunities',
      'AI co-pilots (bid qualifier, proposal drafter, researcher)',
      'Custom pipeline stages',
      'Workflow builder',
      'Approval routes',
      'Document templates',
      'Slack + Microsoft Teams integration',
      'API + webhooks',
      'Priority support (4-hour SLA)',
      'Audit log (1 year retention)',
      'Multi-workspace',
    ],
    excluded: ['SSO + SCIM', 'Custom data residency', 'Named CSM', '99.95% SLA'],
  },
  {
    name: 'Enterprise',
    tagline: 'For organisations with procurement.',
    monthly: 'custom',
    annual: 'custom',
    currency: '',
    cadence: 'volume pricing',
    cta: { label: 'Contact sales', href: 'mailto:sales@bidstack.dev?subject=Enterprise%20pricing' },
    features: [
      'Everything in Pro',
      'SSO (SAML 2.0, OIDC)',
      'SCIM 2.0 user provisioning',
      'Custom data residency (EU, US, UK)',
      'Bring-your-own-model (Anthropic, Mistral, Azure OpenAI)',
      'Named Customer Success Manager',
      '99.95% uptime SLA',
      'Custom contractual terms',
      'On-premise MCP server option',
      'Dedicated VPC peering',
      'Quarterly security reviews',
      'Audit log (7+ year retention)',
    ],
  },
];

export const FEATURE_MATRIX: Array<{
  section: string;
  rows: Array<[string, string, string, string]>;
}> = [
  {
    section: 'Pipeline & deals',
    rows: [
      ['Kanban + list views', '✓', '✓', '✓'],
      ['Custom pipeline stages', '—', '✓', '✓'],
      ['Forecasting & weighted probabilities', '—', '✓', '✓'],
      ['Multi-currency', '—', '✓', '✓'],
      ['Territory management', '—', '✓', '✓'],
    ],
  },
  {
    section: 'Proposals & bid workflows',
    rows: [
      ['ComplianceMatrix tracking', '—', '✓', '✓'],
      ['ApprovalGate workflows', '—', '✓', '✓'],
      ['Document templates', '3', '20', 'Unlimited'],
      ['10-criteria bid qualifier', '—', '✓', '✓'],
      ['RFP-to-quote in minutes', '—', '✓', '✓'],
    ],
  },
  {
    section: 'AI & automation',
    rows: [
      ['AI bid qualifier', '—', '✓', '✓'],
      ['AI proposal drafter', '—', '✓', '✓'],
      ['AI account researcher', '—', '✓', '✓'],
      ['Bring-your-own model', '—', '—', '✓'],
      ['Custom AI agents (MCP)', '—', '—', '✓'],
    ],
  },
  {
    section: 'Integrations',
    rows: [
      ['Email (Gmail, Outlook)', '✓', '✓', '✓'],
      ['Slack + Teams', '—', '✓', '✓'],
      ['Calendar (Google, Microsoft)', '—', '✓', '✓'],
      ['API + webhooks', '—', '✓', '✓'],
      ['SSO (SAML, OIDC)', '—', '—', '✓'],
      ['SCIM provisioning', '—', '—', '✓'],
    ],
  },
  {
    section: 'Security & compliance',
    rows: [
      ['SOC 2 Type II', '✓', '✓', '✓'],
      ['GDPR data export', '✓', '✓', '✓'],
      ['Audit log retention', '30 days', '1 year', '7+ years'],
      ['Data residency choice', '—', '—', '✓'],
      ['Custom contractual terms', '—', '—', '✓'],
      ['99.95% uptime SLA', '—', '—', '✓'],
    ],
  },
  {
    section: 'Support',
    rows: [
      ['Email + chat support', '✓', '✓', '✓'],
      ['Priority SLA', '—', '4-hour', '1-hour'],
      ['Named CSM', '—', '—', '✓'],
      ['Quarterly business reviews', '—', '—', '✓'],
      ['Onboarding workshop', '—', 'Self-serve', 'White-glove'],
    ],
  },
];

export const FAQS: Array<{ q: string; a: string }> = [
  {
    q: 'Do I need a credit card to start the free plan?',
    a: 'No. The Free plan is forever-free for up to 3 users and 100 active opportunities. You only enter payment details when you upgrade to Pro.',
  },
  {
    q: 'How does the 14-day Pro trial work?',
    a: 'When you sign up for Pro, you get full access for 14 days with no charge. We do ask for a card to prevent abuse, but you can cancel any time during the trial and you will not be billed.',
  },
  {
    q: 'Can I cancel any time?',
    a: 'Yes. Cancel from the billing settings — your workspace stays read-only for 30 days so you can export your data, then is permanently deleted unless you reactivate.',
  },
  {
    q: 'What is your refund policy?',
    a: 'Annual subscriptions are refundable pro-rata within 30 days of the renewal date. Monthly subscriptions are not refundable but can be cancelled to stop the next billing cycle.',
  },
  {
    q: 'How do you handle my data?',
    a: 'Your data lives in EU data centres (Frankfurt, Paris) on encrypted volumes. We never train AI models on your data. Read the full Privacy Policy and DPA for the legal detail.',
  },
  {
    q: 'Do you offer non-profit or startup discounts?',
    a: 'Yes — 50% off Pro for registered non-profits and qualifying early-stage startups (under €1M ARR, less than 18 months old). Email sales@bidstack.dev with proof.',
  },
  {
    q: 'Can I bring my own AI model?',
    a: 'On Enterprise, yes. Route AI requests through your Anthropic, Mistral, or Azure OpenAI account. Pro uses our shared inference with strict data isolation.',
  },
  {
    q: 'Do you support SSO?',
    a: 'SSO (SAML 2.0 and OIDC) plus SCIM 2.0 user provisioning is included in Enterprise. Pro customers can use Google, Microsoft, and email OTP login.',
  },
  {
    q: 'Where is Polo PreSales hosted?',
    a: 'EU by default (AWS Frankfurt). Enterprise customers can pin US (Virginia) or UK (London) residency. See the Security page for the full sub-processor list.',
  },
  {
    q: 'How does pricing work for Enterprise?',
    a: 'Enterprise pricing is based on user count, AI usage, and contractual requirements. Most deployments land between €99 and €149 per user per month with a 3-year term.',
  },
];
