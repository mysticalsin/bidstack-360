import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Toaster, toast } from './Toast';

describe('Toaster', () => {
  it('renders without crashing', () => {
    const { container } = render(<Toaster />);
    expect(container).toBeDefined();
  });

  it('toast.success does not throw', () => {
    expect(() => toast.success('Saved')).not.toThrow();
  });

  it('toast.error does not throw', () => {
    expect(() => toast.error('Failed')).not.toThrow();
  });

  it('toast.info does not throw', () => {
    expect(() => toast.info('Working…')).not.toThrow();
  });
});
