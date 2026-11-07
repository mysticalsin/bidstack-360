import { describe, expect, it } from 'vitest';

import {
  acceptTechnicalStackSuggestion,
  buildTechnicalStackState,
  suggestionId,
  technicalStackOverrideValue,
} from './technical-stack.service.js';

describe('technical stack overrides', () => {
  it('keeps manual stack effective and surfaces new provider entries as deltas', () => {
    const providerStack = [
      {
        label: 'Cloud',
        items: [
          { name: 'Azure', source: 'enrichment:apollo', confidence: 0.91 },
          { name: 'AWS', source: 'enrichment:apollo', confidence: 0.84 },
        ],
      },
    ];
    const override = technicalStackOverrideValue([
      {
        label: 'Cloud',
        items: [{ name: 'Azure', source: 'manual', confidence: 1 }],
      },
    ]);

    const state = buildTechnicalStackState({
      companyKey: 'mantu',
      providerStack,
      overrideValue: override,
      providerUpdatedAt: '2026-06-16T12:00:00.000Z',
    });

    expect(state.effectiveStack[0]?.items.map((item) => item.name)).toEqual(['Azure']);
    expect(state.suggestions).toEqual([
      expect.objectContaining({
        id: suggestionId('Cloud', { name: 'AWS' }),
        label: 'Cloud',
        item: expect.objectContaining({ name: 'AWS', source: 'enrichment:apollo' }),
      }),
    ]);
  });

  it('accepts a provider delta into the manual stack with explicit provenance', () => {
    const state = buildTechnicalStackState({
      companyKey: 'mantu',
      providerStack: [
        {
          label: 'Data',
          items: [{ name: 'Snowflake', source: 'enrichment:apollo', confidence: 0.79 }],
        },
      ],
      overrideValue: technicalStackOverrideValue([]),
    });

    const nextStack = acceptTechnicalStackSuggestion(state, suggestionId('Data', { name: 'Snowflake' }));

    expect(nextStack).toEqual([
      {
        label: 'Data',
        items: [
          {
            name: 'Snowflake',
            source: 'manual:accepted:enrichment:apollo',
            confidence: 1,
          },
        ],
      },
    ]);
  });

  it('keeps dismissed provider deltas hidden across refreshes', () => {
    const dismissedId = suggestionId('Security', { name: 'CrowdStrike' });
    const state = buildTechnicalStackState({
      companyKey: 'mantu',
      providerStack: [
        {
          label: 'Security',
          items: [{ name: 'CrowdStrike', source: 'enrichment:apollo', confidence: 0.88 }],
        },
      ],
      overrideValue: technicalStackOverrideValue([], [dismissedId]),
    });

    expect(state.suggestions).toEqual([]);
  });

  it('keeps several named stacks apart when they share a category', () => {
    const override = technicalStackOverrideValue([
      { label: 'Cloud', items: [{ name: 'Azure', source: 'manual', confidence: 1 }] },
      {
        stack: 'Oncology R&D',
        label: 'Cloud',
        items: [{ name: 'AWS', source: 'manual', confidence: 1 }],
      },
      {
        stack: ' Oncology R&D ',
        label: 'cloud',
        items: [{ name: 'Google Cloud', source: 'manual', confidence: 1 }],
      },
    ]);

    expect(override.stack).toEqual([
      { label: 'Cloud', items: [expect.objectContaining({ name: 'Azure' })] },
      {
        stack: 'Oncology R&D',
        label: 'Cloud',
        items: [
          expect.objectContaining({ name: 'AWS' }),
          expect.objectContaining({ name: 'Google Cloud' }),
        ],
      },
    ]);
  });

  it('treats a blank stack name as the main stack', () => {
    const override = technicalStackOverrideValue([
      { stack: '  ', label: 'Data', items: [{ name: 'Snowflake', source: 'manual', confidence: 1 }] },
      { label: 'Data', items: [{ name: 'Databricks', source: 'manual', confidence: 1 }] },
    ]);

    expect(override.stack).toEqual([
      {
        label: 'Data',
        items: [
          expect.objectContaining({ name: 'Snowflake' }),
          expect.objectContaining({ name: 'Databricks' }),
        ],
      },
    ]);
  });
});
