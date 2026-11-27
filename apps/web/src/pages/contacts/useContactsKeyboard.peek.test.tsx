// Space on the contacts list peeks one person. j and k then move the row
// highlight. The peek kept the first person, so Klaus Vogt's title
// "VP Operations" stayed on screen after the highlight moved to Lena Fischer
// (IT Director). The phone on that card was still Klaus's number.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '@bidstack/shared';

import { useContactsKeyboard } from './useContactsKeyboard';

const KLAUS = '00000000-0000-4000-8000-000000000021';
const LENA = '00000000-0000-4000-8000-000000000022';
const BLANK = '00000000-0000-4000-8000-000000000023';

function person(overrides: Partial<Contact> & Pick<Contact, 'id' | 'name'>): Contact {
  return {
    customer: 'Siemens',
    role: null,
    email: null,
    phone: null,
    influence: 4,
    sentiment: 'warm',
    createdAt: '2026-05-01T00:00:00.000Z',
    companyId: 'c0000000-0000-4000-8000-000000000010',
    linkState: 'linked',
    ...overrides,
  };
}

const klaus = person({
  id: KLAUS,
  name: 'Klaus Vogt',
  role: 'VP Operations',
  email: 'klaus.vogt.demo@example.com',
  phone: '+49 30 1234 5670',
  influence: 5,
  sentiment: 'hot',
});

const lena = person({
  id: LENA,
  name: 'Lena Fischer',
  role: 'IT Director',
  email: 'lena.fischer.demo@example.com',
  phone: '+49 30 1234 5671',
});

const blankTitle = person({
  id: BLANK,
  name: 'No Title Yet',
  role: null,
  phone: null,
});

function Harness({
  items,
  initialCursor = 0,
  initialPeek = null as Contact | null,
}: {
  items: Contact[];
  initialCursor?: number;
  initialPeek?: Contact | null;
}) {
  const [cursorIdx, setCursorIdx] = useState(initialCursor);
  const [quickLook, setQuickLook] = useState<Contact | null>(initialPeek);
  useContactsKeyboard({
    items,
    cursorIdx,
    setCursorIdx,
    setEditTarget: vi.fn(),
    toggleOne: vi.fn(),
    quickLook,
    setQuickLook,
  });
  return (
    <output data-testid="peek">
      {quickLook ? `${quickLook.name}|${quickLook.role ?? ''}|${quickLook.phone ?? ''}` : 'closed'}
    </output>
  );
}

function peekText(): string {
  return screen.getByTestId('peek').textContent ?? '';
}

afterEach(() => {
  cleanup();
});

describe('contacts quick look follows the highlighted person', () => {
  it('replaces Klaus Vogt with Lena Fischer when j moves the highlight', () => {
    // WHY: the open card is the person the highlight is on. Leaving
    // "VP Operations" and +49 30 1234 5670 up after the highlight moves
    // shows the previous title and the previous phone.
    render(<Harness items={[klaus, lena]} initialPeek={klaus} />);
    expect(peekText()).toBe('Klaus Vogt|VP Operations|+49 30 1234 5670');

    fireEvent.keyDown(window, { key: 'j' });

    expect(peekText()).toBe('Lena Fischer|IT Director|+49 30 1234 5671');
  });

  it('drops a title when the next demo contact has none', () => {
    // WHY: an empty title on the highlighted person must not keep the
    // previous person's title on the card.
    render(<Harness items={[klaus, blankTitle]} initialPeek={klaus} />);

    fireEvent.keyDown(window, { key: 'ArrowDown' });

    expect(peekText()).toBe('No Title Yet||');
  });

  it('does not open a peek just because the highlight moved', () => {
    // WHY: j without Space is only the row highlight. A closed peek stays closed.
    render(<Harness items={[klaus, lena]} />);

    fireEvent.keyDown(window, { key: 'j' });

    expect(peekText()).toBe('closed');
  });

  it('jumps the open peek back to the first person with gg', () => {
    // WHY: gg moves the highlight to the top. The card has to move with it.
    render(<Harness items={[klaus, lena]} initialCursor={1} initialPeek={lena} />);

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'g' });

    expect(peekText()).toBe('Klaus Vogt|VP Operations|+49 30 1234 5670');
  });

  it('jumps the open peek to the last person with G', () => {
    // WHY: G moves the highlight to the end of the visible list. The card
    // has to move with it, or the first person's title stays up.
    render(<Harness items={[klaus, lena, blankTitle]} initialPeek={klaus} />);

    fireEvent.keyDown(window, { key: 'G' });

    expect(peekText()).toBe('No Title Yet||');
  });
});
