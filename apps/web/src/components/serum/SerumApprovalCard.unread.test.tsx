// The mission side panel repeats the open-approvals card. A substituted zero
// used to say there are no pending human gates. That count has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SerumStatusCard } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

import { SerumApprovalCard } from './SerumGlass';

const NONE = 'No pending human gates from existing approval workflows.';
const UNREAD = 'Approval gates have not been read. The pending count has not arrived.';
const FAILED = 'Could not load approval gates. The pending count has not arrived.';

function report(partial: Pick<SerumStatusCard, 'status' | 'value' | 'detail'>): SerumStatusCard {
  return {
    id: 'approvals',
    title: 'Open approvals',
    ...partial,
  };
}

describe('SerumApprovalCard unread count', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not say there are no gates when the count was not read', () => {
    // WHY: a missing approval_gates table still produces a snapshot. The side
    // panel must repeat the unread card, not a settled none.
    render(
      <SerumApprovalCard
        openApprovals={0}
        report={report({ status: 'attention', value: 'Not read', detail: UNREAD })}
      />,
    );

    expect(screen.getByText(UNREAD)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not say there are no gates when the count failed', () => {
    // WHY: a failed probe is not a finding of zero pending gates.
    render(
      <SerumApprovalCard
        openApprovals={0}
        report={report({ status: 'error', value: 'Not loaded', detail: FAILED })}
      />,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('still says none when a settled count is zero', () => {
    // WHY: a count that arrived at zero is a real miss. The unread line must
    // not replace it.
    render(
      <SerumApprovalCard
        openApprovals={0}
        report={report({
          status: 'ready',
          value: '0',
          detail: 'Human review gates awaiting a decision.',
        })}
      />,
    );

    expect(screen.getByText(NONE)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still says how many gates are pending when the count arrived', () => {
    // WHY: a loaded total stays. The unread line must not replace it.
    render(
      <SerumApprovalCard
        openApprovals={3}
        report={report({
          status: 'active',
          value: '3',
          detail: 'Human review gates awaiting a decision.',
        })}
      />,
    );

    expect(screen.getByText('3 RFP approval gates need review.')).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByText(UNREAD)).toBeNull();
  });

  it('still says none when an older caller passes only the number zero', () => {
    // WHY: callers that have not passed the card still mean a settled zero.
    render(<SerumApprovalCard openApprovals={0} />);

    expect(screen.getByText(NONE)).toBeTruthy();
  });
});
