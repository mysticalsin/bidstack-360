import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Tooltip, TooltipProvider, TooltipBare } from './Tooltip';

afterEach(cleanup);

describe('Tooltip', () => {
  it('renders children when disabled', () => {
    render(
      <Tooltip content="Hint" disabled>
        <button>Trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'Trigger' })).toBeDefined();
  });

  it('renders children when enabled', () => {
    render(
      <Tooltip content="Hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'Trigger' })).toBeDefined();
  });

  it('TooltipBare renders children', () => {
    render(
      <TooltipProvider>
        <TooltipBare content="Hint">
          <button>Bare</button>
        </TooltipBare>
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Bare' })).toBeDefined();
  });
});
