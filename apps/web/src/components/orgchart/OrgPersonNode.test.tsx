import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { NodeCov, OrgNode } from '@/lib/orgchart/types';

import { ContactLinks, contactHrefs } from './ContactLinks';
import { PersonNode } from './OrgPersonNode';
import { ProfileDetails } from './ProfileDetails';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const person = (o: Partial<OrgNode> = {}): OrgNode => ({
  id: 'n1', parentId: null, name: 'Ana Silva', title: 'Chief Executive Officer', photoUrl: null, seniority: 'c_level', region: 'BR',
  contactId: null, email: 'ana.silva@example.com', phone: '+551155550101', linkedinUrl: 'https://www.linkedin.com/in/ana-silva-example',
  ownerName: null, source: 'html', ...o,
});
const cov = (lastMetAt: string | null): NodeCov => ({ met: Boolean(lastMetAt), count: lastMetAt ? 1 : 0, lastMetAt, meetings: [], challenges: [], owners: [], manual: null });

function renderNode(node: OrgNode, c: NodeCov | undefined, extra: Partial<ComponentProps<typeof PersonNode>['data']> = {}, onOuterClick?: () => void) {
  const data = { node, cov: c, strength: 'weak' as const, showMet: true, showStrength: false, match: 'none' as const, childCount: 0, collapsed: false, isRoot: false, onToggle: vi.fn(), asOf: NOW, ...extra };
  const props = { id: node.id, data, selected: false, type: 'person', dragging: false, zIndex: 0, isConnectable: false, positionAbsoluteX: 0, positionAbsoluteY: 0, selectable: true, deletable: false, draggable: false } as unknown as ComponentProps<typeof PersonNode>;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReactFlowProvider><div onClick={onOuterClick}><PersonNode {...props} /></div></ReactFlowProvider>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);

describe('PersonNode recency badge', () => {
  it('green "Met recently" within 30 days, with the date in the tooltip', () => {
    renderNode(person(), cov(ago(5)));
    const badge = screen.getByTestId('orgchart-recency');
    expect(badge.textContent).toBe('Met recently');
    expect(badge.dataset.r).toBe('recent');
    expect(badge.title).toMatch(/^Last met /);
    expect(screen.getByTestId('orgchart-node').querySelector('.oc-ava')!.getAttribute('data-ring')).toBe('met');
    expect(screen.getByTestId('orgchart-node').getAttribute('aria-label')).toMatch(/last met/);
  });
  it('amber between 31 and 90 days', () => {
    renderNode(person(), cov(ago(60)));
    const badge = screen.getByTestId('orgchart-recency');
    expect(badge.dataset.r).toBe('warm');
    expect(badge.textContent).toBe('Met 9 wk ago');
    expect(screen.getByTestId('orgchart-node').querySelector('.oc-ava')!.getAttribute('data-ring')).toBe('warm');
  });
  it('grey ring and no badge when met longer ago; dashed gap ring when never met', () => {
    renderNode(person(), cov(ago(200)));
    expect(screen.queryByTestId('orgchart-recency')).toBeNull();
    expect(screen.getByTestId('orgchart-node').querySelector('.oc-ava')!.getAttribute('data-ring')).toBe('stale');
    cleanup();
    renderNode(person(), cov(null));
    expect(screen.queryByTestId('orgchart-recency')).toBeNull();
    expect(screen.getByTestId('orgchart-node').querySelector('.oc-ava')!.getAttribute('data-ring')).toBe('gap');
  });
  it('hides the badge when the Met coverage overlay is off', () => {
    renderNode(person(), cov(ago(2)), { showMet: false });
    expect(screen.queryByTestId('orgchart-recency')).toBeNull();
  });
});

describe('contact links', () => {
  it('node shows mailto, LinkedIn in a new tab with noopener, and tel; clicks do not select the node', () => {
    const outer = vi.fn();
    renderNode(person(), cov(null), {}, outer);
    const links = within(screen.getByTestId('orgchart-node-links')).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['mailto:ana.silva@example.com', 'https://www.linkedin.com/in/ana-silva-example', 'tel:+551155550101']);
    const li = links[1]!;
    expect(li.getAttribute('target')).toBe('_blank');
    expect(li.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(links[0]!);
    expect(outer).not.toHaveBeenCalled();
  });
  it('restricted people show no contact links; initials when there is no photo', () => {
    renderNode(person({ redacted: true }), undefined);
    expect(screen.queryByTestId('orgchart-node-links')).toBeNull();
    expect(screen.getByTestId('orgchart-node').querySelector('.oc-ava')!.textContent).toBe('AS');
  });
  it('never renders unsafe schemes or look-alike hosts', () => {
    expect(contactHrefs({ email: 'javascript:alert(1)', phone: '12', linkedinUrl: 'javascript:alert(1)' })).toEqual({ email: null, phone: null, linkedin: null });
    expect(contactHrefs({ email: null, phone: null, linkedinUrl: 'https://linkedin.com.evil.example/in/x' }).linkedin).toBeNull();
    render(<ContactLinks node={{ name: 'X', email: null, phone: null, linkedinUrl: 'http://www.linkedin.com/in/x' }} />);
    expect(screen.queryByTestId('orgchart-contact')).toBeNull();
  });
});

describe('ProfileDetails', () => {
  it('shows imported extras and only https links', () => {
    render(<ProfileDetails fn="OPS" profile={{
      headline: 'Chief Executive Officer at Example Corp', location: 'Example City, Brazil', tenure: 'At Example Corp since 2010',
      personKind: 'external', employer: 'Example Staffing', languages: ['English', 'Spanish'], themes: ['cloud', 'data'],
      career: [{ role: 'Chief Executive Officer', org: 'Example Corp', period: '2010 - present' }],
      signals: [{ title: 'Announced a new data platform', url: 'https://example.com/news', date: '2026-09' }, { title: 'Bad link', url: 'javascript:alert(1)', date: null }],
      socials: [{ kind: 'github', url: 'https://github.com/example' }], fit: { score: 4, why: ['Runs a data programme'] },
    }} />);
    const p = screen.getByTestId('orgchart-profile');
    for (const t of ['OPS', 'Example City, Brazil', 'External, Example Staffing', 'English, Spanish', 'cloud', 'At Example Corp since 2010', '2010 - present']) expect(p.textContent).toContain(t);
    expect(within(p).getByText('Announced a new data platform').closest('a')!.getAttribute('href')).toBe('https://example.com/news');
    expect(within(p).getByText('Bad link').closest('a')).toBeNull();
    expect(within(p).getByText('GitHub').closest('a')!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByTestId('orgchart-fit').textContent).toMatch(/Fit score 4 of 10/);
  });
});
