import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MetricSpark } from './lazy-bklit';

describe('lazy bklit charts', () => {
  it('reserves the chart box, then swaps in the real chart', { timeout: 15_000 }, async () => {
    const { container } = render(<MetricSpark values={[1, 3, 2]} label="Open value trend" />);
    expect(container.querySelector('.viz-bk-reserve')).toBeTruthy();
    expect(await screen.findByRole('img', { name: 'Open value trend' }, { timeout: 10_000 })).toBeTruthy();
    expect(container.querySelector('.viz-bk-reserve')).toBeNull();
  });
  it('reserves nothing when the chart would render nothing', () => {
    const { container } = render(<MetricSpark values={[1]} label="x" />);
    expect(container.querySelector('.viz-bk-reserve')).toBeNull();
  });
});
