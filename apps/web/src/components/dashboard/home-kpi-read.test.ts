import { describe, expect, it } from 'vitest';

import { opportunityRowsRead, weightedPipelineRead } from './home-kpi-read';

const unread = { isError: false, isLoading: true, isFetched: false, data: undefined };
const failed = { isError: true, isLoading: false, isFetched: true, data: undefined };

describe('home open-pipeline reads', () => {
  it('does not treat a bid list that has not arrived as an empty book', () => {
    // The hero used to draw "No dated bids yet" from a missing items array.
    expect(opportunityRowsRead(unread).state).toBe('pending');
    expect(opportunityRowsRead({ ...unread, data: {} }).state).toBe('pending');
  });

  it('does not treat a payload with no bid list as an empty book', () => {
    // A body that arrived without items is a failed read, not zero bids.
    const read = opportunityRowsRead({
      isError: false,
      isLoading: false,
      isFetched: true,
      data: { total: 1 },
    });
    expect(read.state).toBe('failed');
    expect(read.rows).toEqual([]);
  });

  it('keeps an empty bid list empty once that list has arrived', () => {
    const read = opportunityRowsRead({
      isError: false,
      isLoading: false,
      isFetched: true,
      data: { items: [] },
    });
    expect(read.state).toBe('ready');
    expect(read.rows).toEqual([]);
  });

  it('keeps a failed bid read failed even when the query is no longer loading', () => {
    expect(opportunityRowsRead(failed).state).toBe('failed');
  });

  it('does not treat a weighted figure that has not arrived as zero', () => {
    expect(weightedPipelineRead(unread).state).toBe('pending');
    expect(weightedPipelineRead(unread).weighted).toBe(0);
  });

  it('does not treat a payload with no weighted figure as zero', () => {
    const read = weightedPipelineRead({
      isError: false,
      isLoading: false,
      isFetched: true,
      data: { totalValueOpen: 10 },
    });
    expect(read.state).toBe('failed');
  });

  it('keeps an arrived weighted figure of zero', () => {
    const read = weightedPipelineRead({
      isError: false,
      isLoading: false,
      isFetched: true,
      data: { weightedPipeline: 0 },
    });
    expect(read.state).toBe('ready');
    expect(read.weighted).toBe(0);
  });

  it('keeps a failed weighted read from looking like zero', () => {
    expect(weightedPipelineRead(failed).state).toBe('failed');
  });
});
