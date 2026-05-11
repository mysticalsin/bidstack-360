# MCP tools exposed to Dust

The MCP server registers these tools so Dust agents can read + write BidStack data on behalf of the user.

## `opportunities.list`
List opportunities matching filters.

**Input:**
```json
{
  "stage":    "proposal",
  "owner":    "jane.smith@mantu.com",
  "industry": "financial_services",
  "search":   "Acme",
  "limit":    50
}
```
**Output:** array of `Opportunity` (see `openapi.yaml`).

## `opportunities.get`
Fetch one opportunity with full intel payload.

**Input:** `{ "id": "uuid" }` or `{ "code": "OP-2041" }`
**Output:** `OpportunityFull`

## `opportunity.update`
Patch an opportunity. Common use: agent updates `stage`, `probability`, or `intel.triggers`.

**Input:** `{ "id": "uuid", "patch": { "stage": "negotiation", "probability": 65 } }`
**Output:** updated `Opportunity`. Writes to `audit_log`.

## `contacts.list`
**Input:** `{ "customer": "CI Financial", "limit": 50 }`
**Output:** array of `Contact`.

## `tasks.create`
**Input:**
```json
{ "oppId": "uuid", "title": "Send revised SoW", "dueDate": "2025-04-12", "assignee": "jane.smith@mantu.com" }
```
**Output:** created `Task`.

## `proposal.draft`
Drafts a proposal section using the customer's intel + Mantu's reference library.

**Input:**
```json
{ "oppId": "uuid", "section": "executive_summary" | "scope" | "pricing" | "timeline" | "risks", "tone": "consultative" }
```
**Output:** `{ "markdown": "...", "citations": [{ "docId": "...", "title": "..." }] }`

---

## Authorization

Every tool call requires `Authorization: Bearer ${BIDSTACK_MCP_KEY}` minted in **Settings → Integrations → API keys** with scope `mcp`. The key is scoped to a single org; the MCP server uses it to populate `org_id` on every query.

## Rate limits

Per-key: 60 req/min, 600 req/hour. Returns 429 with `Retry-After` on overflow.
