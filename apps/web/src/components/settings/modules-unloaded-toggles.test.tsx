// Settings, Modules. Save sends the whole module record, and the route
// merges that body over the stored org record. A false value overwrites a
// stored true, including SERUM, which this screen does not even show a
// switch for.
//
// WHY: a request that has not succeeded is not an org with every module off.
// Filling the switches from false and still offering Save would persist that
// lie. A stored off switch is a real setting and must still render off.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppModules } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  useAppModules: vi.fn(),
  useUpdateAppModules: vi.fn(),
}));

vi.mock('@/hooks/useAppModules', () => ({
  useAppModules: hookMocks.useAppModules,
  useUpdateAppModules: hookMocks.useUpdateAppModules,
}));

import { ModulesSection } from './ModulesSection';

const STORED_ON: AppModules = {
  agentStudioEnabled: true,
  appflowyEnabled: false,
  appflowyUrl: null,
  serumEnabled: true,
};

const STORED_OFF: AppModules = {
  agentStudioEnabled: false,
  appflowyEnabled: false,
  appflowyUrl: null,
  serumEnabled: false,
};

function mockModules(state: {
  data?: AppModules;
  isLoading?: boolean;
  isError?: boolean;
  refetch?: ReturnType<typeof vi.fn>;
}) {
  hookMocks.useAppModules.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    refetch: state.refetch ?? vi.fn(),
  });
}

describe('ModulesSection unloaded switches', () => {
  const mutate = vi.fn();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    hookMocks.useUpdateAppModules.mockReturnValue({ mutate, isPending: false });
  });

  it('hides the switches while the org record is still loading', () => {
    mockModules({ isLoading: true });

    const { container } = render(<ModulesSection />);

    expect(screen.queryByRole('checkbox', { name: /Show Agent Studio/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save modules' })).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('does not offer Save when the module record failed to load', () => {
    const refetch = vi.fn();
    mockModules({ isError: true, refetch });

    render(<ModulesSection />);

    expect(screen.getByRole('alert').textContent).toContain('Could not load modules');
    expect(screen.queryByRole('checkbox', { name: /Show Agent Studio/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Collaborate/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save modules' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('saves a loaded org with SERUM still on', () => {
    mockModules({ data: STORED_ON });

    render(<ModulesSection />);

    expect(
      (screen.getByRole('checkbox', { name: /Show Agent Studio/ }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save modules' }));
    expect(mutate).toHaveBeenCalledWith(STORED_ON);
  });

  it('still shows a stored off switch as off', () => {
    mockModules({ data: STORED_OFF });

    render(<ModulesSection />);

    expect(
      (screen.getByRole('checkbox', { name: /Show Agent Studio/ }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.getByRole('button', { name: 'Save modules' })).toBeTruthy();
  });
});
