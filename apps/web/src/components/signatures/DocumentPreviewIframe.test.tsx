import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

import { DocumentPreviewIframe } from './DocumentPreviewIframe';

afterEach(cleanup);

describe('DocumentPreviewIframe loading state', () => {
  // WHY: the design system standardizes on the shared bs-shimmer skeleton for
  // content loading — a raw spinner here would be the only spinner left on the
  // signing flow and would regress the "page loads itself" polish.
  it('shows a document-shaped shimmer skeleton (not a spinner) before the iframe loads', () => {
    // srcdoc mode keeps happy-dom from fetching a real URL in tests.
    const { container } = render(
      <DocumentPreviewIframe src="<p>doc</p>" srcdoc title="Contract" />,
    );

    expect(container.querySelector('.animate-spin')).toBeNull();
    const shimmerBlocks = container.querySelectorAll('.bs-shimmer');
    expect(shimmerBlocks.length).toBeGreaterThan(0);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('removes the skeleton once the iframe fires load', () => {
    const { container } = render(
      <DocumentPreviewIframe src="<p>doc</p>" srcdoc title="Contract" />,
    );

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    fireEvent.load(iframe as HTMLIFrameElement);

    expect(container.querySelector('.bs-shimmer')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
