/**
 * MCP answers a failed tool call with HTTP 200 and `result.isError: true`
 * (or a JSON-RPC `error`), so the load suite must read the body to count it.
 * The streamable HTTP transport replies with plain JSON or with SSE frames.
 */

function messages(body) {
  const text = String(body ?? '').trim();
  if (!text) return [];
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      out.push(JSON.parse(line.slice(5).trim()));
    } catch {
      // A frame that is not JSON is not a successful result.
    }
  }
  return out;
}

/** True when an HTTP-successful MCP response did not execute the tool. */
export function mcpCallFailed(body) {
  const list = messages(body);
  if (list.length === 0) return true;
  return list.some((m) => !m || typeof m !== 'object' || m.error || m.result?.isError === true);
}
