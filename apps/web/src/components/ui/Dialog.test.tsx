import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent } from './Dialog';

describe('Dialog', () => {
  it('renders dialog with title and description', () => {
    render(
      <Dialog open>
        <DialogContent title="Confirm Delete" description="This action cannot be undone.">
          Body
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('Confirm Delete')).toBeDefined();
    expect(screen.getByText('This action cannot be undone.')).toBeDefined();
  });

  it('renders dialog with only title', () => {
    render(
      <Dialog open>
        <DialogContent title="Simple">Content</DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('Simple')).toBeDefined();
    expect(screen.getByText('Content')).toBeDefined();
  });
});
