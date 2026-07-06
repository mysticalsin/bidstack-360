// Saved views went from Tasks-only to all five entity lists. These tests
// pin the two contracts that make that safe:
//   1. Surface namespacing — a preset saved on one list must never surface
//      on another. A bid lead recalling "Critical, still uncontacted" (a
//      leads preset) onto the Opportunities list would silently apply the
//      wrong slice and misread the pipeline.
//   2. Capture/restore duality — URL-state pages restore by navigation;
//      local-state pages (Leads, Contacts) restore via onRestore because
//      their filters never touch the URL. If either path regresses, "recall"
//      renders the list unfiltered while claiming the preset is active.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SavedViewsBar } from './SavedViewsBar';
import { confirm, prompt } from '@/components/ui/ConfirmDialog';
import { useSavedViews } from '@/stores/savedViews';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/components/ui/ConfirmDialog', () => ({
  prompt: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const promptMock = vi.mocked(prompt);
const confirmMock = vi.mocked(confirm);

/** Renders the router's current location so restore-by-navigation is observable. */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{`${loc.pathname}${loc.search}`}</output>;
}

beforeEach(() => {
  localStorage.clear();
  useSavedViews.setState({ views: {} });
  promptMock.mockReset();
  confirmMock.mockReset();
});

afterEach(cleanup);

describe('SavedViewsBar', () => {
  it('only lists views saved under its own surface — never a sibling list’s presets', () => {
    useSavedViews.getState().save('leads', 'Critical, still uncontacted', '?priority=critical');
    useSavedViews.getState().save('opportunities', 'Submitted, due this week', '?due=within7');

    render(
      <MemoryRouter initialEntries={['/opportunities']}>
        <SavedViewsBar surface="opportunities" basePath="/opportunities" namePlaceholder="x" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('option', { name: 'Submitted, due this week' })).toBeDefined();
    // The leads preset must be invisible here — recalling it would apply a
    // leads query string to the opportunities list.
    expect(screen.queryByRole('option', { name: 'Critical, still uncontacted' })).toBeNull();
  });

  it('restores a URL-state view by navigating to basePath + the stored query', () => {
    const view = useSavedViews
      .getState()
      .save('opportunities', 'Biggest first', '?sort=value.desc');

    render(
      <MemoryRouter initialEntries={['/opportunities']}>
        <SavedViewsBar surface="opportunities" basePath="/opportunities" namePlaceholder="x" />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Recall saved view'), {
      target: { value: view.id },
    });

    // The URL is the source of truth on these pages — landing anywhere else
    // (or dropping the query) means the preset silently did nothing.
    expect(screen.getByTestId('loc').textContent).toBe('/opportunities?sort=value.desc');
  });

  it('hands the stored query to onRestore instead of navigating when the page owns its filter state', () => {
    const view = useSavedViews.getState().save('contacts', 'Buyers', '?q=cfo&sort=influence.desc');
    const onRestore = vi.fn();

    render(
      <MemoryRouter initialEntries={['/contacts']}>
        <SavedViewsBar
          surface="contacts"
          basePath="/contacts"
          namePlaceholder="x"
          onRestore={onRestore}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Recall saved view'), {
      target: { value: view.id },
    });

    // Contacts keeps search in useState — navigation can't restore it, so the
    // page's own restore hook must receive the exact serialized query.
    expect(onRestore).toHaveBeenCalledWith('?q=cfo&sort=influence.desc');
    expect(screen.getByTestId('loc').textContent).toBe('/contacts');
  });

  it('removes the view the picker has selected — not the most-recently-saved one', async () => {
    // save() prepends, so the LAST-saved view is views[0]. A user who saved an
    // older view first then a newer one, and wants to delete the older, must
    // get the older one removed — deleting views[0] would silently drop the
    // wrong (newer) view while the confirm dialog even named the older one.
    useSavedViews.getState().save('opportunities', 'Q1 Renewals', '?q=q1'); // older → views[1]
    useSavedViews.getState().save('opportunities', 'My Bids', '?q=bids'); // newer → views[0]
    const older = useSavedViews
      .getState()
      .views.opportunities?.find((v) => v.name === 'Q1 Renewals');
    expect(older).toBeDefined();
    confirmMock.mockResolvedValue(true);

    render(
      <MemoryRouter initialEntries={['/opportunities']}>
        <SavedViewsBar surface="opportunities" basePath="/opportunities" namePlaceholder="x" />
      </MemoryRouter>,
    );

    // Pick the OLDER view in the recall dropdown, then remove.
    fireEvent.change(screen.getByLabelText('Recall saved view'), {
      target: { value: older!.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected saved view' }));

    await waitFor(() => {
      const remaining = useSavedViews.getState().views.opportunities ?? [];
      // Only the newer view survives; the selected (older) one is gone.
      expect(remaining.map((v) => v.name)).toEqual(['My Bids']);
    });
  });

  it('disables Remove until a view is picked so it can never delete a stale views[0]', () => {
    useSavedViews.getState().save('opportunities', 'Only view', '?q=x');

    render(
      <MemoryRouter initialEntries={['/opportunities']}>
        <SavedViewsBar surface="opportunities" basePath="/opportunities" namePlaceholder="x" />
      </MemoryRouter>,
    );

    // Nothing selected yet → the destructive control is inert.
    expect(
      (screen.getByRole('button', { name: 'Remove selected saved view' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('captures via getQuery on save so local-state filters are what gets bookmarked', async () => {
    promptMock.mockResolvedValue('Hot inbound');

    render(
      <MemoryRouter initialEntries={['/leads']}>
        <SavedViewsBar
          surface="leads"
          basePath="/leads"
          namePlaceholder="x"
          // Simulates a page whose live filters are NOT in the URL: if the bar
          // fell back to location.search it would bookmark an empty query and
          // the recalled view would show the unfiltered list.
          getQuery={() => '?status=qualified&priority=critical'}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));

    await waitFor(() => {
      const saved = useSavedViews.getState().views.leads ?? [];
      expect(saved).toHaveLength(1);
      expect(saved[0]?.name).toBe('Hot inbound');
      expect(saved[0]?.query).toBe('?status=qualified&priority=critical');
    });
  });
});
