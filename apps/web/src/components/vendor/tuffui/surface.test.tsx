import { render, screen } from '@testing-library/react';
import { Webhook } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { IconTile, Inset, Panel, Shell, ShellHeader } from './surface';

describe('Shell / Panel / Inset', () => {
  it('Shell is a container-query section on the shell surface', () => {
    const { container } = render(<Shell aria-label="Deliveries">x</Shell>);
    const section = container.querySelector('section');
    expect(section?.className).toContain('@container');
    expect(section?.className).toContain('bg-surface-shell');
    expect(section?.className).toContain('rounded-xl');
    expect(section?.getAttribute('aria-label')).toBe('Deliveries');
  });

  it('Panel sits on the inset surface one radius step down', () => {
    const { container } = render(<Panel>x</Panel>);
    const panel = container.firstElementChild;
    expect(panel?.className).toContain('bg-surface-inset');
    expect(panel?.className).toContain('rounded-lg');
  });

  it('Inset uses a primary-tinted step, not a shadcn name', () => {
    const { container } = render(<Inset>x</Inset>);
    expect(container.firstElementChild?.className).toContain('bg-fg-primary/');
  });

  it('IconTile is decorative', () => {
    const { container } = render(<IconTile icon={Webhook} />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

describe('ShellHeader', () => {
  it('renders the title at the requested heading level', () => {
    render(<ShellHeader title="Endpoints" as="h2" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Endpoints' })).toBeTruthy();
  });

  it('defaults to h3 and renders subtitle and aside', () => {
    render(<ShellHeader icon={Webhook} title="Deliveries" subtitle="Last 24h" aside={<span>98%</span>} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Deliveries' })).toBeTruthy();
    expect(screen.getByText('Last 24h').className).toContain('text-fg-secondary');
    expect(screen.getByText('98%')).toBeTruthy();
  });

  it('indents the title when there is no icon', () => {
    const { container } = render(<ShellHeader title="Plain" />);
    expect(container.querySelector('.pl-2')).toBeTruthy();
  });
});
