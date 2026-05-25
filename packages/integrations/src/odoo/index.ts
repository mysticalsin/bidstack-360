import { OdooMcpClient } from '@bidstack/odoo-mcp-client';

import type {
  IntegrationConfig,
  IntegrationPlugin,
  IntegrationTool,
  SyncOptions,
  SyncResult,
  } from '../types/plugin.js';

export class OdooPlugin implements IntegrationPlugin {
  readonly provider = 'odoo' as const;
  readonly displayName = 'Odoo ERP';
  readonly description = 'Sync with Odoo CRM, Sales, and Projects modules.';
  readonly icon = 'package';

  private getClient(_config: IntegrationConfig): OdooMcpClient | null {
    const url = process.env.ODOO_MCP_URL;
    if (!url) return null;
    // Per-org credentials will be read from config.credentials in v2.
    return new OdooMcpClient({
      url,
      bearerToken: process.env.ODOO_MCP_BEARER_TOKEN,
      timeoutMs: Number(process.env.ODOO_MCP_TIMEOUT_MS ?? 15_000),
    });
  }

  async getAuthUrl(): Promise<string> {
    // Odoo uses a sidecar MCP server; OAuth is not applicable in this model.
    // Future: per-org Odoo instances will use OAuth.
    return '';
  }

  async connect(config: IntegrationConfig): Promise<IntegrationConfig> {
    const client = this.getClient(config);
    if (!client) {
      throw new Error('Odoo MCP client not configured (ODOO_MCP_URL missing)');
    }
    // Validate by calling a lightweight tool.
    await client.callTool('odoo_status_probe', {});
    return { ...config, status: 'connected', connectedAt: new Date() };
  }

  async validate(config: IntegrationConfig): Promise<{ valid: boolean; message?: string }> {
    const client = this.getClient(config);
    if (!client) return { valid: false, message: 'ODOO_MCP_URL not set' };
    try {
      await client.callTool('odoo_status_probe', {});
      return { valid: true };
    } catch (err) {
      return { valid: false, message: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  async disconnect(): Promise<void> {
    // Nothing to revoke with sidecar model.
  }

  async sync(config: IntegrationConfig, options?: SyncOptions): Promise<SyncResult> {
    const client = this.getClient(config);
    if (!client) throw new Error('Odoo MCP client not configured');

    const entityTypes = options?.entityTypes ?? ['res.partner', 'crm.lead', 'sale.order'];
    let created = 0;
    const updated = 0;
    const errors: SyncResult['errors'] = [];

    for (const model of entityTypes) {
      try {
        const result = await client.callTool('odoo_search_read', {
          model,
          domain: options?.since ? [['write_date', '>=', options.since.toISOString()]] : [],
          fields: ['id', 'name'],
          limit: 500,
        });
        const records = Array.isArray(result) ? result : [];
        created += records.length; // Simplified — real logic would upsert.
      } catch (err) {
        errors.push({
          entityType: model,
          externalId: '',
          message: err instanceof Error ? err.message : 'Sync failed',
        });
      }
    }

    return { created, updated, deleted: 0, errors };
  }

  getTools(): IntegrationTool[] {
    return [
      {
        name: 'odoo_search_read',
        description: 'Search and read records from Odoo.',
        parameters: {
          model: { type: 'string', description: 'Odoo model name', required: true },
          domain: { type: 'array', description: 'Odoo domain filter' },
          fields: { type: 'array', description: 'Fields to retrieve' },
          limit: { type: 'number', description: 'Max records' },
        },
        execute: async (args, context) => {
          const client = this.getClient(context.config);
          if (!client) throw new Error('Odoo not configured');
          return client.callTool('odoo_search_read', args);
        },
      },
      {
        name: 'odoo_partner_autocomplete',
        description: 'Autocomplete company data from Odoo partner database.',
        parameters: {
          name: { type: 'string', description: 'Company name', required: true },
          limit: { type: 'number', description: 'Max suggestions' },
        },
        execute: async (args, context) => {
          const client = this.getClient(context.config);
          if (!client) throw new Error('Odoo not configured');
          return client.callTool('odoo_partner_autocomplete', args);
        },
      },
    ];
  }
}
