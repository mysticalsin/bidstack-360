/**
 * erp.kit.service.ts — buildPresalesKit.
 *
 * Extracted from erp.service.ts (BS-R1 file-size refactor).
 * Builds the ERP presales capability manifest sent to the route layer.
 */
import type { z } from 'zod';

import type { ErpBidModule, ErpPresalesKit } from './erp.helpers.js';

export function buildPresalesKit({
  configured,
  reachable,
  tools,
  lastError,
}: {
  configured: boolean;
  reachable: boolean;
  tools: string[];
  lastError: string | null;
}): z.infer<typeof ErpPresalesKit> {
  const toolSet = new Set(tools);
  const module = (
    id: string,
    label: string,
    erpModels: string[],
    bidstackSurface: string,
    value: string,
    requiredTools: string[],
  ): z.infer<typeof ErpBidModule> => ({
    id,
    label,
    erpModels,
    bidstackSurface,
    value,
    status: requiredTools.every((tool) => toolSet.has(tool))
      ? 'sidecar'
      : configured && !reachable
        ? 'planned'
        : 'ready',
    availableTools: requiredTools.filter((tool) => toolSet.has(tool)),
  });

  return {
    generatedAt: new Date().toISOString(),
    configured,
    reachable,
    modules: [
      module(
        'partner-autocomplete',
        'Partner autocomplete',
        ['res.partner', 'res.partner.industry', 'res.country'],
        'Company lookup and data enhancement',
        'Search by legal name, domain, VAT, DUNS, and company registry identifiers.',
        ['search_records', 'get_record'],
      ),
      module(
        'crm-opportunities',
        'CRM opportunities',
        ['crm.lead', 'crm.stage', 'crm.team'],
        'Bid pipeline and opportunity cockpit',
        'Keep lead, opportunity, stage, probability, and team discipline aligned.',
        ['search_records', 'aggregate_records', 'update_record'],
      ),
      module(
        'quotations',
        'Quotations and orders',
        ['sale.order', 'sale.order.line', 'product.template'],
        'Proposal value and commercial shaping',
        'Bring quote, product, pricing, and margin context into bid/no-bid reviews.',
        ['search_records', 'get_record'],
      ),
      module(
        'activities',
        'Activities and chatter',
        ['mail.activity', 'mail.message', 'calendar.event'],
        'Presales next actions and audit trail',
        'Mirror ERP activity discipline for calls, meetings, reminders, and notes.',
        ['search_records', 'post_message'],
      ),
      module(
        'documents',
        'Documents and evidence',
        ['documents.document', 'ir.attachment'],
        'Proposal tracker, RFP files, compliance evidence',
        'Centralize bid packs, SoWs, NDAs, diagrams, and submission evidence.',
        ['search_records', 'get_record'],
      ),
      module(
        'delivery-handoff',
        'Projects and delivery handoff',
        ['project.project', 'project.task', 'helpdesk.ticket'],
        'Won-bid transition and implementation risk',
        'Use presales commitments to seed delivery plans and renewal risk tracking.',
        ['search_records', 'create_record'],
      ),
    ],
    partnerAutocomplete: {
      inputs: ['legal name', 'domain', 'VAT', 'DUNS', 'GST', 'registry id'],
      fallback:
        'ERP MCP when configured; otherwise Polo PreSales verified data, external CRM customers, and verified data adapters.',
      validates: [
        'country/state normalization',
        'industry mapping',
        'VAT-style identifiers',
        'source confidence',
      ],
    },
    fieldMap: [
      { erp: 'res.partner.name', bidstack: 'CrmCompany.name', mode: 'enrich' },
      {
        erp: 'res.partner.commercial_company_name',
        bidstack: 'CrmCompany.legalName',
        mode: 'enrich',
      },
      { erp: 'res.partner.website', bidstack: 'CrmCompany.website/domain', mode: 'enrich' },
      {
        erp: 'res.partner.vat/company_registry',
        bidstack: 'CrmCompany.registryIds',
        mode: 'enrich',
      },
      {
        erp: 'crm.lead.stage_id/probability',
        bidstack: 'CrmDeal.stage/probability',
        mode: 'write',
      },
      { erp: 'sale.order.amount_total', bidstack: 'CrmDeal.amountMicros', mode: 'read' },
      { erp: 'mail.activity', bidstack: 'CrmActivity/Task', mode: 'write' },
      {
        erp: 'documents.document/ir.attachment',
        bidstack: 'FileAttachment/Document',
        mode: 'read',
      },
    ],
    nextActions: configured
      ? reachable
        ? [
            'Map res.partner rows into Polo PreSales verified data cache.',
            'Sync ERP crm.lead stage changes into bid opportunity audit logs.',
            'Attach sale.order commercial context to proposal readiness scoring.',
          ]
        : ['Fix ERP_MCP_URL or sidecar credentials; local Polo PreSales fallback remains active.']
      : [
          'Set ERP_MCP_URL when the ERP sidecar is ready.',
          'Keep using Polo PreSales verified data and verified data connectors until then.',
        ],
    lastError,
  };
}
