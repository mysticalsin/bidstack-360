import { describe, expect, it } from 'vitest';

import {
  IntegrationRegistry,
  MicrosoftPlugin,
  OdooPlugin,
  SalesforcePlugin,
  integrationRegistry,
  type IntegrationPlugin,
} from '../index.js';

const plugins: IntegrationPlugin[] = [new OdooPlugin(), new SalesforcePlugin(), new MicrosoftPlugin()];

describe('integration registry contract', () => {
  it('registers exactly the built-in providers', () => {
    expect(
      integrationRegistry
        .list()
        .map((p) => p.provider)
        .sort(),
    ).toEqual(['microsoft', 'odoo', 'salesforce']);
  });

  it('get() returns the registered plugin and undefined for unknown providers', () => {
    expect(integrationRegistry.get('salesforce')).toBeInstanceOf(SalesforcePlugin);
    expect(integrationRegistry.get('hubspot')).toBeUndefined();
  });

  it('a later registration for the same provider replaces the earlier one', () => {
    const reg = new IntegrationRegistry();
    const a = new SalesforcePlugin();
    const b = new SalesforcePlugin();
    reg.register(a);
    reg.register(b);
    expect(reg.list()).toHaveLength(1);
    expect(reg.get('salesforce')).toBe(b);
  });

  for (const plugin of plugins) {
    describe(`${plugin.provider} plugin shape`, () => {
      it('exposes identity fields', () => {
        expect(plugin.displayName.length).toBeGreaterThan(0);
        expect(plugin.description.length).toBeGreaterThan(0);
      });

      it('exposes uniquely named, provider-prefixed tools with described parameters', () => {
        const tools = plugin.getTools();
        expect(tools.length).toBeGreaterThan(0);
        const names = tools.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
        for (const tool of tools) {
          expect(tool.name.startsWith(`${plugin.provider}_`)).toBe(true);
          expect(tool.description.length).toBeGreaterThan(0);
          expect(typeof tool.execute).toBe('function');
          for (const [, spec] of Object.entries(tool.parameters)) {
            expect(typeof spec.type).toBe('string');
            expect(spec.description.length).toBeGreaterThan(0);
          }
        }
      });
    });
  }
});
