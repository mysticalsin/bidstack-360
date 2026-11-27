// WHY: Settings, Modules is where an admin turns Agent Studio and Collaborate
// on for the demo org. The module read had not arrived, and the toggles still
// sat off with Save modules open. An unread record and a saved off record are
// different. Saving the first one writes those offs, including SERUM, over the
// org the screen never showed.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useAppModules: vi.fn(),
  useUpdateAppModules: vi.fn(),
}));

vi.mock('@/hooks/useAppModules', () => ({
  useAppModules: hookMocks.useAppModules,
  useUpdateAppModules: hookMocks.useUpdateAppModules,
}));

import { ModulesSection } from './ModulesSection';

const savedOff = {
  agentStudioEnabled: false,
  appflowyEnabled: false,
  appflowyUrl: null,
  serumEnabled: true,
};

function idleSave() {
  hookMocks.useUpdateAppModules.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
}

describe('ModulesSection unread settings', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not present a module load in progress as saved offs', () => {
    idleSave();
    hookMocks.useAppModules.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    const { container } = render(<ModulesSection />);

    expect(screen.queryByRole('checkbox', { name: /Show Agent Studio/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save modules' })).toBeNull();
    expect(screen.queryByText('Could not load modules')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('does not offer Save when the module read failed', () => {
    const refetch = vi.fn();
    idleSave();
    hookMocks.useAppModules.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<ModulesSection />);

    expect(screen.getByText('Could not load modules')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Show Agent Studio/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Collaborate workspace/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save modules' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still shows saved offs once the module record has loaded', () => {
    idleSave();
    hookMocks.useAppModules.mockReturnValue({
      data: savedOff,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ModulesSection />);

    expect(
      (screen.getByRole('checkbox', { name: /Show Agent Studio/ }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole('checkbox', { name: /Collaborate workspace/ }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.getByRole('button', { name: 'Save modules' })).toBeTruthy();
    expect(screen.queryByText('Could not load modules')).toBeNull();
  });

  it('still shows a saved Agent Studio grant and Collaborate URL', () => {
    idleSave();
    hookMocks.useAppModules.mockReturnValue({
      data: {
        agentStudioEnabled: true,
        appflowyEnabled: true,
        appflowyUrl: 'https://demo.example/workspace',
        serumEnabled: true,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ModulesSection />);

    expect(
      (screen.getByRole('checkbox', { name: /Show Agent Studio/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole('checkbox', { name: /Collaborate workspace/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByLabelText('AppFlowy workspace URL') as HTMLInputElement).value).toBe(
      'https://demo.example/workspace',
    );
    expect(screen.getByRole('button', { name: 'Save modules' })).toBeTruthy();
  });
});
