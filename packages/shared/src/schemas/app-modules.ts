/**
 * app-modules.ts — per-org module toggles (admin-managed in Settings).
 *
 * - agentStudioEnabled: show the Agent Studio (Crew automation) section. Default
 *   FALSE — hidden until an admin turns it on.
 * - appflowyEnabled + appflowyUrl: the embedded AppFlowy "Workspace" collaboration
 *   section. The URL points at a deployed AppFlowy instance (operator-provided);
 *   the embed shows a setup state until both are set. See docs/solutions/appflowy-workspace.md.
 */
import { z } from 'zod';

export const AppModules = z.object({
  agentStudioEnabled: z.boolean().default(false),
  appflowyEnabled: z.boolean().default(false),
  appflowyUrl: z.string().url().max(2000).nullable().default(null),
});
export type AppModules = z.infer<typeof AppModules>;

export const AppModulesUpdate = AppModules.partial();
export type AppModulesUpdate = z.infer<typeof AppModulesUpdate>;

export const APP_MODULES_DEFAULT: AppModules = {
  agentStudioEnabled: false,
  appflowyEnabled: false,
  appflowyUrl: null,
};
