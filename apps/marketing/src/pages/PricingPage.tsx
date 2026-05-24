import { useState } from 'react';
import { useSeo } from '@/lib/seo';
import { Section } from '@/components/Section';
import { Icon } from '@/components/Icon';

// Same tier definitions Wave 2 Stripe agent uses upstream. Keep the
// monthly/annual prices and per-tier feature lists in sync with billing config.
interface Tier {
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

const TIERS: Tier[] = [
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

// Detailed feature comparison (collapsed by default).
const FEATURE_MATRIX: Array<{ section: string; rows: Array<[string, string, string, string]> }> = [
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

const FAQS: Array<{ q: string; a: string }> = [
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
    q: 'Where is BidStack hosted?',
    a: 'EU by default (AWS Frankfurt). Enterprise customers can pin US (Virginia) or UK (London) residency. See the Security page for the full sub-processor list.',
  },
  {
    q: 'How does pricing work for Enterprise?',
    a: 'Enterprise pricing is based on user count, AI usage, and contractual requirements. Most deployments land between €99 and €149 per user per month with a 3-year term.',
  },
];

export function PricingPage() {
  const [annual, setAnnual] = useState(true);

  useSeo({
    title: 'Pricing — BidStack 360°',
    description:
      'Simple, transparent pricing. Start free forever, scale to Pro at €39/user/month, or talk to us about Enterprise.',
    canonical: 'https://bidstack.dev/pricing',
  });

  const displayPrice = (tier: Tier) => {
    const value = annual ? tier.annual : tier.monthly;
    if (value === 'custom') return 'Custom';
    return `${tier.currency}${value}`;
  };

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden pt-12 md:pt-16 pb-8 md:pb-12">
        <div className="mkt-hero-orbs" aria-hidden="true" />
        <div className="mkt-container relative text-center max-w-3xl mx-auto">
          <div className="mkt-eyebrow mb-3">Pricing</div>
          <h1 className="mkt-display text-4xl sm:text-5xl md:text-6xl text-[color:var(--fg-primary)]">
            Honest pricing, no per-seat tax
          </h1>
          <p className="mt-5 text-lg text-[color:var(--fg-secondary)] leading-relaxed">
            Start free. Upgrade when it pays you back. Cancel any time. No hidden seat minimums, no
            usage trap-doors.
          </p>

          {/* Billing cadence toggle */}
          <div
            className="mt-9 inline-flex items-center gap-1 p-1 rounded-full border border-[color:var(--border-default)] bg-[color:var(--surface-card)]"
            role="radiogroup"
            aria-label="Billing cadence"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!annual}
              onClick={() => setAnnual(false)}
              className={`px-4 py-2 rounded-full text-sm font-medium min-h-0 transition-colors ${
                !annual
                  ? 'bg-[color:var(--brand-primary)] text-white'
                  : 'text-[color:var(--fg-secondary)] hover:text-[color:var(--fg-primary)]'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={annual}
              onClick={() => setAnnual(true)}
              className={`px-4 py-2 rounded-full text-sm font-medium min-h-0 transition-colors flex items-center gap-2 ${
                annual
                  ? 'bg-[color:var(--brand-primary)] text-white'
                  : 'text-[color:var(--fg-secondary)] hover:text-[color:var(--fg-primary)]'
              }`}
            >
              Annual
              <span
                className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                  annual
                    ? 'bg-white/20 text-white'
                    : 'bg-[color:var(--success)]/10 text-[color:var(--success)]'
                }`}
              >
                Save 20%
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Tier cards */}
      <section className="pb-16 md:pb-20">
        <div className="mkt-container">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-6xl mx-auto">
            {TIERS.map((tier) => (
              <article
                key={tier.name}
                className={`mkt-card relative flex flex-col ${
                  tier.highlight
                    ? 'border-[color:var(--brand-primary)] shadow-lg md:scale-[1.02]'
                    : ''
                }`}
              >
                {tier.highlight && <span className="mkt-popular">Most popular</span>}
                <h2 className="text-xl font-semibold text-[color:var(--fg-primary)]">
                  {tier.name}
                </h2>
                <p className="mt-1 text-sm text-[color:var(--fg-tertiary)]">{tier.tagline}</p>
                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-5xl font-bold text-[color:var(--fg-primary)] tracking-tight">
                    {displayPrice(tier)}
                  </span>
                  <span className="text-sm text-[color:var(--fg-tertiary)]">{tier.cadence}</span>
                </div>
                {annual && tier.monthly !== 'custom' && tier.monthly > 0 && (
                  <p className="mt-1 text-xs text-[color:var(--fg-tertiary)]">
                    Billed annually. {tier.currency}
                    {tier.monthly}/mo monthly.
                  </p>
                )}
                <a
                  href={tier.cta.href}
                  className={`mkt-btn w-full mt-6 ${
                    tier.highlight ? 'mkt-btn-primary' : 'mkt-btn-secondary'
                  }`}
                >
                  {tier.cta.label}
                </a>
                <div className="mt-6 h-px bg-[color:var(--border-subtle)]" />
                <ul className="mt-6 space-y-2.5 text-sm text-[color:var(--fg-secondary)] flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Icon.Check
                        width={16}
                        height={16}
                        className="text-[color:var(--success)] mt-0.5 flex-shrink-0"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                  {tier.excluded?.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[color:var(--fg-muted)]">
                      <Icon.X
                        width={16}
                        height={16}
                        className="mt-0.5 flex-shrink-0"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Detailed feature comparison */}
      <Section
        tone="sunken"
        eyebrow="Compare plans"
        title="Every feature, side by side"
        lead="The fine print, unfolded."
      >
        <details className="max-w-5xl mx-auto rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-card)] overflow-hidden">
          <summary className="cursor-pointer px-5 py-4 font-semibold text-[color:var(--fg-primary)] flex items-center justify-between hover:bg-[color:var(--surface-sunken)] min-h-[44px]">
            <span>Show the full feature matrix</span>
            <Icon.ArrowRight width={18} height={18} className="rotate-90 group-open:rotate-[270deg]" />
          </summary>
          <div className="overflow-x-auto">
            <table className="mkt-compare !border-0 !rounded-none">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col" className="text-center">Free</th>
                  <th scope="col" className="text-center">Pro</th>
                  <th scope="col" className="text-center">Enterprise</th>
                </tr>
              </thead>
              {FEATURE_MATRIX.map((sec) => (
                <tbody key={sec.section}>
                  <tr>
                    <td colSpan={4} className="!bg-[color:var(--surface-sunken)] !font-semibold !text-[color:var(--brand-primary)] uppercase tracking-wider !text-xs">
                      {sec.section}
                    </td>
                  </tr>
                  {sec.rows.map(([label, free, pro, ent]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="text-center">
                        {free === '✓' ? (
                          <Icon.Check width={16} height={16} className="text-[color:var(--success)] inline" />
                        ) : free === '—' ? (
                          <Icon.X width={16} height={16} className="text-[color:var(--fg-muted)] inline" />
                        ) : (
                          free
                        )}
                      </td>
                      <td className="text-center">
                        {pro === '✓' ? (
                          <Icon.Check width={16} height={16} className="text-[color:var(--success)] inline" />
                        ) : pro === '—' ? (
                          <Icon.X width={16} height={16} className="text-[color:var(--fg-muted)] inline" />
                        ) : (
                          pro
                        )}
                      </td>
                      <td className="text-center">
                        {ent === '✓' ? (
                          <Icon.Check width={16} height={16} className="text-[color:var(--success)] inline" />
                        ) : ent === '—' ? (
                          <Icon.X width={16} height={16} className="text-[color:var(--fg-muted)] inline" />
                        ) : (
                          ent
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </details>
      </Section>

      {/* FAQ accordion */}
      <Section eyebrow="FAQ" title="Common questions, straight answers" alignTitle="center">
        <div className="mkt-faq max-w-3xl mx-auto">
          {FAQS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <div className="mkt-faq-body">{f.a}</div>
            </details>
          ))}
        </div>
        <p className="mt-10 text-center text-sm text-[color:var(--fg-tertiary)]">
          Still have questions? Email{' '}
          <a className="link-inline text-[color:var(--brand-primary)] underline" href="mailto:sales@bidstack.dev">
            sales@bidstack.dev
          </a>{' '}
          — humans answer.
        </p>
      </Section>
    </>
  );
}
