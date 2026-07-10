import { useState } from 'react';
import { useSeo } from '@/lib/seo';
import { Section } from '@/components/Section';
import { Icon } from '@/components/Icon';
import { type Tier, TIERS, FEATURE_MATRIX, FAQS } from './PricingPage.data';

export function PricingPage() {
  const [annual, setAnnual] = useState(true);

  useSeo({
    title: 'Pricing — Polo PreSales',
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
                      <Icon.X width={16} height={16} className="mt-0.5 flex-shrink-0" />
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
            <Icon.ArrowRight
              width={18}
              height={18}
              className="rotate-90 group-open:rotate-[270deg]"
            />
          </summary>
          <div className="overflow-x-auto">
            <table className="mkt-compare !border-0 !rounded-none">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col" className="text-center">
                    Free
                  </th>
                  <th scope="col" className="text-center">
                    Pro
                  </th>
                  <th scope="col" className="text-center">
                    Enterprise
                  </th>
                </tr>
              </thead>
              {FEATURE_MATRIX.map((sec) => (
                <tbody key={sec.section}>
                  <tr>
                    <td
                      colSpan={4}
                      className="!bg-[color:var(--surface-sunken)] !font-semibold !text-[color:var(--brand-primary)] uppercase tracking-wider !text-xs"
                    >
                      {sec.section}
                    </td>
                  </tr>
                  {sec.rows.map(([label, free, pro, ent]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="text-center">
                        {free === '✓' ? (
                          <Icon.Check
                            width={16}
                            height={16}
                            className="text-[color:var(--success)] inline"
                          />
                        ) : free === '—' ? (
                          <Icon.X
                            width={16}
                            height={16}
                            className="text-[color:var(--fg-muted)] inline"
                          />
                        ) : (
                          free
                        )}
                      </td>
                      <td className="text-center">
                        {pro === '✓' ? (
                          <Icon.Check
                            width={16}
                            height={16}
                            className="text-[color:var(--success)] inline"
                          />
                        ) : pro === '—' ? (
                          <Icon.X
                            width={16}
                            height={16}
                            className="text-[color:var(--fg-muted)] inline"
                          />
                        ) : (
                          pro
                        )}
                      </td>
                      <td className="text-center">
                        {ent === '✓' ? (
                          <Icon.Check
                            width={16}
                            height={16}
                            className="text-[color:var(--success)] inline"
                          />
                        ) : ent === '—' ? (
                          <Icon.X
                            width={16}
                            height={16}
                            className="text-[color:var(--fg-muted)] inline"
                          />
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
          <a
            className="link-inline text-[color:var(--brand-primary)] underline"
            href="mailto:sales@bidstack.dev"
          >
            sales@bidstack.dev
          </a>{' '}
          — humans answer.
        </p>
      </Section>
    </>
  );
}
