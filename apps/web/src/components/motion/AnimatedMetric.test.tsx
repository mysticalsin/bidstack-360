import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnimatedMetric } from './AnimatedMetric';

describe('AnimatedMetric', () => {
  it('leaves a past-safe amount as written', () => {
    // WHY: animating this figure through Number moved the cent to .19.
    render(<AnimatedMetric value="90,071,992,547,409.18 unspecified" />);
    expect(screen.getByText('90,071,992,547,409.18 unspecified')).toBeTruthy();
  });
});
