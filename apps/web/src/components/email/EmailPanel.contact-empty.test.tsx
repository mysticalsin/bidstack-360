// Demo contacts such as Klaus Vogt and Lena Fischer already have addresses.
// A contact with no filed messages must not read as a person with no email,
// and the mail link has to follow the address now on the record.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailPanel } from './EmailPanel';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      values
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''))
        : fallback,
  }),
}));
vi.mock('@/lib/api', () => ({ api: mocks.api }));

const CONTACT = '11111111-1111-4111-8111-111111111111';
const KLAUS = 'klaus.vogt.demo@example.com';
const LENA = 'lena.fischer.demo@example.com';

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/email/messages')) return { messages: [], total: 0, hasMore: false };
    return null;
  });
});

afterEach(() => cleanup());

describe('contact email empty state', () => {
  it('mails the address on the contact instead of saying there is no email', async () => {
    // WHY: Klaus Vogt's demo record stores klaus.vogt.demo@example.com. No
    // filed thread is not the same as no address. "No email yet" sends the
    // reader to add an address the record already has.
    wrap(<EmailPanel filter={{ contactId: CONTACT }} defaultTo={KLAUS} />);

    expect(await screen.findByText('No messages yet')).toBeTruthy();
    expect(screen.queryByText('No email yet')).toBeNull();
    expect(screen.getByText(`Nothing is filed for ${KLAUS}.`)).toBeTruthy();
    const link = screen.getByRole('link', { name: KLAUS });
    expect(link.getAttribute('href')).toBe(`mailto:${KLAUS}`);
  });

  it('moves the mail link when the open contact address changes', async () => {
    // WHY: the contact record stays mounted while the route changes from
    // Klaus Vogt to Lena Fischer. The empty mail link has to leave Klaus
    // and point at Lena. A snapshot href would file the next note to the
    // previous person.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <EmailPanel filter={{ contactId: CONTACT }} defaultTo={KLAUS} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('link', { name: KLAUS })).toBeTruthy();

    rerender(
      <QueryClientProvider client={client}>
        <EmailPanel
          filter={{ contactId: '22222222-2222-4222-8222-222222222222' }}
          defaultTo={LENA}
        />
      </QueryClientProvider>,
    );

    const next = await screen.findByRole('link', { name: LENA });
    expect(next.getAttribute('href')).toBe(`mailto:${LENA}`);
    expect(screen.queryByRole('link', { name: KLAUS })).toBeNull();
    expect(screen.queryByText('No email yet')).toBeNull();
  });

  it('keeps "No email yet" when the contact has no address', async () => {
    // WHY: a contact with neither messages nor an address really has no
    // email. Inventing a mail link would dial a blank recipient.
    wrap(<EmailPanel filter={{ contactId: CONTACT }} />);

    expect(await screen.findByText('No email yet')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('No messages yet')).toBeNull();
  });

  it('does not turn a scheme or a fragment into a mail link', async () => {
    // WHY: a stored "mailto:" prefix or a word is not the address on the
    // card. Linking it would open mailto:mailto:… or mail a fragment.
    wrap(
      <EmailPanel filter={{ contactId: CONTACT }} defaultTo={`mailto:${KLAUS}`} />,
    );

    expect(await screen.findByText('No email yet')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('leaves a company with no messages on the existing empty line', async () => {
    // WHY: this empty line is the contact address. A company panel has no
    // contact address to mail, so it stays "No email yet".
    wrap(<EmailPanel filter={{ companyId: '33333333-3333-4333-8333-333333333333' }} />);

    expect(await screen.findByText('No email yet')).toBeTruthy();
    expect(screen.queryByText('No messages yet')).toBeNull();
  });
});
