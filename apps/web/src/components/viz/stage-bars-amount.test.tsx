// WHY: the account table prints stage.amount, the exact micros label.
// The bar label and the tooltip used format(Number(value)), so a total that
// does not survive a JavaScript number showed a different figure on the chart
// than in the table. The painted text has to be the table's amount.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StageBars } from './charts';

const amount = '19,875,000';

describe('StageBars exact amounts', () => {
  it('shows the table amount instead of the unit number', () => {
    render(
      <StageBars
        data={[{ label: 'S2 sent', value: 19_875_000, count: 2, amount }]}
        format={(n) => `units ${n}`}
      />,
    );
    expect(screen.getByText(amount)).toBeTruthy();
    expect(screen.queryByText('units 19875000')).toBeNull();
  });
});
