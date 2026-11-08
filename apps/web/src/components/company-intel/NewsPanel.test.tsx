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
    render(<NewsPanel n={news([base({}), base({ id: 'b', title: 'Rumour', url: null })])} />);
    expect(screen.queryByTestId('news-b')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 item without a source link' }));
    expect(within(screen.getByTestId('news-b')).getByText('No source link')).toBeTruthy();
  });
});
