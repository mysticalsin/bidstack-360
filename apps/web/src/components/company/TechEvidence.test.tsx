import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TechnicalStackCoverage, TechnicalStackItemType } from '@bidstack/shared';

import { TechCoverageLine, TechEvidenceChip } from './TechEvidence';
import { coverageParts } from './techEvidenceText';

const CHECKED = '2026-11-07T10:00:00.000Z';

function coverage(overrides: Partial<TechnicalStackCoverage> = {}): TechnicalStackCoverage {
  return {
    checkedAt: CHECKED,
    openItems: 12,
    apolloFallback: 'not_needed',
    apolloThreshold: 5,
    sample: false,
    lanes: [
      { lane: 'dns', status: 'found', count: 5, detail: null, checkedAt: CHECKED },
      { lane: 'ct', status: 'failed', count: 0, detail: 'crt.sh answered HTTP 502', checkedAt: CHECKED },
      { lane: 'web', status: 'found', count: 2, detail: null, checkedAt: CHECKED },
      { lane: 'jobs', status: 'empty', count: 0, detail: null, checkedAt: CHECKED },
      { lane: 'github', status: 'skipped', count: 0, detail: 'No public GitHub organisation linked', checkedAt: CHECKED },
    ],
    ...overrides,
  };
}

const dnsItem: TechnicalStackItemType = {
  name: 'Microsoft 365',
  source: 'open_data:dns',
  confidence: 0.95,
  evidence: { url: null, record: 'MX x.mail.protection.outlook.com', observedAt: CHECKED },
};

afterEach(cleanup);

describe('coverageParts', () => {
  it('names found lanes with counts and every lane that found nothing, plainly', () => {
    expect(coverageParts(coverage())).toEqual({
      found: 'DNS 5, Website 2',
      nothing: 'Jobs',
      notChecked: 'GitHub',
      failed: 'Cert',
    });
  });
});

describe('TechCoverageLine', () => {
  it('renders the coverage sentence, the check date and no em dash', () => {
    render(<TechCoverageLine coverage={coverage()} />);
    const line = screen.getByTestId('tech-coverage-line');
    expect(line.textContent).toContain('Coverage: DNS 5, Website 2.');
    expect(line.textContent).toContain('Nothing found in Jobs.');
    expect(line.textContent).toContain('Not checked: GitHub.');
    expect(line.textContent).toContain('Could not reach: Cert.');
    expect(line.textContent).toContain('Checked 7 Nov 2026');
    expect(line.textContent).not.toContain('\u2014');
  });

  it('marks sample data and says when Apollo was asked to fill a thin stack', () => {
    render(<TechCoverageLine coverage={coverage({ sample: true, apolloFallback: 'queued', openItems: 2 })} />);
    expect(screen.getByText('Sample')).toBeTruthy();
    expect(screen.getByTestId('tech-coverage-line').textContent).toContain('Apollo asked to fill gaps.');
  });

  it('renders nothing before the first check', () => {
    const { container } = render(<TechCoverageLine coverage={null} />);
    expect(container.textContent).toBe('');
  });
});

describe('TechEvidenceChip', () => {
  it('labels the source plainly and opens the evidence on click', () => {
    render(<TechEvidenceChip item={dnsItem} />);
    const chip = screen.getByRole('button', { name: /Microsoft 365 evidence, DNS, 95% confidence/ });
    expect(chip.textContent).toContain('DNS');
    fireEvent.click(chip);
    expect(screen.getByText('MX x.mail.protection.outlook.com')).toBeTruthy();
    expect(screen.getByText(/Seen 7 Nov 2026/)).toBeTruthy();
  });

  it('links to the public record when there is one', () => {
    render(
      <TechEvidenceChip
        item={{ ...dnsItem, name: 'Jira', source: 'open_data:ct', confidence: 0.8, evidence: { url: 'https://crt.sh/?q=jira.example.com', record: 'Certificate for jira.example.com', observedAt: CHECKED } }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Jira evidence, Cert/ }));
    const link = screen.getByRole('link', { name: /Open public record/ });
    expect(link.getAttribute('href')).toBe('https://crt.sh/?q=jira.example.com');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('maps every source family to a short chip label', () => {
    const labels = ['apollo_io', 'manual', 'meeting_notes', 'open_data:web', 'open_data:jobs'].map((source) => {
      cleanup();
      render(<TechEvidenceChip item={{ name: 'X', source, confidence: 0.5 }} />);
      return screen.getByRole('button').textContent?.replace(/\d+%$/, '');
    });
    expect(labels).toEqual(['Apollo', 'Manual', 'Meeting notes', 'Website', 'Jobs']);
  });
});
