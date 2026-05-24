import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSeo } from '@/lib/seo';
import { Section } from '@/components/Section';
import { Icon } from '@/components/Icon';
import { KanbanDemo } from '@/components/KanbanDemo';

// ---------- Static content ----------
// Kept in module scope so React doesn't re-create the array on every render.
const FEATURES = [
  {
    Icon: Icon.Pipeline,
    title: 'Pipeline that adapts',
    body:
      'Drag-and-drop kanban with custom stages per business unit. Forecasts that respect weighted probabilities, not gut feel.',
  },
  {
    Icon: Icon.Sparkle,
    title: 'Proposals with AI',
    body:
      'Drop in an RFP, get a draft proposal in minutes. Reuse boilerplate from past wins, rewrite for tone, export to Word.',
  },
  {
    Icon: Icon.Compass,
    title: '360° accounts',
    body:
      'Every email, deal, document, intent signal, and renewal date on one canvas. No more nine browser tabs to brief a call.',
  },
  {
    Icon: Icon.Workflow,
    title: 'Workflows that actually run',
    body:
      'Visual builder for approval routes, alerting, and renewals. No-code where it pays off; SDK where it matters.',
  },
  {
    Icon: Icon.Target,
    title: 'Bid scoring',
    body:
      'A 10-criteria qualifier runs on every inbound RFP. Stop wasting drafting hours on opportunities you were never going to win.',
  },
  {
    Icon: Icon.Shield,
    title: 'Audit-ready compliance',
    body:
      'SOC2-track posture, GDPR data subject exports, immutable audit log, RBAC down to the field. Bring your auditor.',
  },
];

const TESTIMONIALS = [
  {
    quote:
      'We retired three tools — CRM, proposal builder, and a homegrown bid tracker — and consolidated on BidStack. Win rate is up 12 points.',
    name: 'Pierre Laurent',
    role: 'Sales Director, Amaris',
  },
  {
    quote:
      'Drafting a proposal used to take a week. With BidStack and the Dust co-pilots, my team turns RFPs around in two days.',
    name: 'Sophie Chen',
    role: 'RFP Manager, LittleBig',
  },
  {
    quote:
      'The audit log alone saved us a SOC2 cycle. Everything is timestamped, attributed, and queryable. Procurement loves it.',
    name: 'Klaus Hoffmann',
    role: 'Head of Sales Ops, TechCorp',
  },
];

const PRICING_TEASER = [
  {
    name: 'Free',
    price: '€0',
    cadence: 'forever',
    perks: ['Up to 3 users', '100 opportunities', 'Email & chat support'],
    cta: { label: 'Start free', href: 'https://app.bidstack.dev/sign-up' },
    highlight: false,
  },
  {
    name: 'Pro',
    price: '€39',
    cadence: 'per user / month',
    perks: ['Unlimited opportunities', 'AI co-pilots', 'Workflows & approvals', 'Priority support'],
    cta: { label: 'Start 14-day trial', href: 'https://app.bidstack.dev/sign-up?plan=pro' },
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: 'volume pricing',
    perks: ['SSO + SCIM', 'Dedicated CSM', 'Custom data residency', '99.95% SLA'],
    cta: { label: 'Contact sales', href: 'mailto:sales@bidstack.dev?subject=Enterprise%20pricing' },
    highlight: false,
  },
];

const COMPARE_ROWS = [
  ['Bid-specific pipeline stages', 'check', 'cross', 'partial', 'cross'],
  ['Native proposal builder', 'check', 'partial', 'cross', 'cross'],
  ['AI co-pilots (Dust integration)', 'check', 'cross', 'cross', 'cross'],
  ['ComplianceMatrix tracking', 'check', 'cross', 'cross', 'cross'],
  ['ApprovalGate workflows', 'check', 'partial', 'check', 'partial'],
  ['10-criteria bid qualifier', 'check', 'cross', 'cross', 'cross'],
  ['Per-user pricing under €50/mo', 'check', 'cross', 'check', 'partial'],
  ['GDPR data residency (EU)', 'check', 'check', 'check', 'check'],
];

// ---------- JSON-LD structured data ----------
// Injected once per session via useEffect so search crawlers (Google,
// Perplexity, Brave) understand the brand identity + product class.
function useJsonLd() {
  useEffect(() => {
    const payload = [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'BidStack',
        url: 'https://bidstack.dev',
        logo: 'https://bidstack.dev/og/logo.png',
        sameAs: ['https://twitter.com/bidstack', 'https://www.linkedin.com/company/bidstack'],
      },
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'BidStack 360°',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'EUR',
          lowPrice: '0',
          highPrice: '149',
        },
      },
    ];
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.text = JSON.stringify(payload);
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, []);
}

export function HomePage() {
  useSeo({
    title: 'BidStack 360° — The CRM built for winning bids',
    description:
      'Pipeline, proposals, and AI co-pilots for sales teams who live in RFPs. Start free, no credit card.',
    canonical: 'https://bidstack.dev/',
  });
  useJsonLd();

  return (
    <>
      {/* ---------- HERO ---------- */}
      <section className="relative overflow-hidden pt-12 md:pt-20 pb-16 md:pb-24">
        <div className="mkt-hero-orbs" aria-hidden="true" />
        <div className="mkt-container relative">
          <div className="max-w-3xl mx-auto text-center">
            <div className="mkt-eyebrow mb-4">For sales teams that live in RFPs</div>
            <h1 className="mkt-display text-4xl sm:text-5xl md:text-6xl lg:text-[72px] text-[color:var(--fg-primary)]">
              The CRM built for{' '}
              <span className="mkt-serif-italic mkt-text-gradient">winning bids</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-[color:var(--fg-secondary)] leading-relaxed">
              Pipeline, proposals, and AI co-pilots for sales teams who live in RFPs. Replace your
              CRM, your proposal builder, and your bid tracker — without losing a single data row.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
              <a
                href="https://app.bidstack.dev/sign-up"
                className="mkt-btn mkt-btn-primary mkt-btn-lg"
              >
                Start free <Icon.ArrowRight width={16} height={16} />
              </a>
              <a href="https://cal.com/bidstack/demo" className="mkt-btn mkt-btn-secondary mkt-btn-lg">
                Book a demo
              </a>
            </div>
            <p className="mt-4 text-sm text-[color:var(--fg-tertiary)]">
              14-day Pro trial • No credit card • Cancel anytime
            </p>
          </div>

          {/* Workflow showcase sits right under the hero so the page feels alive
              above the fold even on a 13-inch laptop. */}
          <div className="mt-14 md:mt-20 max-w-4xl mx-auto">
            <KanbanDemo />
          </div>
        </div>
      </section>

      {/* ---------- SOCIAL PROOF ---------- */}
      <section
        aria-label="Customers using BidStack"
        className="border-y border-[color:var(--border-subtle)] py-8 md:py-10 bg-[color:var(--surface-card)]"
      >
        <div className="mkt-container">
          <p className="text-center text-xs uppercase tracking-wider font-semibold text-[color:var(--fg-tertiary)]">
            Trusted by Mantu business units and bid teams across Europe
          </p>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6 md:gap-10 items-center justify-items-center">
            {['Amaris', 'LittleBig', 'Pulsar', 'CAI', 'Mantu', 'GhostPilot'].map((name) => (
              <div
                key={name}
                className="mkt-logo flex items-center justify-center font-bold text-lg tracking-tight text-[color:var(--fg-primary)]"
                aria-label={`${name} logo placeholder`}
              >
                {name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FEATURES ---------- */}
      <Section
        id="why"
        eyebrow="Why BidStack"
        title="Built for the deals nobody else automates"
        lead="Generic CRMs treat every deal the same. BidStack treats RFPs like RFPs — with the workflows, AI, and compliance scaffolding bid teams actually need."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ Icon: I, title, body }) => (
            <article key={title} className="mkt-card mkt-card-hover">
              <div
                className="mb-4 grid h-11 w-11 place-items-center rounded-xl text-[color:var(--brand-primary)]"
                style={{ background: 'var(--brand-primary-tint)' }}
              >
                <I width={22} height={22} />
              </div>
              <h3 className="text-lg font-semibold text-[color:var(--fg-primary)]">{title}</h3>
              <p className="mt-2 text-[15px] text-[color:var(--fg-secondary)] leading-relaxed">
                {body}
              </p>
            </article>
          ))}
        </div>
      </Section>

      {/* ---------- COMPARISON ---------- */}
      <Section
        tone="sunken"
        eyebrow="The competitive landscape"
        title="What you get that the giants don't ship"
        lead="Stripped to the features that matter when your week is half-spent on bids."
      >
        <div className="overflow-x-auto">
          <table className="mkt-compare">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col" className="text-center">BidStack</th>
                <th scope="col" className="text-center">Salesforce</th>
                <th scope="col" className="text-center">Odoo</th>
                <th scope="col" className="text-center">HubSpot</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map(([label, ...cells]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {cells.map((cell, i) => (
                    <td key={i} className="text-center">
                      {cell === 'check' && (
                        <span className="mkt-check" aria-label="Yes">
                          <Icon.Check width={18} height={18} className="inline" />
                        </span>
                      )}
                      {cell === 'cross' && (
                        <span className="mkt-cross" aria-label="No">
                          <Icon.X width={18} height={18} className="inline" />
                        </span>
                      )}
                      {cell === 'partial' && (
                        <span className="mkt-partial" aria-label="Partial">
                          Partial
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[color:var(--fg-tertiary)] text-center mt-4">
          Comparison based on publicly documented features as of May 2026. Some competitors offer
          equivalents via paid add-ons or third-party apps.
        </p>
      </Section>

      {/* ---------- AI SECTION ---------- */}
      <Section
        id="ai"
        eyebrow="AI, done seriously"
        title="Built with AI co-pilots, not AI gimmicks"
        lead="Every BidStack deployment ships with Dust agents wired in: bid qualifier, proposal drafter, account researcher. They live inside your workspace, not in a separate tab."
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          <div className="space-y-5">
            <div className="flex gap-4">
              <div
                className="grid h-10 w-10 place-items-center rounded-lg text-[color:var(--brand-primary)] flex-shrink-0"
                style={{ background: 'var(--brand-primary-tint)' }}
              >
                <Icon.Sparkle width={20} height={20} />
              </div>
              <div>
                <h3 className="font-semibold text-[color:var(--fg-primary)]">
                  Agents that read your data, not just public web
                </h3>
                <p className="mt-1 text-[15px] text-[color:var(--fg-secondary)] leading-relaxed">
                  BidStack ships an MCP server so agents query opportunities, accounts, and past
                  proposals with org-scoped permissions baked in.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div
                className="grid h-10 w-10 place-items-center rounded-lg text-[color:var(--brand-primary)] flex-shrink-0"
                style={{ background: 'var(--brand-primary-tint)' }}
              >
                <Icon.Shield width={20} height={20} />
              </div>
              <div>
                <h3 className="font-semibold text-[color:var(--fg-primary)]">
                  Provenance + audit on every AI output
                </h3>
                <p className="mt-1 text-[15px] text-[color:var(--fg-secondary)] leading-relaxed">
                  Every AI-generated draft logs the model, prompt, sources, and reviewer. EU AI Act
                  Article 13 transparency, out of the box.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div
                className="grid h-10 w-10 place-items-center rounded-lg text-[color:var(--brand-primary)] flex-shrink-0"
                style={{ background: 'var(--brand-primary-tint)' }}
              >
                <Icon.Workflow width={20} height={20} />
              </div>
              <div>
                <h3 className="font-semibold text-[color:var(--fg-primary)]">
                  Bring your own model, or use ours
                </h3>
                <p className="mt-1 text-[15px] text-[color:var(--fg-secondary)] leading-relaxed">
                  Route AI calls through your Anthropic / Mistral / Azure OpenAI account. Enterprise
                  customers can pin specific model versions for change control.
                </p>
              </div>
            </div>
          </div>
          <div className="mkt-card mkt-dot-grid p-8 lg:p-10">
            <div className="rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-card)] p-5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold text-[color:var(--brand-primary)] uppercase tracking-wider">
                <Icon.Sparkle width={14} height={14} /> Bid qualifier agent
              </div>
              <p className="mt-3 text-[15px] text-[color:var(--fg-primary)] leading-relaxed">
                Scored <strong>Nova Telecom 2026</strong> at <strong>72/100</strong>. Recommendation:{' '}
                <span className="text-[color:var(--success)] font-medium">Pursue</span>.
              </p>
              <p className="mt-2 text-[13px] text-[color:var(--fg-secondary)]">
                Strong fit on contract size, decision-maker access verified, but timeline is tight
                (4 weeks to submission). Allocate senior bid manager.
              </p>
              <p className="mt-4 text-[11px] text-[color:var(--fg-muted)] font-mono">
                Sources: 6 emails, 2 prior proposals, 1 LinkedIn signal · Reviewed by S. Chen
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ---------- PRICING TEASER ---------- */}
      <Section
        tone="sunken"
        eyebrow="Pricing"
        title="Simple, transparent, no per-seat tax"
        lead="Start free. Upgrade when you outgrow it. Cancel any time."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {PRICING_TEASER.map((tier) => (
            <article
              key={tier.name}
              className={`mkt-card relative ${
                tier.highlight
                  ? 'border-[color:var(--brand-primary)] shadow-lg'
                  : ''
              }`}
            >
              {tier.highlight && <span className="mkt-popular">Most popular</span>}
              <h3 className="text-lg font-semibold text-[color:var(--fg-primary)]">{tier.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-[color:var(--fg-primary)] tracking-tight">
                  {tier.price}
                </span>
                <span className="text-sm text-[color:var(--fg-tertiary)]">{tier.cadence}</span>
              </div>
              <ul className="mt-5 space-y-2.5 text-sm text-[color:var(--fg-secondary)]">
                {tier.perks.map((p) => (
                  <li key={p} className="flex items-start gap-2">
                    <Icon.Check
                      width={16}
                      height={16}
                      className="text-[color:var(--success)] mt-0.5 flex-shrink-0"
                    />
                    {p}
                  </li>
                ))}
              </ul>
              <a
                href={tier.cta.href}
                className={`mkt-btn w-full mt-6 ${
                  tier.highlight ? 'mkt-btn-primary' : 'mkt-btn-secondary'
                }`}
              >
                {tier.cta.label}
              </a>
            </article>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link
            to="/pricing"
            className="link-inline inline-flex items-center gap-1 text-sm font-semibold text-[color:var(--brand-primary)] hover:underline"
          >
            See full pricing <Icon.ArrowRight width={14} height={14} />
          </Link>
        </div>
      </Section>

      {/* ---------- TESTIMONIALS ---------- */}
      <Section
        eyebrow="From bid teams in the trenches"
        title="What the people who ship proposals tell us"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className="mkt-card">
              <Icon.Quote
                width={22}
                height={22}
                className="text-[color:var(--brand-primary)] mb-3"
              />
              <blockquote className="text-[15px] text-[color:var(--fg-primary)] leading-relaxed">
                {t.quote}
              </blockquote>
              <figcaption className="mt-4 pt-4 border-t border-[color:var(--border-subtle)]">
                <div className="font-semibold text-sm text-[color:var(--fg-primary)]">{t.name}</div>
                <div className="text-xs text-[color:var(--fg-tertiary)]">{t.role}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      {/* ---------- CTA BANNER ---------- */}
      <section className="py-16 md:py-24">
        <div className="mkt-container">
          <div
            className="relative overflow-hidden rounded-2xl px-6 py-12 md:px-16 md:py-16 text-center text-white"
            style={{
              background:
                'linear-gradient(135deg, #1b2c7a 0%, #2c4bff 50%, #6e59ff 100%)',
            }}
          >
            <h2 className="mkt-display text-3xl md:text-5xl text-white">
              Start your free 14-day trial
            </h2>
            <p className="mt-4 text-lg md:text-xl text-white/85 max-w-xl mx-auto">
              No credit card required. Bring your team, your pipeline, and your next RFP.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
              <a
                href="https://app.bidstack.dev/sign-up"
                className="mkt-btn mkt-btn-lg bg-white text-[color:var(--brand-deep)] hover:bg-white/90"
              >
                Start free <Icon.ArrowRight width={16} height={16} />
              </a>
              <a
                href="https://cal.com/bidstack/demo"
                className="mkt-btn mkt-btn-lg border border-white/30 text-white hover:bg-white/10"
              >
                Talk to sales
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
