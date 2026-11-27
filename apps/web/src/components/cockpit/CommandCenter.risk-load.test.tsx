import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import type { AccountCockpitSnapshot, RiskItem } from '@bidstack/shared';

vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
}));

import { CommandCenter } from './CommandCenter';

// An empty risk file is not a clean load. The command center used to paint
// that file jade, full, and "manageable". That sentence is for a register
// that has rows and none of them are still open.

function risk(over: Partial<RiskItem>): RiskItem {
  return {
    id: 'risk-1',
    title: 'Scope gap',
    severity: 'low',
    owner: null,
    mitigation: null,
    dueDate: null,
    status: 'open',
    ...over,
  };
}

function cockpit(risks: RiskItem[]): AccountCockpitSnapshot {
  return {
    company: {
      id: 'northwind-demo',
      name: 'Northwind Demo',
      annualRevenueMicros: null,
      sourceAttribution: [],
      logo: null,
    },
    kpis: [],
    technicalStack: [],
    health: { score: 40, band: 'needs_attention', counts: { needs_attention: 4 } },
    keyContacts: [],
    recentActivity: [],
    risks,
    compliance: [],
    roadmap: [],
  } as AccountCockpitSnapshot;
}

function riskSignal() {
  const label = screen.getByText('Open risk load');
  const signal = label.closest('.command-signal');
  if (!signal) throw new Error('Open risk load is not inside a command signal');
  return signal;
}

describe('command center risk load before a register exists', () => {
  afterEach(cleanup);

  it('does not call an empty risk file manageable', () => {
    // WHY: demo accounts often have no risk rows. A full jade bar and
    // "manageable with owner follow-up" read as a clean bill of health.
    // Nothing on file is not a managed load.
    render(<CommandCenter cockpit={cockpit([])} />);
    const signal = riskSignal();
    expect(signal.textContent).not.toContain('manageable with owner follow-up');
    expect(signal.textContent).not.toContain('0 open');
    expect(signal.textContent).toContain('Not recorded');
    expect(signal.textContent).toContain('no risks on file');
    const badge = signal.querySelector('.command-signal-head .inline-flex');
    expect(badge?.className).toContain('tag-gray');
    expect(badge?.className).not.toContain('tag-jade');
  });

  it('still says a high open risk should be escalated', () => {
    // WHY: a recorded high risk is work. The empty-file sentence must not
    // replace it.
    render(
      <CommandCenter
        cockpit={cockpit([risk({ severity: 'high', status: 'open', title: 'Price gap' })])}
      />,
    );
    const signal = riskSignal();
    expect(signal.textContent).toContain('1 high');
    expect(signal.textContent).toContain('escalate before proposal');
    expect(signal.textContent).not.toContain('Not recorded');
    expect(signal.querySelector('.command-signal-head .inline-flex')?.className).toContain(
      'tag-tomato',
    );
  });

  it('still says a closed register is manageable', () => {
    // WHY: a mitigated row is on file. That is a managed load, and it is a
    // different sentence from a file that was never recorded.
    render(<CommandCenter cockpit={cockpit([risk({ status: 'mitigated', severity: 'low' })])} />);
    const signal = riskSignal();
    expect(signal.textContent).toContain('0 open');
    expect(signal.textContent).toContain('manageable with owner follow-up');
    expect(signal.textContent).not.toContain('Not recorded');
    expect(signal.querySelector('.command-signal-head .inline-flex')?.className).toContain(
      'tag-jade',
    );
  });
});
