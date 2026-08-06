import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sheet, SheetContent } from './Sheet';

afterEach(cleanup);

// WHY these matter: the sheet is the app's new primary drill-in. If it loses its
// accessible name, keyboard users land in an unlabelled modal; if the body stops
// being the scroll container, a long compliance matrix scrolls the page behind
// it instead; if `onOpenChange` stops firing, Esc becomes a dead key and the URL
// desyncs from what is on screen.
describe('Sheet', () => {
  it('exposes the panel as a named dialog', () => {
    render(
      <Sheet open>
        <SheetContent title="Acme Corp" description="Opportunity · €1.2M">
          Body
        </SheetContent>
      </Sheet>,
    );
    const panel = screen.getByRole('dialog', { name: 'Acme Corp' });
    expect(within(panel).getByText('Opportunity · €1.2M')).toBeDefined();
    expect(within(panel).getByText('Body')).toBeDefined();
  });

  it('marks the panel aria-modal so AT ignores the page behind it', () => {
    // Radix leans on hideOthers() for this and it is not taking effect in this
    // app — `#root` keeps no aria-hidden while a sheet is open, in dev and in a
    // production build. aria-modal does not depend on that side effect.
    render(
      <Sheet open>
        <SheetContent title="Acme Corp">Body</SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });

  it('drops aria-describedby when there is no description', () => {
    // Radix warns and screen readers announce a dangling id otherwise.
    render(
      <Sheet open>
        <SheetContent title="Acme Corp">Body</SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBeNull();
  });

  it('calls onOpenChange(false) when the close button is pressed', async () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent title="Acme Corp">Body</SheetContent>
      </Sheet>,
    );
    screen.getByRole('button', { name: 'Close panel' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders the footer outside the scrolling body so actions stay reachable', () => {
    render(
      <Sheet open>
        <SheetContent title="Acme Corp" footer={<button type="button">Save</button>}>
          <p>Body</p>
        </SheetContent>
      </Sheet>,
    );
    const scroller = screen.getByText('Body').closest('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(screen.getByRole('button', { name: 'Save' }))).toBe(false);
  });

  it('applies the requested width, defaulting to lg', () => {
    const { rerender } = render(
      <Sheet open>
        <SheetContent title="Default">Body</SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('dialog').className).toContain('sm:max-w-3xl');

    rerender(
      <Sheet open>
        <SheetContent title="Wide" size="xl">
          Body
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('dialog').className).toContain('sm:max-w-5xl');
  });
});
