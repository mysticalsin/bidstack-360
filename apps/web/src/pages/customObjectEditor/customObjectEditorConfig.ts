// Shared constants for the Custom Object editor screens.

export const FIELD_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multi_select',
  'currency',
  'url',
  'email',
  'phone',
] as const;

export const CARDINALITIES = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_MANY'] as const;

export const PRESET_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
];
