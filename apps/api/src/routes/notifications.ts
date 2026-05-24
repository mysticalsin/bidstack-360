/**
 * Native push notification routes.
 *
 * Routes:
 *   POST   /notifications/native-push/register   — store / refresh Expo push token
 *   DELETE /notifications/native-push/register   — deactivate token on sign-out
 *
 * WHY upsert instead of insert: the Expo token can be rotated by iOS/Android on
 * every app reinstall. Using upsert on (orgId, userId, deviceId) prevents stale
 * rows from accumulating and keeps the active-token query O(1) per device.
 *
 * Security: requires a valid Clerk JWT (auth plugin runs before this route).
 * Org-scoped: every DB operation includes orgId from request.auth.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

// ── Schemas ─────────────────────────────────────────────────────────────────

const RegisterBody = z.object({
  /** Expo push token — must start with ExponentPushToken[ */
  token: z
    .string()
    .min(1)
    .max(256)
    .refine(
      (t) => t.startsWith('ExponentPushToken[') || t.startsWith('expo-push-token-'),
      { message: 'token must be a valid Expo push token' },
    ),
  /** EXPO | APNS | FCM */
  provider: z.enum(['EXPO', 'APNS', 'FCM']).default('EXPO'),
  /** ios | android */
  platform: z.enum(['ios', 'android']).default('ios'),
  /**
   * Stable device identifier — generated once by the mobile app and stored in
   * SecureStore. Allows upsert rather than blind insert.
   */
  deviceId: z.string().min(1).max(128).optional(),
});

const DeregisterBody = z.object({
  token: z.string().min(1).max(256),
});

const TokenResponse = z.object({
  id: z.string().uuid(),
  token: z.string(),
  provider: z.string(),
  platform: z.string(),
  active: z.boolean(),
});

const MessageResponse = z.object({ message: z.string() });

// ── Plugin ───────────────────────────────────────────────────────────────────

export const nativePushRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * Register or refresh an Expo push token.
   *
   * Idempotent: upsert on (orgId, userId, deviceId).
   * If deviceId is omitted we fall back to the token value itself as the key
   * (safe because Expo tokens are globally unique per installation).
   */
  app.post(
    '/notifications/native-push/register',
    {
      schema: {
        body: RegisterBody,
        response: { 200: TokenResponse },
        tags: ['notifications'],
        summary: 'Register native push token',
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const { token, provider, platform, deviceId } = req.body;

      // Use provided deviceId, or fall back to the token itself as a stable key
      const resolvedDeviceId = deviceId ?? token;

      const record = await prisma.nativePushToken.upsert({
        where: {
          orgId_userId_deviceId: {
            orgId,
            userId,
            deviceId: resolvedDeviceId,
          },
        },
        update: {
          token,
          provider,
          platform,
          active: true,
          updatedAt: new Date(),
        },
        create: {
          orgId,
          userId,
          deviceId: resolvedDeviceId,
          token,
          provider,
          platform,
          active: true,
        },
        select: { id: true, token: true, provider: true, platform: true, active: true },
      });

      req.log.info({ tokenId: record.id, provider, platform }, 'native push token registered');

      return record;
    },
  );

  /**
   * Deactivate a push token.
   *
   * Called when the user signs out or disables push notifications in settings.
   * Soft-deletes (sets active=false) rather than hard-deleting so the worker
   * can gracefully handle in-flight notifications without DB errors.
   */
  app.delete(
    '/notifications/native-push/register',
    {
      schema: {
        body: DeregisterBody,
        response: { 200: MessageResponse },
        tags: ['notifications'],
        summary: 'Deactivate native push token',
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const { token } = req.body;

      // WHY updateMany: a user might have the same token on multiple org contexts
      // (unlikely but possible with multi-org support). Deactivate all matches.
      const { count } = await prisma.nativePushToken.updateMany({
        where: { orgId, token },
        data: { active: false },
      });

      req.log.info({ count, token: token.slice(0, 20) + '…' }, 'native push token deactivated');

      return { message: `${count} token(s) deactivated` };
    },
  );
};
