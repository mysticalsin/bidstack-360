import { describe, expect, it, vi } from 'vitest';

import {
  fetchCompanyTechStackMcp,
  fetchCompanyTechStackMcps,
  techStackMcpSourceConfigsFromEnv,
} from './company-tech-stack-mcp.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

describe('fetchCompanyTechStackMcp', () => {
  it('calls a configured MCP tool and maps technologies with attribution', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } },
          { headers: { 'Mcp-Session-Id': 'session-1' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: {
            structuredContent: {
              technologies: [{ name: 'Salesforce' }, { vendor: 'Snowflake' }, 'Okta'],
            },
          },
        }),
      );

    const profile = await fetchCompanyTechStackMcp({
      name: 'Acme',
      domain: 'acme.com',
      mcpUrl: 'https://tech-intel.example/mcp',
      mcpBearerToken: 'token',
      mcpTool: 'search_stack',
      mcpLabel: 'BuiltWith MCP',
      now: new Date('2026-06-17T12:00:00.000Z'),
      fetchImpl,
    });

    expect(profile?.technologies).toEqual(['Salesforce', 'Snowflake', 'Okta']);
    expect(profile?.sourceAttribution[0]).toMatchObject({
      source: 'tech_stack_mcp',
      label: 'BuiltWith MCP',
      sourceUrl: 'https://acme.com/',
      fetchedAt: '2026-06-17T12:00:00.000Z',
      confidence: 0.86,
    });
    expect(profile?.providerMetadata.techStackMcp).toMatchObject({
      technologies: ['Salesforce', 'Snowflake', 'Okta'],
      provider: 'BuiltWith MCP',
      transport: 'mcp_streamable_http',
      sourceTool: 'search_stack',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer token',
      'Mcp-Session-Id': 'session-1',
    });
  });

  it('returns null when the MCP source has no technology signal', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: { structuredContent: { company: { name: 'Acme' } } },
        }),
      );

    const profile = await fetchCompanyTechStackMcp({
      name: 'Acme',
      mcpUrl: 'https://tech-intel.example/mcp',
      fetchImpl,
    });

    expect(profile).toBeNull();
  });

  it('maps object-map and application-shaped MCP technology payloads', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: {
            structuredContent: {
              technologies: {
                React: { categories: ['JavaScript frameworks'] },
                Cloudflare: true,
              },
              applications: [{ name: 'HubSpot' }],
              detectedTechnologies: { Datadog: { confidence: 0.91 } },
            },
          },
        }),
      );

    const profile = await fetchCompanyTechStackMcp({
      name: 'Acme',
      mcpUrl: 'https://tech-intel.example/mcp',
      mcpLabel: 'Wappalyzer MCP',
      fetchImpl,
    });

    expect(profile?.technologies).toEqual(['React', 'Cloudflare', 'Datadog', 'HubSpot']);
    expect(profile?.providerMetadata.techStackMcp).toMatchObject({
      provider: 'Wappalyzer MCP',
      technologies: ['React', 'Cloudflare', 'Datadog', 'HubSpot'],
    });
  });

  it('merges multiple configured Tech Intel MCP sources without losing provider labels', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method?: string };
      if (body.method === 'initialize') {
        return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (url.includes('builtwith')) {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { structuredContent: { technologies: ['Cloudflare', 'Segment'] } },
        });
      }
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: { structuredContent: { technologies: ['Segment', 'Datadog'] } },
      });
    });

    const profile = await fetchCompanyTechStackMcps({
      name: 'Acme',
      domain: 'acme.com',
      now: new Date('2026-06-17T12:00:00.000Z'),
      configs: [
        {
          id: 'builtwith',
          label: 'BuiltWith MCP',
          url: 'https://builtwith.example/mcp',
          tool: 'detect_company_technologies',
          timeoutMs: 12_000,
        },
        {
          id: 'wappalyzer',
          label: 'Wappalyzer MCP',
          url: 'https://wappalyzer.example/mcp',
          tool: 'detect_company_technologies',
          timeoutMs: 12_000,
        },
      ],
      fetchImpl,
    });

    expect(profile?.technologies).toEqual(['Cloudflare', 'Segment', 'Datadog']);
    expect(profile?.sourceAttribution.map((source) => source.label)).toEqual([
      'BuiltWith MCP',
      'Wappalyzer MCP',
    ]);
    expect(profile?.providerMetadata.techStackMcp).toMatchObject({
      provider: '2 Tech Intel MCPs',
      technologies: ['Cloudflare', 'Segment', 'Datadog'],
      sourceTool: 'multiple',
    });
    expect(profile?.providerMetadata.techStackMcps).toEqual([
      {
        technologies: ['Cloudflare', 'Segment'],
        provider: 'BuiltWith MCP',
        transport: 'mcp_streamable_http',
        sourceTool: 'detect_company_technologies',
      },
      {
        technologies: ['Segment', 'Datadog'],
        provider: 'Wappalyzer MCP',
        transport: 'mcp_streamable_http',
        sourceTool: 'detect_company_technologies',
      },
    ]);
  });

  it('reads legacy and named MCP source configs from environment variables', () => {
    const configs = techStackMcpSourceConfigsFromEnv({
      TECH_STACK_MCP_URL: 'https://legacy.example/mcp',
      TECH_STACK_MCP_LABEL: 'Legacy MCP',
      TECH_STACK_MCP_SOURCE_IDS: 'builtwith,wappalyzer',
      TECH_STACK_MCP_BUILTWITH_URL: 'https://builtwith.example/mcp',
      TECH_STACK_MCP_BUILTWITH_BEARER_TOKEN: 'builtwith-token',
      TECH_STACK_MCP_WAPPALYZER_URL: 'https://wappalyzer.example/mcp',
      TECH_STACK_MCP_WAPPALYZER_TOOL: 'stack_lookup',
      TECH_STACK_MCP_WAPPALYZER_TIMEOUT_MS: '9000',
    });

    expect(configs).toEqual([
      {
        id: 'default',
        label: 'Legacy MCP',
        url: 'https://legacy.example/mcp',
        bearerToken: undefined,
        tool: 'detect_company_technologies',
        timeoutMs: 12_000,
      },
      {
        id: 'builtwith',
        label: 'Builtwith MCP',
        url: 'https://builtwith.example/mcp',
        bearerToken: 'builtwith-token',
        tool: 'detect_company_technologies',
        timeoutMs: 12_000,
      },
      {
        id: 'wappalyzer',
        label: 'Wappalyzer MCP',
        url: 'https://wappalyzer.example/mcp',
        bearerToken: undefined,
        tool: 'stack_lookup',
        timeoutMs: 9000,
      },
    ]);
  });
});
