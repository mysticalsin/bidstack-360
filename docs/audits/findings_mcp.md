# MCP Integration Audit Findings

**Date**: 2026-05-25
**Scope**: `@modelcontextprotocol/sdk` usage, tool definitions, error handling, rate limiting, and bearer auth in `apps/mcp-server`.

## Executive Summary
The MCP integration has been successfully overhauled and now fully complies with standard architecture. The custom JSON-RPC dispatcher has been removed in favor of the official `@modelcontextprotocol/sdk`. Transport, error handling, rate limiting, and authentication mechanisms are all robust and strictly adhere to standard design patterns.

**Audit Score: 10/10** (Domain: MCP Integration)

## Detailed Findings

### 1. `@modelcontextprotocol/sdk` Usage (Score: Pass)
- **Implementation**: The server correctly utilizes `@modelcontextprotocol/sdk` (^1.29.0). `src/rpc.ts` was deleted, and the server now uses `McpServer` to register tools.
- **Transports**: It successfully implements standard `StreamableHTTPServerTransport` on `/mcp` and maintains `SSEServerTransport` on `/mcp/sse` and `/mcp/messages` for backward compatibility.
- **Manifest**: `/.well-known/mcp` correctly advertises the endpoints and protocols.

### 2. Tool Definitions & Error Handling (Score: Pass)
- **Definitions**: Tools in `src/tools/index.ts` map perfectly to the Zod shapes required by the `McpServer`. Legacy dotted names and canonical snake-case names are correctly maintained.
- **Error Handling**: When a tool handler throws an error (e.g., "Opportunity not found" in `opportunityUpdate`), `src/server.ts` correctly catches the exception and returns it within the `content` block along with `isError: true` (`{ content: [{ type: 'text', text: message }], isError: true }`). This strictly follows the MCP specification, ensuring the LLM gracefully receives and recovers from application-level failures.

### 3. Rate Limiting (Score: Pass)
- **Global Limits**: Fastify enforces a 60/minute rate limit.
- **Redis Scaling**: The rate limiter is now backed by Redis (`ioredis` connected to a specific namespace `bidstack:mcp:perminute:`). This correctly solves previous replica-scaling bugs where rate limits were strictly local to each pod.
- **Hourly Overrides**: The custom `hourly-rate-limit.ts` plugin is successfully registered and active.

### 4. Bearer Auth & Scopes (Score: Pass)
- **Token Handling**: Standard Fastify Bearer auth in `src/auth.ts` properly hashes the token with `sha256` before verifying it against `prisma.apiKey`.
- **Scope Verification**: `requireMcpScope` strictly enforces `read` or `write` scopes depending on the specific tool's requirement defined in `toolScopes` within `src/tools/index.ts`.
- **Audit Logging**: Successful authentications fire a 1% sampled `apikey.used` audit-log row, preventing DB bloat while maintaining a traceable trail for security incidents.

## Conclusion
No deviations from standard MCP design patterns were found. All critical violations identified in the previous audit have been comprehensively resolved.
