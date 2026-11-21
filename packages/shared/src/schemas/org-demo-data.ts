import { z } from 'zod';

/** Per-org switch. Off means fixture and sample numbers are not shown. */
export const OrgDemoDataSettings = z.object({
  demoData: z.boolean(),
});
export type OrgDemoDataSettings = z.infer<typeof OrgDemoDataSettings>;

export const OrgDemoDataSettingsUpdate = z.object({
  demoData: z.boolean(),
});
export type OrgDemoDataSettingsUpdate = z.infer<typeof OrgDemoDataSettingsUpdate>;
