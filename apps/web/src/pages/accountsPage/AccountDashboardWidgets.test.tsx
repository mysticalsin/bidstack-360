// Demo leaves ERP unset. An empty provider read must not invent a healthy
// ERP node. A real unset row stays unset.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

import { IntegrationMotionRail } from './AccountDashboardWidgets';

afterEach(() => cleanup());

describe('integration status rail under an empty ERP read', () => {
  it('does not paint a healthy ERP when the provider list is empty', () => {
    // WHY: Settings > Integrations mounts this rail with whatever the health
    // read returned. Demo synthetic workspaces often have no rows yet. Filling
    // that gap with a healthy ERP makes an unset connector look live.
    render(<IntegrationMotionRail providers={[]} />);

    expect(screen.queryByText('ERP')).toBeNull();
    expect(screen.queryByText('External CRM')).toBeNull();
    expect(document.querySelector('.rail-node-healthy')).toBeNull();
    expect(screen.getByText('No integration status in this read.')).toBeTruthy();
    expect(screen.queryByText('ERP, External CRM, verified data connectors')).toBeNull();
  });

  it('keeps an unset ERP row unset instead of calling it healthy', () => {
    // WHY: a disabled ERP is not connected. The rail must show that status,
    // not replace it with the healthy placeholder used for an empty list.
    render(<IntegrationMotionRail providers={[{ name: 'ERP', status: 'disabled' }]} />);

    const node = screen.getByText('ERP');
    expect(node.className).toContain('rail-node-disabled');
    expect(node.className).not.toContain('rail-node-healthy');
  });

  it('still names the providers the read actually returned', () => {
    render(
      <IntegrationMotionRail providers={[{ name: 'SEC EDGAR', status: 'healthy' }]} />,
    );

    expect(screen.getByText('SEC EDGAR').className).toContain('rail-node-healthy');
    expect(screen.queryByText('ERP')).toBeNull();
  });
});
