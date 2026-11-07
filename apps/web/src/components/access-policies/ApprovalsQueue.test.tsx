import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars?.[n] ?? '')),
  }),
}));

import type { AccessPolicyVersion } from '@/hooks/useAccessPolicies';

import { ApprovalsQueue, VersionHistory } from './ApprovalsQueue';

function version(partial: Partial<AccessPolicyVersion> & Pick<AccessPolicyVersion, 'id' | 'status'>): AccessPolicyVersion {
  return {
    name: `Policy ${partial.id}`,
    version: null,
    rules: [],
    createdById: 'author',
    createdByName: 'Tony Admin',
    submittedAt: '2026-11-07T12:00:00.000Z',
    approvedById: null,
    approvedByName: null,
    approvedAt: null,
    decisionNote: null,
    publishedAt: null,
    rollbackOfId: null,
    createdAt: '2026-11-07T11:00:00.000Z',
    ...partial,
  };
}

const handlers = () => ({ onApprove: vi.fn(), onReject: vi.fn(), onPublish: vi.fn() });

afterEach(() => {
  cleanup();
});

describe('ApprovalsQueue', () => {
  it('never offers Approve to the author of a pending policy', () => {
    render(
      <ApprovalsQueue
        items={[version({ id: 'p1', status: 'pending' })]}
        currentUserId="author"
        canApprove
        canPublish
        nextVersion={1}
        {...handlers()}
      />,
    );
    const row = screen.getByRole('listitem', { name: /Policy p1/ });
    expect(within(row).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(row).getByText('You submitted this policy. A second admin must approve it.')).toBeTruthy();
  });

  it('lets a second admin approve or reject with a note', async () => {
    const h = handlers();
    render(
      <ApprovalsQueue
        items={[version({ id: 'p1', status: 'pending' })]}
        currentUserId="reviewer"
        canApprove
        canPublish
        nextVersion={1}
        {...h}
      />,
    );
    const row = screen.getByRole('listitem', { name: /Policy p1/ });
    fireEvent.change(within(row).getByRole('textbox', { name: 'Decision note' }), { target: { value: 'Too broad' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.onReject).toHaveBeenCalledWith('p1', 'Too broad'));
    fireEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.onApprove).toHaveBeenCalledWith('p1', 'Too broad'));
  });

  it('offers Publish vN on an approved policy', () => {
    const h = handlers();
    render(
      <ApprovalsQueue
        items={[version({ id: 'a1', status: 'approved', approvedById: 'reviewer', approvedByName: 'Rae Reviewer' })]}
        currentUserId="author"
        canApprove
        canPublish
        nextVersion={4}
        {...h}
      />,
    );
    expect(screen.getByText('Approved by Rae Reviewer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Publish v4' }));
    expect(h.onPublish).toHaveBeenCalledWith('a1');
  });

  it('shows one sentence when nothing waits for review', () => {
    render(<ApprovalsQueue items={[]} currentUserId="x" canApprove canPublish nextVersion={1} {...handlers()} />);
    expect(screen.getByText('Nothing is waiting for review.')).toBeTruthy();
  });
});

describe('VersionHistory', () => {
  it('marks the live version and offers rollback to earlier ones', () => {
    const onRollback = vi.fn();
    render(
      <VersionHistory
        items={[
          version({ id: 'v2', status: 'published', version: 2, publishedAt: '2026-11-07T13:00:00.000Z' }),
          version({ id: 'v1', status: 'superseded', version: 1, publishedAt: '2026-11-06T13:00:00.000Z' }),
        ]}
        canWrite
        onRollback={onRollback}
      />,
    );
    const live = screen.getByRole('listitem', { name: /v2/ });
    expect(within(live).getByText('Live')).toBeTruthy();
    expect(within(live).queryByRole('button', { name: /Roll back/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v1' }));
    expect(onRollback).toHaveBeenCalledWith('v1');
  });
});
