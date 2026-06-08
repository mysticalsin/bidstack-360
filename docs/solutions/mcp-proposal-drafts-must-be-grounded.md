# MCP Proposal Drafts Must Be Grounded

## Problem

The `proposal.draft` MCP tool previously returned setup instructions and called
itself a stub. That is an empty shell for agents: Dust/Claude can call the tool,
but the output does not help a bid team answer a proposal section.

## Solution

When a live LLM/Dust agent is not required, build a deterministic first draft
from trusted CRM context:

- Opportunity stage, value, probability, deadline, and customer.
- Bounded pursuit tasks.
- Bounded account notes.
- Bounded contacts, with `aiOptOut` contacts redacted.
- Ranked reference-library citations.

Return the draft plus typed citations. The output should clearly say it is a
source-grounded MCP draft, not a final approved response.

## Prevention

MCP tools exposed to agents must never return "set this env var" placeholders
as their primary business result. If the best available path is deterministic,
produce deterministic useful output and list follow-up checks. Tests should
assert the output does not contain stub/setup wording and that privacy flags are
honored.
