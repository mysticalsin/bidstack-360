import { z } from 'zod';

import {
  TechnicalStackCategory,
  type TechnicalStackCategory as TechnicalStackCategoryType,
  type TechnicalStackItemType,
  type TechnicalStackState,
} from '@bidstack/shared';

export const TECHNICAL_STACK_FIELD_KEY = 'technicalStack';

const TechnicalStackOverrideValue = z.object({
  stack: z.array(TechnicalStackCategory).default([]),
  dismissedSuggestionIds: z.array(z.string().min(1)).default([]),
});

export type TechnicalStackOverrideValue = z.infer<typeof TechnicalStackOverrideValue>;

interface BuildTechnicalStackStateInput {
  companyKey: string;
  providerStack: TechnicalStackCategoryType[];
  overrideValue?: unknown;
  overrideUpdatedAt?: Date | string | null;
  providerUpdatedAt?: Date | string | null;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeStackItem(item: TechnicalStackItemType): TechnicalStackItemType | null {
  const name = item.name.trim();
  if (!name) return null;
  return {
    name,
    source: item.source.trim() || 'manual',
    confidence: Math.min(1, Math.max(0, item.confidence)),
  };
}

export function normalizeTechnicalStack(
  stack: TechnicalStackCategoryType[],
): TechnicalStackCategoryType[] {
  const byLabel = new Map<string, Map<string, TechnicalStackItemType>>();
  const labels = new Map<string, string>();

  for (const category of stack) {
    const label = category.label.trim() || 'Other';
    const labelKey = slug(label) || 'other';
    labels.set(labelKey, labels.get(labelKey) ?? label);
    const items = byLabel.get(labelKey) ?? new Map<string, TechnicalStackItemType>();

    for (const rawItem of category.items) {
      const item = normalizeStackItem(rawItem);
      if (!item) continue;
      const itemKey = slug(item.name);
      const existing = items.get(itemKey);
      items.set(itemKey, existing && existing.confidence > item.confidence ? existing : item);
    }

    byLabel.set(labelKey, items);
  }

  return [...byLabel.entries()]
    .map(([labelKey, items]) => ({
      label: labels.get(labelKey) ?? 'Other',
      items: [...items.values()],
    }))
    .filter((category) => category.items.length > 0);
}

export function suggestionId(label: string, item: Pick<TechnicalStackItemType, 'name'>): string {
  return `${slug(label) || 'other'}:${slug(item.name) || 'item'}`;
}

export function parseTechnicalStackOverride(value: unknown): TechnicalStackOverrideValue | null {
  const objectParsed = TechnicalStackOverrideValue.safeParse(value);
  if (objectParsed.success) {
    return {
      stack: normalizeTechnicalStack(objectParsed.data.stack),
      dismissedSuggestionIds: [...new Set(objectParsed.data.dismissedSuggestionIds)],
    };
  }

  const legacyParsed = z.array(TechnicalStackCategory).safeParse(value);
  if (legacyParsed.success) {
    return { stack: normalizeTechnicalStack(legacyParsed.data), dismissedSuggestionIds: [] };
  }

  return null;
}

export function technicalStackOverrideValue(
  stack: TechnicalStackCategoryType[],
  dismissedSuggestionIds: string[] = [],
): TechnicalStackOverrideValue {
  return {
    stack: normalizeTechnicalStack(stack),
    dismissedSuggestionIds: [...new Set(dismissedSuggestionIds.filter(Boolean))],
  };
}

export function buildTechnicalStackState({
  companyKey,
  providerStack,
  overrideValue,
  overrideUpdatedAt,
  providerUpdatedAt,
}: BuildTechnicalStackStateInput): TechnicalStackState {
  const provider = normalizeTechnicalStack(providerStack);
  const override = parseTechnicalStackOverride(overrideValue);
  const manual = override ? normalizeTechnicalStack(override.stack) : provider;
  const manualNames = new Set(
    manual.flatMap((category) => category.items.map((item) => slug(item.name))),
  );
  const dismissed = new Set(override?.dismissedSuggestionIds ?? []);
  const suggestionProviderUpdatedAt = toIso(providerUpdatedAt);

  const suggestions = provider.flatMap((category) =>
    category.items
      .map((item) => ({
        id: suggestionId(category.label, item),
        label: category.label,
        item,
        providerUpdatedAt: suggestionProviderUpdatedAt,
      }))
      .filter((suggestion) => !manualNames.has(slug(suggestion.item.name)))
      .filter((suggestion) => !dismissed.has(suggestion.id)),
  );

  return {
    companyKey,
    manualStack: manual,
    providerStack: provider,
    effectiveStack: override ? manual : provider,
    suggestions,
    updatedAt: toIso(overrideUpdatedAt),
  };
}

export function acceptTechnicalStackSuggestion(
  state: TechnicalStackState,
  suggestionIdToAccept: string,
): TechnicalStackCategoryType[] | null {
  const suggestion = state.suggestions.find((item) => item.id === suggestionIdToAccept);
  if (!suggestion) return null;
  const next = normalizeTechnicalStack(state.manualStack);
  const labelKey = slug(suggestion.label);
  const existing = next.find((category) => slug(category.label) === labelKey);
  const acceptedItem: TechnicalStackItemType = {
    name: suggestion.item.name,
    source: `manual:accepted:${suggestion.item.source}`,
    confidence: 1,
  };

  if (existing) {
    existing.items = normalizeTechnicalStack([
      { label: existing.label, items: [...existing.items, acceptedItem] },
    ])[0]?.items ?? existing.items;
  } else {
    next.push({ label: suggestion.label, items: [acceptedItem] });
  }

  return normalizeTechnicalStack(next);
}
