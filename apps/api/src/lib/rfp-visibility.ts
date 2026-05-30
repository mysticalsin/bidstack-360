// RFP visibility helper.
//
// Requirement: a regular user sees (and manages) only the RFPs they own;
// admins get the org-wide view (all RFPs + their values + analytics).

import type { FastifyRequest } from 'fastify';

/**
 * Whether the caller may see and manage every RFP in the org, rather than only
 * the ones they own.
 *
 * WHY role-based and not requirePermission(): this widens read/write
 * VISIBILITY (admins get the org-wide "all RFPs + values" view) — it is not a
 * privileged action gate. It mirrors the frontend's useIsAdmin()
 * (role === 'admin') so the API and UI agree on exactly who gets the admin
 * view. req.auth.role is derived from the verified Clerk org-role claim (a
 * loopback stub in dev); Clerk org-admins also receive a DB "Admin" grant via
 * JIT provisioning in plugins/auth.ts, so this stays consistent with
 * ADR-0001's "no claim-only privilege" stance on the read path.
 */
export function canViewAllRfps(req: FastifyRequest): boolean {
  return req.auth.role === 'admin';
}
