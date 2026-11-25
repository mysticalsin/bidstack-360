import type { AccountNewsIntel } from '@bidstack/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { NewsPanel } from './IntelPanels';

type Item = AccountNewsIntel['items'][number];
const base = (over: Partial<Item>): Item =>
  ({
    id: 'a',
    kind: 'news',
    origin: 'news',
    title: 'Story',
    url: 'https://www.reuters.com/x',
    publishedAt: '2026-11-01T00:00:00Z',
    source: 'gdelt',
    sourceLabel: 'Reuters',
    evidenceId: 'e1',
    ...over,
  }) as Item;

const news = (items: Item[]) => ({ items }) as unknown as AccountNewsIntel;

describe('NewsPanel sources', () => {
  afterEach(cleanup);

  it('links every item to its source and names the site', () => {
    render(<NewsPanel n={news([base({})])} />);
    const row = screen.getByTestId('news-a');
    const links = within(row).getAllByRole('link');
    expect(links.every((l) => l.getAttribute('href') === 'https://www.reuters.com/x')).toBe(true);
    expect(row.textContent).toMatch(/Source: Reuters \(reuters\.com\)/);
  });

  it('keeps items without a source link apart and flags them', () => {
    render(<NewsPanel n={news([base({}), base({ id: 'b', title: 'Rumour', url: null, sample: false })])} />);
    expect(screen.queryByTestId('news-b')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 item without a source link' }));
    expect(within(screen.getByTestId('news-b')).getByText('No source link')).toBeTruthy();
  });

  it('shows a demo sample story that has no source link, and still hides an unchecked rumour', () => {
    // CI Financial's demo signals are sample rows with an empty source URL.
    // Hiding them with the rumour control makes the News tab look empty.
    render(
      <NewsPanel
        n={news([
          base({
            id: 'ci',
            title: 'Sample: CI Financial third-quarter profit rose 12% on record assets',
            url: '',
            source: 'sample',
            sourceLabel: 'Sample data',
            sample: true,
          }),
          base({ id: 'rumour', title: 'Rumour', url: null, sample: false }),
        ])}
      />,
    );

    const story = screen.getByTestId('news-ci');
    expect(story.textContent).toMatch(/Sample: CI Financial third-quarter profit rose 12% on record assets/);
    expect(within(story).getByText('Sample')).toBeTruthy();
    expect(within(story).queryByText('No source link')).toBeNull();
    expect(story.querySelector('a')).toBeNull();
    expect(screen.queryByText('No posts or news with a source link')).toBeNull();
    expect(screen.queryByTestId('news-rumour')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show 1 item without a source link' })).toBeTruthy();
  });

  it('does not call a page of sample stories an empty news list', () => {
    render(
      <NewsPanel
        n={news([
          base({
            id: 'ci',
            title: 'Sample: CI Financial third-quarter profit rose 12% on record assets',
            url: '',
            source: 'sample',
            sourceLabel: 'Sample data',
            sample: true,
          }),
        ])}
      />,
    );

    expect(screen.getByTestId('news-ci')).toBeTruthy();
    expect(screen.queryByText('No posts or news with a source link')).toBeNull();
    expect(screen.queryByRole('button', { name: /without a source link/ })).toBeNull();
  });
});
