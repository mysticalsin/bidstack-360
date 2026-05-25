/**
 * Integration Plugin Architecture
 *
 * Every external system (Salesforce, Microsoft, Odoo, HubSpot, etc.)
 * implements this interface. The core app discovers plugins at runtime
 * and exposes them via MCP tools + a unified config UI.
 */

export type IntegrationProvider =
  | 'odoo'
  | 'salesforce'
  | 'microsoft'
  | 'hubspot'
  | 'zendesk'
  | 'slack'
  | string;

export type IntegrationStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'refreshing';

export interface IntegrationConfig {
  id: string;
  orgId: string;
  provider: IntegrationProvider;
  displayName: string;
  credentials: Record<string, unknown>;
  settings: Record<string, unknown>;
  status: IntegrationStatus;
  statusMessage?: string;
  connectedAt?: Date;
  lastSyncAt?: Date;
  lastErrorAt?: Date;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A single tool exposed by an integration plugin. */
export interface IntegrationTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  orgId: string;
  userId: string;
  config: IntegrationConfig;
}

/** Every integration must implement this interface. */
export interface IntegrationPlugin {
  readonly provider: IntegrationProvider;
  readonly displayName: string;
  readonly description: string;
  readonly icon?: string;

  /** OAuth / credential initiation URL. */
  getAuthUrl(orgId: string, redirectUri: string): Promise<string>;

  /** Exchange OAuth code for tokens and store in config. */
  connect(config: IntegrationConfig, code: string): Promise<IntegrationConfig>;

  /** Validate stored credentials are still valid. */
  validate(config: IntegrationConfig): Promise<{ valid: boolean; message?: string }>;

  /** Refresh access tokens if expired. */
  refresh?(config: IntegrationConfig): Promise<IntegrationConfig>;

  /** Revoke tokens and clear credentials. */
  disconnect(config: IntegrationConfig): Promise<void>;

  /** Pull data from the external system into BidStack. */
  sync?(config: IntegrationConfig, options?: SyncOptions): Promise<SyncResult>;

  /** Push a BidStack record to the external system. */
  push?(
    config: IntegrationConfig,
    entityType: string,
    entityId: string,
    data: Record<string, unknown>,
  ): Promise<unknown>;

  /** MCP tools exposed by this integration. */
  getTools(): IntegrationTool[];
}

export interface SyncOptions {
  entityTypes?: string[];
  since?: Date;
  full?: boolean;
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  errors: Array<{ entityType: string; externalId: string; message: string }>;
}

/** Registry of all installed plugins. */
export class IntegrationRegistry {
  private plugins = new Map<IntegrationProvider, IntegrationPlugin>();

  register(plugin: IntegrationPlugin): void {
    this.plugins.set(plugin.provider, plugin);
  }

  get(provider: IntegrationProvider): IntegrationPlugin | undefined {
    return this.plugins.get(provider);
  }

  list(): IntegrationPlugin[] {
    return Array.from(this.plugins.values());
  }
}
