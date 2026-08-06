import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { PageHeader } from './PageHeader';

// WHY these matter: PageHeader is the app's only h1 on most surfaces. If it
// stops emitting a real heading, screen-reader users lose the single landmark
// they use to orient after a route change — and nothing about the page LOOKS
// different, so the regression ships silently. The empty-container assertions
// guard the layout bug the component was written to fix.
describe('PageHeader', () => {
  // Queries are scoped to each render's own container: this suite renders the
  // same title repeatedly and the shared test setup does not auto-cleanup, so a
  // document-wide `screen` query would match every previous render too.
  it('renders the title as a real h1, not a styled div', () => {
    const { container } = render(<PageHeader title="Proposals" />);
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('Proposals');
  });

  it('omits the description paragraph entirely when there is no description', () => {
    const { container } = render(<PageHeader title="Proposals" />);
    expect(container.querySelector('.page-sub')).toBeNull();
  });

  it('omits the actions container when there are no actions', () => {
    // An empty actions box still consumes the 24px header gap, which pushes the
    // title off the optical left edge on every action-less page.
    const { container } = render(<PageHeader title="Proposals" />);
    expect(container.querySelector('.page-actions')).toBeNull();
  });

  it('renders actions and description when given', () => {
    const { container } = render(
      <PageHeader
        title="Proposals"
        description="Draft, review, and submit."
        actions={<button type="button">New</button>}
      />,
    );
    expect(container.querySelector('.page-sub')?.textContent).toBe('Draft, review, and submit.');
    expect(container.querySelector('.page-actions button')?.textContent).toBe('New');
  });

  it('exposes titleId so a page main region can point aria-labelledby at it', () => {
    const { container } = render(<PageHeader title="Proposals" titleId="proposals-title" />);
    expect(container.querySelector('h1')?.id).toBe('proposals-title');
  });

  it('renders children below the title row (tabs, view switchers)', () => {
    const { container } = render(
      <PageHeader title="Proposals">
        <nav aria-label="Views">views</nav>
      </PageHeader>,
    );
    const nav = container.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('Views');
    // Below the title row, not inside it — the rule must sit under everything.
    expect(container.querySelector('.page-head')?.contains(nav!)).toBe(false);
  });
});
