/**
 * Authenticated routes that intentionally do NOT consult an RBAC permission.
 *
 * The census (route-authz-census.integration.test.ts) fails on any
 * authenticated route that neither hits RBAC with a 403 for a permission-less
 * user nor appears here. Every entry must say WHY it is safe: either the data
 * is the caller's own (self-scoped by userId in the query), or it is org-level
 * reference/config data every member needs to render the app.
 *
 * Keys are `"METHOD /full/url"` as registered (fastify route pattern).
 */
export const UNGATED_ALLOWLIST: Record<string, string> = {
  // ── Self-scoped: every query filters by req.auth.userId ──────────────────
  'GET /api/v1/me/capabilities': 'Returns the caller’s own permissions.',
  'GET /api/v1/notifications': 'Self-scoped (orgId + userId).',
  'GET /api/v1/notifications/prefs': 'Self-scoped (userId).',
  'PUT /api/v1/notifications/prefs': 'Self-scoped (userId).',
  'PATCH /api/v1/notifications/:id/read': 'Self-scoped (orgId + userId).',
  'POST /api/v1/notifications/read-all': 'Self-scoped (orgId + userId).',
  'GET /api/v1/saved-views': 'Own views plus views explicitly shared in the org.',
  'POST /api/v1/saved-views': 'Creates a view owned by the caller.',
  'PATCH /api/v1/saved-views/:id': 'Owner-or-admin check in loadOwnedOrAdmin.',
  'DELETE /api/v1/saved-views/:id': 'Owner-or-admin check in loadOwnedOrAdmin.',
  'GET /api/v1/calendar/events': 'Self-scoped (orgId + ownerId = caller).',
  'POST /api/v1/calendar/events': 'Creates an event owned by the caller.',
  'PATCH /api/v1/calendar/events/:id': 'Owner-scoped lookup (ownerId = caller).',
  'DELETE /api/v1/calendar/events/:id': 'Owner-scoped lookup (ownerId = caller).',
  'GET /api/v1/booking-pages': 'Self-scoped (orgId + userId).',
  'POST /api/v1/booking-pages': 'Creates a page owned by the caller.',
  'PUT /api/v1/booking-pages/:id': 'Owner-scoped lookup (userId = caller).',
  'GET /api/v1/settings/microsoft': 'Caller’s own Microsoft connection (User row).',
  'POST /api/v1/settings/microsoft/connect': 'Connects the caller’s own account (User row).',
  'POST /api/v1/settings/microsoft/disconnect': 'Disconnects the caller’s own account (User row).',
  'GET /api/v1/integrations/status': 'Caller’s own integration token statuses.',
  'GET /api/v1/integrations/gmail/oauth/start': 'Per-user mailbox OAuth for the caller.',
  'DELETE /api/v1/integrations/gmail/disconnect': 'Revokes the caller’s own token.',
  'GET /api/v1/integrations/microsoft/mail/oauth/start': 'Per-user mailbox OAuth for the caller.',
  'DELETE /api/v1/integrations/microsoft/mail/disconnect': 'Revokes the caller’s own token.',
  'POST /api/v1/ai-assistant/sessions/:sessionId/feedback':
    'Session lookup is scoped to orgId + userId = caller.',
  'GET /api/v1/crew-runs': 'Owner-or-admin scoped list (crews.ts).',
  'GET /api/v1/crew-runs/:id': 'Owner-or-admin scoped read (crews.ts).',

  // ── Org reference data every member needs to render the app ──────────────
  'GET /api/v1/config/features': 'Feature flags for the UI shell.',
  'GET /api/v1/org-settings/locale': 'Org locale/currency used by every page.',
  'GET /api/v1/pipeline-stages': 'Stage catalogue (names/order); no deal data.',
  'GET /api/v1/territories': 'Territory catalogue used by pickers; analytics are gated.',
  'GET /api/v1/users': 'Owner pickers for AE/SDR (see users.ts); users:read gates management.',
  'GET /api/v1/onboarding/sample-data/status': 'Boolean onboarding state.',
  'GET /api/v1/onboarding/templates': 'Static template catalogue.',
  'GET /api/v1/integrations/dust/status': 'Configured/healthy flag shown in the sidebar.',
  'GET /api/v1/crews': 'Crew catalogue is readable by any member by design (crews.ts header); authoring is admin-only.',
  'GET /api/v1/crews/:id': 'Crew catalogue is readable by any member by design; authoring is admin-only.',
  'GET /api/v1/crew-agents': 'Agent catalogue readable by any member by design; authoring is admin-only.',
  'POST /api/v1/help/articles/:slug/feedback': 'Help-article thumbs up/down; no tenant data.',

  // ── Gated inside the handler (per-item, not per-route) ───────────────────
  'GET /api/v1/search':
    'Each result type is filtered by its own :read permission (TYPE_PERMISSION) and opportunities by access scope.',
};
