import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GlobalInteractionSound } from './GlobalInteractionSound';

const { play } = vi.hoisted(() => ({ play: vi.fn() }));

vi.mock('@/hooks/useUiSound', () => ({
  useUiSound: () => play,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('GlobalInteractionSound', () => {
  it('plays a click sound for raw buttons and links', () => {
    render(
      <>
        <GlobalInteractionSound />
        <button type="button">Raw action</button>
        <a href="/serum">SERUM</a>
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Raw action' }));
    fireEvent.click(screen.getByRole('link', { name: 'SERUM' }));

    expect(play).toHaveBeenNthCalledWith(1, 'click');
    expect(play).toHaveBeenNthCalledWith(2, 'click');
  });

  it('plays toggle sounds for checkbox-like controls', () => {
    render(
      <>
        <GlobalInteractionSound />
        <label>
          Sound
          <input type="checkbox" />
        </label>
        <button type="button" role="tab">
          Details
        </button>
      </>,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Sound' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));

    expect(play).toHaveBeenNthCalledWith(1, 'toggle');
    expect(play).toHaveBeenNthCalledWith(2, 'toggle');
  });

  it('skips controls that already handle sound or are disabled', () => {
    render(
      <>
        <GlobalInteractionSound />
        <button type="button" data-ui-sound-handled="true">
          Shared button
        </button>
        <button type="button" disabled>
          Disabled
        </button>
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Shared button' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disabled' }));

    expect(play).not.toHaveBeenCalled();
  });
});
