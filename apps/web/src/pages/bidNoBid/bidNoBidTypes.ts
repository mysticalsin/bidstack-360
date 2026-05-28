// Types, data constants, and pure helpers for the Bid/No-Bid decision matrix.

export interface Criterion {
  id: string;
  label: string;
  description: string;
  category: 'strategic' | 'technical' | 'commercial' | 'risk';
  weight: number;
  icon: string;
}

export const CRITERIA: Criterion[] = [
  {
    id: 'fit',
    label: 'Strategic Fit',
    description:
      'How well does this opportunity align with our core capabilities and strategic direction?',
    category: 'strategic',
    weight: 15,
    icon: 'target',
  },
  {
    id: 'relationship',
    label: 'Client Relationship',
    description:
      'Strength of existing relationship with the client. Prior wins, references, and decision-unit access.',
    category: 'strategic',
    weight: 10,
    icon: 'contacts',
  },
  {
    id: 'competitive',
    label: 'Competitive Position',
    description:
      'Our differentiation vs known competitors. Are we the incumbent? Do we have technical edge?',
    category: 'strategic',
    weight: 12,
    icon: 'trophy',
  },
  {
    id: 'tech_capability',
    label: 'Technical Capability',
    description: 'Do we have the people, technology, and certifications to deliver?',
    category: 'technical',
    weight: 15,
    icon: 'settings',
  },
  {
    id: 'resource_avail',
    label: 'Resource Availability',
    description:
      'Are the required team members and subject-matter experts available for this timeline?',
    category: 'technical',
    weight: 10,
    icon: 'clock',
  },
  {
    id: 'solution_ready',
    label: 'Solution Readiness',
    description:
      'Level of maturity of our proposed solution. Proof-of-concept, prior delivery, or greenfield?',
    category: 'technical',
    weight: 8,
    icon: 'tasks',
  },
  {
    id: 'deal_size',
    label: 'Deal Size',
    description: 'Total contract value relative to our average deal size and revenue targets.',
    category: 'commercial',
    weight: 10,
    icon: 'dollar',
  },
  {
    id: 'margin_potential',
    label: 'Margin Potential',
    description: 'Expected profitability after delivery costs, partner fees, and risk provisions.',
    category: 'commercial',
    weight: 8,
    icon: 'growth',
  },
  {
    id: 'payment_terms',
    label: 'Payment Terms',
    description: 'Acceptable payment schedule, milestones, and cash-flow impact.',
    category: 'commercial',
    weight: 5,
    icon: 'briefcase',
  },
  {
    id: 'timeline_risk',
    label: 'Timeline Risk',
    description: 'Is the proposal deadline realistic? Can we produce a quality response?',
    category: 'risk',
    weight: 7,
    icon: 'warning',
  },
];

export type ScoreValue = 0 | 1 | 2 | 3 | 4 | 5;
export type Scores = Record<string, ScoreValue>;

export const SCORE_LABELS: Record<ScoreValue, string> = {
  0: 'Not rated',
  1: 'Very Weak',
  2: 'Weak',
  3: 'Neutral',
  4: 'Strong',
  5: 'Very Strong',
};

export const SCORE_COLORS: Record<ScoreValue, string> = {
  0: 'var(--fg-muted)',
  1: 'var(--danger)',
  2: 'var(--warning)',
  3: 'var(--fg-secondary)',
  4: 'var(--success)',
  5: 'var(--brand-primary)',
};

export const CATEGORY_INFO: Record<string, { label: string; color: string }> = {
  strategic: { label: 'Strategic Alignment', color: 'var(--brand-primary)' },
  technical: { label: 'Technical Readiness', color: 'var(--info)' },
  commercial: { label: 'Commercial Viability', color: 'var(--success)' },
  risk: { label: 'Risk Assessment', color: 'var(--warning)' },
};

export function getRecommendation(score: number): {
  verdict: string;
  color: string;
  status: 'success' | 'warning' | 'danger';
} {
  if (score >= 75)
    return { verdict: 'BID — Strong fit', color: 'var(--success)', status: 'success' };
  if (score >= 55)
    return {
      verdict: 'CONDITIONAL BID — Review risks',
      color: 'var(--warning)',
      status: 'warning',
    };
  return { verdict: 'NO-BID — Insufficient alignment', color: 'var(--danger)', status: 'danger' };
}
