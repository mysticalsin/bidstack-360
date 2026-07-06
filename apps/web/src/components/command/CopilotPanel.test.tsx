// Copilot panel error classification. The daily AI cap is a deterministic
// 429 quota that resets at UTC midnight — it must read as a distinct
// "budget spent" message with NO Retry affordance, because retrying is
// guaranteed to fail identically until the reset. Any transient/unknown
// failure keeps the generic "Try again" copy + Retry button.
//
// This pins the fix away from the old `error.message.includes('cap')`
// substring check, which missed the session-cap message entirely (it says
// "Daily AI session limit …", with no "cap" substring) and offered a doomed
// Retry button on a quota that can't recover.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopilotPanel } from './CopilotPanel';
import { ApiError } from '@/lib/api';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => ({ data: { companies: [] } }),
}));

// A mutable mutation stub so each test can put the email-draft mutation into a
// specific error state before rendering. deal-sentiment / account-intel stay
// idle — the email-draft action is the one enabled purely by a typed prompt.
const hoisted = vi.hoisted(() => ({
  draftEmail: { mutate: vi.fn(), isPending: false, error: null as Error | null },
}));

vi.mock('@/hooks/useAiAssistant', () => ({
  useDraftEmail: () => hoisted.draftEmail,
  useDealSentiment: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useAccountIntel: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <CopilotPanel
        prompt="nudge procurement on the redlines"
        onClose={vi.fn()}
        keyHandlerRef={{ current: null }}
        onActiveOptionChange={vi.fn()}
      />
    </MemoryRouter>,
  );
}

/** Fire the enabled "Draft the email" action so its (mocked) mutation's error
 *  flows into the status area. */
function runEmailAction() {
  fireEvent.click(screen.getByText('Draft the email'));
}

beforeEach(() => {
  hoisted.draftEmail.mutate = vi.fn();
  hoisted.draftEmail.isPending = false;
  hoisted.draftEmail.error = null;
});

afterEach(cleanup);

describe('CopilotPanel cap-error handling', () => {
  it('shows the specific budget message and NO retry on a 429 daily-cap error', () => {
    // The session-cap message deliberately contains no "cap" substring — the
    // classification must key off the 429 status, not the string.
    hoisted.draftEmail.error = new ApiError('Daily AI session limit of 100 reached.', 429, null);

    renderPanel();
    runEmailAction();

    expect(screen.getByText('Daily AI budget spent — it resets tomorrow.')).toBeDefined();
    // A doomed Retry must not be offered for a deterministic daily quota.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    // And it must NOT fall through to the generic transient copy.
    expect(screen.queryByText('Copilot couldn’t read this record. Try again.')).toBeNull();
  });

  it('keeps the generic message + Retry for a transient (non-429) failure', () => {
    hoisted.draftEmail.error = new ApiError('Upstream model timed out', 500, null);

    renderPanel();
    runEmailAction();

    expect(screen.getByText('Copilot couldn’t read this record. Try again.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(screen.queryByText('Daily AI budget spent — it resets tomorrow.')).toBeNull();
  });
});
