/**
 * HomePage.data.ts — Static content arrays and JSON-LD hook for the marketing home page.
 *
 * Kept in a separate module so React does not re-create the arrays on every render
 * and so HomePage.tsx stays under the 400-line limit (BS-R1 file-size refactor).
 */
import { useEffect } from 'react';
import { Icon } from '@/components/Icon';

export const FEATURES = [
  {
    Icon: Icon.Pipeline,
    title: 'Pipeline that adapts',
    body: 'Drag-and-drop kanban with custom stages per business unit. Forecasts that respect weighted probabilities, not gut feel.',
  },
  {
    Icon: Icon.Sparkle,
    title: 'Proposals with AI',
    body: 'Drop in an RFP, get a draft proposal in minutes. Reuse boilerplate from past wins, rewrite for tone, export to Word.',
  },
  {
    Icon: Icon.Compass,
    title: '360° accounts',
    body: 'Every email, deal, document, intent signal, and renewal date on one canvas. No more nine browser tabs to brief a call.',
  },
  {
    Icon: Icon.Workflow,
    title: 'Workflows that actually run',
    body: 'Visual builder for approval routes, alerting, and renewals. No-code where it pays off; SDK where it matters.',
  },
  {
    Icon: Icon.Target,
    title: 'Bid scoring',
    body: 'A 10-criteria qualifier runs on every inbound RFP. Stop wasting drafting hours on opportunities you were never going to win.',
  },
  {
    Icon: Icon.Shield,
    title: 'Audit-ready compliance',
    body: 'SOC2-track posture, GDPR data subject exports, immutable audit log, RBAC down to the field. Bring your auditor.',
  },
];

export const TESTIMONIALS = [
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

export const PRICING_TEASER = [
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

export const COMPARE_ROWS = [
  ['Bid-specific pipeline stages', 'check', 'cross', 'partial', 'cross'],
  ['Native proposal builder', 'check', 'partial', 'cross', 'cross'],
  ['AI co-pilots (Dust integration)', 'check', 'cross', 'cross', 'cross'],
  ['ComplianceMatrix tracking', 'check', 'cross', 'cross', 'cross'],
  ['ApprovalGate workflows', 'check', 'partial', 'check', 'partial'],
  ['10-criteria bid qualifier', 'check', 'cross', 'cross', 'cross'],
  ['Per-user pricing under €50/mo', 'check', 'cross', 'check', 'partial'],
  ['GDPR data residency (EU)', 'check', 'check', 'check', 'check'],
];

/**
 * Injects JSON-LD structured data into <head> once per mount so search crawlers
 * (Google, Perplexity, Brave) understand brand identity and product class.
 */
export function useJsonLd() {
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
