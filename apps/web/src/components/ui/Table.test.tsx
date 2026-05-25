import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  TableScrollArea,
} from './Table';

afterEach(cleanup);

describe('Table', () => {
  it('renders a full table structure', () => {
    render(
      <Table>
        <TableCaption>Caption</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Alice</TableCell>
            <TableCell>Admin</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Footer</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );

    expect(screen.getByText('Caption')).toBeDefined();
    expect(screen.getByText('Name')).toBeDefined();
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Footer')).toBeDefined();
  });

  it('forwards className on Table', () => {
    render(
      <Table className="my-table">
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByText('Cell').closest('table');
    expect(table!.className).toContain('my-table');
  });

  it('renders TableHead with scope=col by default', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Header</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    const th = screen.getByText('Header');
    expect(th.tagName).toBe('TH');
    expect(th.getAttribute('scope')).toBe('col');
  });

  it('renders TableScrollArea with className', () => {
    const { container } = render(
      <TableScrollArea className="scroll-wrap">
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>ScrollCell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableScrollArea>,
    );
    expect(container.querySelector('.scroll-wrap')).not.toBeNull();
    expect(screen.getByText('ScrollCell')).toBeDefined();
  });
});
