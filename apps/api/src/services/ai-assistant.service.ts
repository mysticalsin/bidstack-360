/**
 * ai-assistant.service.ts — re-export barrel (BS-R1 file-size refactor).
 *
 * The five AI pipeline functions now live in focused sub-files:
 *   ai-assistant.email.service.ts    — draftEmail
 *   ai-assistant.deals.service.ts    — analyzeDealSentiment, summarizeAccountIntel
 *   ai-assistant.contacts.service.ts — prepMeeting, enrichContact
 *
 * This file is preserved as the public API surface so the route layer
 * (`routes/ai-assistant.ts`) needs no changes.
 *
 * Import DAG: helpers (leaf) ← context ← sub-services ← this barrel.
 */

export { draftEmail } from './ai-assistant.email.service.js';
export { analyzeDealSentiment, summarizeAccountIntel } from './ai-assistant.deals.service.js';
export { enrichContact, prepMeeting } from './ai-assistant.contacts.service.js';
