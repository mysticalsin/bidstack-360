import { z } from 'zod';

export const ORG_LOCALE_CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'JPY'] as const;

export const ORG_LOCALE_DATE_FORMATS = [
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD.MM.YYYY',
] as const;

export const ORG_LOCALE_TIMEZONES = [
  'America/Toronto',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
] as const;

export const ORG_LOCALE_DEFAULT = {
  currency: 'CAD',
  dateFormat: 'YYYY-MM-DD',
  timezone: 'America/Toronto',
} as const;

export const OrgLocaleSettings = z.object({
  currency: z.enum(ORG_LOCALE_CURRENCIES).default(ORG_LOCALE_DEFAULT.currency),
  dateFormat: z.enum(ORG_LOCALE_DATE_FORMATS).default(ORG_LOCALE_DEFAULT.dateFormat),
  timezone: z.enum(ORG_LOCALE_TIMEZONES).default(ORG_LOCALE_DEFAULT.timezone),
});
export type OrgLocaleSettings = z.infer<typeof OrgLocaleSettings>;

export const OrgLocaleSettingsUpdate = OrgLocaleSettings.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Update body must contain at least one field' },
);
export type OrgLocaleSettingsUpdate = z.infer<typeof OrgLocaleSettingsUpdate>;
