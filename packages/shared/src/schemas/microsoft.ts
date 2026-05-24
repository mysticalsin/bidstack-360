import { z } from 'zod';

export const MicrosoftConnectionStatus = z.object({
  ssoConnected: z.boolean(),
  ssoEmail: z.string().nullable(),
  ssoMethod: z.enum(['oauth', 'saml']).nullable(),
  emailConnected: z.boolean(),
  emailLastSync: z.string().datetime().nullable(),
  emailError: z.string().nullable(),
  calendarConnected: z.boolean(),
  calendarLastSync: z.string().datetime().nullable(),
  calendarError: z.string().nullable(),
});
export type MicrosoftConnectionStatus = z.infer<typeof MicrosoftConnectionStatus>;

export const MicrosoftConnectRequest = z.object({
  service: z.enum(['email', 'calendar']),
});
export type MicrosoftConnectRequest = z.infer<typeof MicrosoftConnectRequest>;

export const MicrosoftConnectResponse = z.object({
  authUrl: z.string().url(),
});
export type MicrosoftConnectResponse = z.infer<typeof MicrosoftConnectResponse>;

export const MicrosoftDisconnectRequest = z.object({
  service: z.enum(['email', 'calendar']),
});
export type MicrosoftDisconnectRequest = z.infer<typeof MicrosoftDisconnectRequest>;

export const MicrosoftCallbackQuery = z.object({
  code: z.string(),
  state: z.string(),
});
export type MicrosoftCallbackQuery = z.infer<typeof MicrosoftCallbackQuery>;
