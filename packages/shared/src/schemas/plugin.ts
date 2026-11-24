import { z } from 'zod';

export const Plugin = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  manifestUrl: z.string().url(),
  name: z.string().min(1),
  version: z.string(),
  permissions: z.array(z.string()).default([]),
  config: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(true),
  installedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Plugin = z.infer<typeof Plugin>;

export const PluginInstall = z.object({
  manifestUrl: z.string().url(),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type PluginInstall = z.infer<typeof PluginInstall>;
