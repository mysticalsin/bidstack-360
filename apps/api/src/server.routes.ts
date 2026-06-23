/**
 * server.routes.ts — route registrations.
 *
 * All `server.register(xyzRoutes, { prefix })` calls live here.
 * Extracted from server.ts (BS-R1 file-size refactor).
 *
 * Registered after all plugin setup completes in buildServer().
 */
import type { FastifyInstance } from 'fastify';

import { realtimeRoutes } from './routes/realtime.js';
import { auditLogsRoutes } from './routes/audit-logs.js';
import { collaborationRoutes } from './routes/collaboration.js';
import { notificationsRoutes } from './routes/notifications.js';
import { contactsRoutes } from './routes/contacts.js';
import { crmDashboardRoutes } from './routes/crm/dashboard.js';
import { crmCompanyRoutes } from './routes/crm/companies.js';
import { crmHealthRoutes } from './routes/crm/health.js';
import { crmConnectorRoutes } from './routes/crm/connectors.js';
import { crmWidgetRoutes } from './routes/crm/widgets.js';
import { crmSummaryRoutes } from './routes/crm/summary.js';
import { dustRoutes } from './routes/dust-integration.js';
import { dustCredentialsRoutes } from './routes/dust-credentials.routes.js';
import { agentProviderCredentialsRoutes } from './routes/agent-provider-credentials.routes.js';
import { dataProviderCredentialsRoutes } from './routes/data-provider-credentials.routes.js';
import { exchangeRatesRoutes } from './routes/exchange-rates.js';
import { filesRoutes } from './routes/files.js';
import { leadRoutes } from './routes/leads.js';
import { kamInitiativeRoutes } from './routes/kam-initiatives.js';
import { kamTaskRoutes } from './routes/kam-tasks.js';
import { kamSessionRoutes } from './routes/kam-sessions.js';
import { kamDraftRoutes } from './routes/kam-drafts.js';
import { kamHandoffRoutes } from './routes/kam-handoffs.js';
import { notesRoutes } from './routes/notes.js';
import { opportunityContactsRoutes } from './routes/opportunity-contacts.js';
import { erpRoutes } from './routes/erp-integration.js';
import { opportunityRoutes } from './routes/opportunities.js';
import { opportunityTimelineRoutes } from './routes/opportunity-timeline.js';
import { predictiveRoutes } from './routes/predictive.js';
import { predictiveScoringRoutes } from './routes/predictive-scoring.js';
import { searchRoutes } from './routes/search.js';
import { serviceDeskRoutes } from './routes/service-desk.js';
import { reportsRoutes } from './routes/reports.js';
// Analytics report builder (custom reports + dashboards + entity field metadata)
import { analyticsReportsRoutes } from './routes/analytics-reports.js';
import { analyticsDashboardsRoutes } from './routes/analytics-dashboards.js';
import { configFeaturesRoutes } from './routes/config-features.js';
import { serumRoutes } from './routes/serum.js';
import { salesToolkitsRoutes } from './routes/sales-toolkits.js';
import { sectorViewRoutes } from './routes/sector-view.js';
import { infosearchRoutes } from './routes/infosearch.js';
import { crossSellRoutes } from './routes/cross-sell.js';
import { contractAgreementRoutes } from './routes/contract-agreements.js';
import { winLossRoutes } from './routes/win-loss.js';
import { governanceRoutes } from './routes/governance.js';
import { projectReferencesRoutes } from './routes/project-references.js';
import { orgSettingsRoutes } from './routes/org-settings.js';
import { tasksRoutes } from './routes/tasks.js';
import { territoryRoutes } from './routes/territories.js';
import { accountIntelRoutes } from './routes/account-intel.js';
import { webhooksRoutes } from './routes/webhooks.js';
import { workflowRoutes } from './routes/workflows.js';
// Sprint 1 — Krayin import
import { tagRoutes } from './routes/tags.js';
import { emailTemplateRoutes } from './routes/email-templates.js';
import { leadRotRoutes } from './routes/lead-rot.js';
import { pluginRoutes } from './routes/plugins.js';
import { usersRoutes } from './routes/users.js';
import { webhookSubscriptionsRoutes } from './routes/webhook-subscriptions.js';
import { companiesRoutes } from './routes/companies.js';
import { customFieldsRoutes } from './routes/custom-fields.js';
import { roleRoutes } from './routes/roles.js';
// M7 — access groups (admin-managed data-scoping groups)
import { userGroupRoutes } from './routes/user-groups.js';
import { microsoftRoutes } from './routes/microsoft.js';
import { pipelineStageRoutes } from './routes/pipeline-stages.js';
import { accountsRoutes } from './routes/accounts.js';
import { referencesRoutes } from './routes/references.js';
import { bidScoreRoutes } from './routes/bid-scores.js';
import { proposalRoutes } from './routes/proposals.js';
import { crewAgentRoutes } from './routes/crew-agents.js';
import { crewRoutes } from './routes/crews.js';
import { activityRoutes } from './routes/activities.js';
import { bidWorkspaceRoutes } from './routes/bid-workspace.js';
import { bidWorkspaceRequirementRoutes } from './routes/bid-workspace-requirements.js';
import { bidWorkspaceRfpRoutes } from './routes/bid-workspace-rfp.js';
import { calendarRoutes } from './routes/calendar.js';
import { bookingsRoutes } from './routes/bookings.js';
// NocoBase RFP integration
// Wave 4 — AI assistant
import { aiAssistantRoutes } from './routes/ai-assistant.js';
import { documentTemplatesRoutes } from './routes/document-templates.js';
import { signaturesRoutes } from './routes/signatures.js';
import { publicSignRoutes } from './routes/public-sign.js';
// Wave 5 — Outlook / Microsoft Graph Mail + Slack
import { gmailOAuthRoutes } from './routes/integrations/gmail.js';
import { microsoftMailOAuthRoutes } from './routes/integrations/microsoft-mail.js';
import { emailRoutes } from './routes/integrations/email.js';
import { microsoftWebhookRoutes } from './routes/integrations/microsoft-webhook.js';
import { slackOAuthRoutes } from './routes/integrations/slack.js';
import { slackCommandsPlugin } from './routes/integrations/slack-commands.js';
// Wave 5 — Onboarding (templates + sample data)
import { onboardingRoutes } from './routes/onboarding.js';
// Wave 5 — Help center feedback
import { helpRoutes } from './routes/help.js';
// Wave 7 — Custom Objects (Salesforce parity)
import { customObjectRoutes } from './routes/custom-objects.js';
// Wave 7 — Twilio SMS (webhook = unauthenticated, sms routes = authenticated)
import { twilioWebhookRoutes, smsRoutes } from './routes/integrations/twilio.js';
// Wave 8 — Voice + Video calls
import { callsRoutes } from './routes/calls.js';
import {
  zoomCallWebhookRoutes,
  teamsCallWebhookRoutes,
  twilioVoiceWebhookRoutes,
} from './routes/integrations/calls-webhooks.js';
// Wave 8 — Customer Success
import { csRoutes } from './routes/cs.js';
// Wave 9 — Public NPS response page (server-rendered HTML, no auth, no JS)
import { publicNpsRoutes } from './routes/public-nps.js';
// Wave 9 — RFP pipeline HTTP endpoints (upload, SSE stream, autofill, approval gate)
import { rfpPipelineRoutes } from './routes/rfp-pipeline.js';
import { competitorRoutes } from './routes/competitors.js';
// Wave 10 — Operational monitoring (queue depths, embedding failure rate, alerts)
import { monitoringRoutes } from './routes/monitoring.js';
import { opsSentrySmokeRoutes } from './routes/ops-sentry-smoke.js';
// Data migration: CSV import, cancel/undo destructive operations
import { migrationRoutes } from './routes/migrations.js';
// Data migration: HubSpot OAuth + import
import { hubspotMigrationRoutes } from './routes/migrations-hubspot.routes.js';
// Public demo door (only self-registers when DEMO_MODE is armed)
import { demoRoutes } from './routes/demo.js';
// GDPR Art. 20 — tenant data-portability export
import { tenantExportRoutes } from './routes/tenant-export.js';
// GDPR Art. 17 — per-data-subject erasure (anonymization)
import { erasureRoutes } from './routes/erasure.js';

export async function registerRoutes(server: FastifyInstance): Promise<void> {
  await server.register(opportunityRoutes, { prefix: '/api/v1' });
  await server.register(contactsRoutes, { prefix: '/api/v1' });
  await server.register(tasksRoutes, { prefix: '/api/v1' });
  await server.register(reportsRoutes, { prefix: '/api/v1' });
  // Analytics report builder. Param routes validate :id as uuid; Fastify's
  // radix tree keeps the legacy static /reports/{pipeline,...} routes winning.
  await server.register(analyticsReportsRoutes, { prefix: '/api/v1' });
  await server.register(analyticsDashboardsRoutes, { prefix: '/api/v1' });
  await server.register(configFeaturesRoutes, { prefix: '/api/v1' });
  await server.register(serumRoutes, { prefix: '/api/v1' });
  await server.register(salesToolkitsRoutes, { prefix: '/api/v1' });
  await server.register(sectorViewRoutes, { prefix: '/api/v1' });
  await server.register(infosearchRoutes, { prefix: '/api/v1' });
  await server.register(crossSellRoutes, { prefix: '/api/v1' });
  await server.register(contractAgreementRoutes, { prefix: '/api/v1' });
  await server.register(winLossRoutes, { prefix: '/api/v1' });
  await server.register(governanceRoutes, { prefix: '/api/v1' });
  await server.register(projectReferencesRoutes, { prefix: '/api/v1' });
  await server.register(kamInitiativeRoutes, { prefix: '/api/v1' });
  await server.register(kamTaskRoutes, { prefix: '/api/v1' });
  await server.register(kamSessionRoutes, { prefix: '/api/v1' });
  await server.register(kamDraftRoutes, { prefix: '/api/v1' });
  await server.register(kamHandoffRoutes, { prefix: '/api/v1' });
  await server.register(orgSettingsRoutes, { prefix: '/api/v1' });
  await server.register(searchRoutes, { prefix: '/api/v1' });
  await server.register(auditLogsRoutes, { prefix: '/api/v1' });
  await server.register(crmDashboardRoutes, { prefix: '/api/v1' });
  await server.register(crmCompanyRoutes, { prefix: '/api/v1' });
  await server.register(crmHealthRoutes, { prefix: '/api/v1' });
  await server.register(crmConnectorRoutes, { prefix: '/api/v1' });
  await server.register(crmWidgetRoutes, { prefix: '/api/v1' });
  await server.register(crmSummaryRoutes, { prefix: '/api/v1' });
  await server.register(notesRoutes, { prefix: '/api/v1' });
  await server.register(opportunityContactsRoutes, { prefix: '/api/v1' });
  await server.register(filesRoutes, { prefix: '/api/v1' });
  await server.register(dustRoutes, { prefix: '/api/v1/integrations' });
  await server.register(dustCredentialsRoutes, { prefix: '/api/v1/integrations' });
  await server.register(agentProviderCredentialsRoutes, { prefix: '/api/v1/integrations' });
  await server.register(dataProviderCredentialsRoutes, { prefix: '/api/v1/integrations' });
  await server.register(erpRoutes, { prefix: '/api/v1/integrations' });

  // Backward-compatible redirects: /api/v1/integrations/odoo/* → /api/v1/integrations/erp/*
  server.get('/api/v1/integrations/odoo/*', async (req, reply) => {
    const target = req.url.replace('/odoo/', '/erp/');
    return reply.redirect(target, 307);
  });
  server.post('/api/v1/integrations/odoo/*', async (req, reply) => {
    const target = req.url.replace('/odoo/', '/erp/');
    return reply.redirect(target, 307);
  });

  await server.register(webhooksRoutes, { prefix: '/webhooks' });
  await server.register(territoryRoutes, { prefix: '/api/v1' });
  await server.register(accountIntelRoutes, { prefix: '/api/v1' });
  await server.register(opportunityTimelineRoutes, { prefix: '/api/v1' });
  await server.register(collaborationRoutes, { prefix: '/api/v1' });
  await server.register(notificationsRoutes, { prefix: '/api/v1' });
  await server.register(predictiveRoutes, { prefix: '/api/v1' });
  await server.register(predictiveScoringRoutes, { prefix: '/api/v1' });
  await server.register(serviceDeskRoutes, { prefix: '/api/v1' });
  await server.register(workflowRoutes, { prefix: '/api/v1' });
  await server.register(leadRoutes, { prefix: '/api/v1' });
  // Sprint 1 — Krayin import
  await server.register(tagRoutes, { prefix: '/api/v1' });
  await server.register(emailTemplateRoutes, { prefix: '/api/v1' });
  await server.register(leadRotRoutes, { prefix: '/api/v1' });
  await server.register(pluginRoutes, { prefix: '/api/v1' });
  await server.register(usersRoutes, { prefix: '/api/v1' });
  await server.register(webhookSubscriptionsRoutes, { prefix: '/api/v1' });
  await server.register(companiesRoutes, { prefix: '/api/v1' });
  await server.register(customFieldsRoutes, { prefix: '/api/v1' });
  await server.register(roleRoutes, { prefix: '/api/v1' });
  await server.register(userGroupRoutes, { prefix: '/api/v1' });
  await server.register(pipelineStageRoutes, { prefix: '/api/v1' });
  await server.register(microsoftRoutes, { prefix: '/api/v1' });
  await server.register(accountsRoutes, { prefix: '/api/v1' });
  await server.register(referencesRoutes, { prefix: '/api/v1' });
  await server.register(bidScoreRoutes, { prefix: '/api/v1' });
  await server.register(proposalRoutes, { prefix: '/api/v1' });
  await server.register(crewAgentRoutes, { prefix: '/api/v1' });
  await server.register(crewRoutes, { prefix: '/api/v1' });
  await server.register(activityRoutes, { prefix: '/api/v1' });
  await server.register(bidWorkspaceRoutes, { prefix: '/api/v1' });
  await server.register(bidWorkspaceRequirementRoutes, { prefix: '/api/v1' });
  await server.register(bidWorkspaceRfpRoutes, { prefix: '/api/v1' });
  await server.register(exchangeRatesRoutes, { prefix: '/api/v1' });
  // Wave 3 — calendar + booking
  await server.register(calendarRoutes, { prefix: '/api/v1' });
  // Public booking routes skip auth middleware — register without /api/v1 prefix
  // so /book/:slug resolves cleanly for the public page
  await server.register(bookingsRoutes, { prefix: '/api/v1' });
  // NocoBase RFP workspace routes

  // Wave 4 — AI Assistant
  await server.register(aiAssistantRoutes, { prefix: '/api/v1' });
  await server.register(documentTemplatesRoutes, { prefix: '/api/v1' });
  await server.register(signaturesRoutes, { prefix: '/api/v1' });
  await server.register(publicSignRoutes, { prefix: '/api/v1' });

  // Wave 5 — Outlook (Microsoft Graph Mail) + Gmail OAuth flows
  // WHY /api/v1/integrations prefix: consistent with other integration routes (dust, erp)
  await server.register(gmailOAuthRoutes, { prefix: '/api/v1/integrations' });
  await server.register(microsoftMailOAuthRoutes, { prefix: '/api/v1/integrations' });
  await server.register(slackOAuthRoutes, { prefix: '/api/v1/integrations' });
  await server.register(slackCommandsPlugin, { prefix: '/api/v1' });
  await server.register(emailRoutes, { prefix: '/api/v1' });
  // Webhook endpoint: NO auth prefix — Graph calls this as an unauthenticated third party.
  // clientState secret provides the anti-forgery verification layer.
  await server.register(microsoftWebhookRoutes, { prefix: '/api/v1/integrations' });

  // Wave 5 — Onboarding templates + sample data management
  await server.register(onboardingRoutes, { prefix: '/api/v1' });
  // Wave 5 — Help center article feedback
  await server.register(helpRoutes, { prefix: '/api/v1' });

  // Wave 7 — Custom Objects (Salesforce parity)
  await server.register(customObjectRoutes, { prefix: '/api/v1' });

  // Wave 7 — Twilio SMS
  // WHY /api/v1/integrations for webhook: unauthenticated, Twilio calls it; consistent with
  // microsoft-webhook pattern. WHY /api/v1 for sms routes: user-facing, needs auth middleware.
  await server.register(twilioWebhookRoutes, { prefix: '/api/v1/integrations' });
  await server.register(smsRoutes, { prefix: '/api/v1' });

  // Wave 7 — Real-time collaboration REST endpoints (lock + presence snapshot)
  // WHY /api/v1: consistent with other authenticated endpoints.
  // The WebSocket endpoint /api/realtime is registered by the realtimePlugin above.
  await server.register(realtimeRoutes, { prefix: '/api/v1' });

  // Wave 8 — Voice + Video calls
  // Authenticated call management routes
  await server.register(callsRoutes, { prefix: '/api/v1' });
  // Unauthenticated webhook routes (signature-validated per provider)
  await server.register(zoomCallWebhookRoutes, { prefix: '/api/v1/integrations' });
  await server.register(teamsCallWebhookRoutes, { prefix: '/api/v1/integrations' });
  await server.register(twilioVoiceWebhookRoutes, { prefix: '/api/v1/integrations' });

  // Wave 8 — Customer Success (authenticated + NPS public respond endpoint)
  await server.register(csRoutes, { prefix: '/api/v1' });

  // Wave 9 — Public NPS response page (server-rendered HTML, no auth)
  // Mounted at /api/v1/public/nps/:token. The /api → /api/v1 rewrite hook
  // means email links can use the shorter /api/public/nps/:token form.
  await server.register(publicNpsRoutes, { prefix: '/api/v1' });

  // Wave 9 — RFP pipeline: upload, SSE progress stream, matrix autofill, approval gate
  await server.register(rfpPipelineRoutes, { prefix: '/api/v1' });
  await server.register(competitorRoutes, { prefix: '/api/v1' });

  // Wave 10 — Operational monitoring: live queue depths, embedding failure rate, alert conditions
  await server.register(monitoringRoutes, { prefix: '/api/v1' });
  await server.register(opsSentrySmokeRoutes, { prefix: '/api/v1' });

  // Data migration: CSV import, cancel/undo destructive operations
  await server.register(migrationRoutes, { prefix: '/api/v1' });
  // Data migration: HubSpot OAuth + import
  await server.register(hubspotMigrationRoutes, { prefix: '/api/v1' });

  // GDPR Art. 20 — tenant data-portability export (admin-gated, org-scoped)
  await server.register(tenantExportRoutes, { prefix: '/api/v1' });

  // GDPR Art. 17 — per-data-subject erasure / anonymization (admin-gated, org-scoped)
  await server.register(erasureRoutes, { prefix: '/api/v1' });

  // Public demo door — POST /api/v1/demo/session + GET /api/v1/demo/status.
  // Self-gates on DEMO_MODE; registering it unconditionally is safe.
  await server.register(demoRoutes, { prefix: '/api/v1' });
}
