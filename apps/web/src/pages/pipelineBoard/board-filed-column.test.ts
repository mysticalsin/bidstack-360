import { describe, expect, it } from 'vitest';

import { filedBoardColumnId } from './board-filed-column';

const NEGOTIATION = '55555555-5555-4555-8555-555555555555';
const CLOSED_WON = '66666666-6666-4666-8666-666666666666';

describe('filed board column', () => {
  it('uses the saved column id when the stage copy still names the previous column', () => {
    // WHY: demo Stellantis is filed on Closed Won. A cached stage object
    // that still says Negotiation must not decide the column, or Closed Won
    // stays empty and the open column keeps a decided bid.
    expect(filedBoardColumnId(CLOSED_WON, [NEGOTIATION, CLOSED_WON])).toBe(CLOSED_WON);
  });

  it('does not invent a column when the saved id is not on the board', () => {
    // WHY: an id the board does not draw has to fall through to the stage
    // key. Otherwise the bid would vanish instead of landing on a real column.
    expect(filedBoardColumnId(CLOSED_WON, [NEGOTIATION])).toBeNull();
    expect(filedBoardColumnId(null, [CLOSED_WON])).toBeNull();
    expect(filedBoardColumnId(undefined, [CLOSED_WON])).toBeNull();
  });
});
