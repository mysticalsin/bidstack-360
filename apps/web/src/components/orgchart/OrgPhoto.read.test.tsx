// A paused or in-flight API photo has no blob yet. The avatar showed
// initials, which is how a person with no photo looks. The blob has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: hookMocks.useQuery,
}));

import { OrgPhoto } from './OrgPhoto';

const CHECKING = 'Checking the photo. It has not arrived.';
const FAILED = 'Could not load the photo.';
const API = '/api/v1/org-chart/nodes/n1/photo';
const NAME = 'Ada Northwind';

function renderPhoto(
  url: string | null,
  read: { data?: unknown; isError?: boolean; status?: string },
) {
  hookMocks.useQuery.mockReturnValue({
    data: read.data,
    isError: read.isError ?? false,
    isLoading: false,
    status: read.status ?? 'pending',
  });
  render(<OrgPhoto url={url} name={NAME} />);
}

describe('OrgPhoto blob read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused photo read as missing', () => {
    // WHY: a paused first read has isLoading false and no blob. Initials
    // say there is no photo. This one has not arrived.
    renderPhoto(API, { data: undefined, isError: false, status: 'pending' });

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText('AN')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight photo read as missing', () => {
    // WHY: a slow read also has no blob, and isLoading can stay false.
    // Initials must not stand in for a read that is still running.
    renderPhoto(API, { data: undefined, isError: false, status: 'pending' });

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText('AN')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed photo read on the error', () => {
    // WHY: a failed read is not an unread pause and not a missing photo.
    // Initials must not stand in for the error.
    renderPhoto(API, { data: undefined, isError: true, status: 'error' });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('AN')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('lets a failed status win over a stale blob', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // the previous photo.
    renderPhoto(API, { data: 'blob:stale', isError: false, status: 'error' });

    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByText('AN')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays on initials when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is
    // not a failed load, and it is not still checking.
    renderPhoto(API, { data: null, isError: false, status: 'success' });

    expect(screen.getByText('AN')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays on initials when a settled blob is empty', () => {
    // WHY: an empty string has arrived. Unread must not replace that
    // settled miss, and the miss must not say the load failed.
    renderPhoto(API, { data: '', isError: false, status: 'success' });

    expect(screen.getByText('AN')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays on initials when there is no photo URL', () => {
    // WHY: no URL is not a blob read. A disabled query has no data. That
    // must not say the photo is still loading.
    renderPhoto(null, { data: undefined, isError: false, status: 'pending' });

    expect(screen.getByText('AN')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not load an http photo', () => {
    // WHY: an http URL is not a trusted photo and not an API blob read.
    // It stays on initials. It must not say the load failed.
    renderPhoto('http://example.com/a.png', {
      data: undefined,
      isError: false,
      status: 'pending',
    });

    expect(screen.getByText('AN')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows a loaded blob', () => {
    // WHY: a loaded blob is the photo. Unread must not drop it, and
    // initials must not replace it.
    renderPhoto(API, { data: 'blob:photo-1', isError: false, status: 'success' });

    expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:photo-1');
    expect(screen.queryByText('AN')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows an https photo without waiting on the blob read', () => {
    // WHY: an https URL is already the photo. A disabled blob query has
    // no data. That must not hide the image.
    renderPhoto('https://cdn.example/ada.png', {
      data: undefined,
      isError: false,
      status: 'pending',
    });

    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/ada.png');
    expect(screen.queryByText('AN')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
