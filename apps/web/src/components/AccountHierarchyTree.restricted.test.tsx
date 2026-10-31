import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AccountHierarchyTree } from './AccountHierarchyTree';

describe('AccountHierarchyTree restricted nodes', () => {
  it('renders out-of-scope placeholders as plain text, not links', () => {
    render(
      <MemoryRouter>
        <AccountHierarchyTree
          tree={{
            id: 'root', name: 'Acme Group', parentId: null,
            children: [
              { id: 'x', name: 'Restricted company', parentId: 'root',
                children: [{ id: 'leaf', name: 'Acme DE', parentId: 'x', children: [] }] },
            ],
          }}
        />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/companies/root', '/companies/leaf']);
    expect(screen.queryByRole('link', { name: /Restricted company/ })).toBeNull();
    expect(screen.getByText('Restricted company').closest('[data-restricted]')).toBeTruthy();
  });
});
