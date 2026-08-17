---
title: An IP-filtered Cloudflare API token works locally but 401s from the cloud host
date: 2026-08-14
project: BidStack 360° (D:\BIDCRM)
tags: [lessons, ai, cloudflare, deploy, auth]
---

## Lesson — A credential that works from your machine is not proven for the deploy host

**Rule (CHECK):** When a hosted service calls a third-party API with a token, verify the
token from the DEPLOY host's network, not just your laptop. A 200 locally proves nothing
about the container. For Railway, `railway ssh <alias> "node -e '...fetch...'"` runs the
check from the real egress IP.

**What happened:** Polo's AI copilot kept returning the deterministic stub in production.
The API logged `openai completion failed: HTTP 401` (provider=openai,
model=@cf/meta/llama-3.3-70b-instruct-fp8-fast). Every app-side cause was ruled out:
- `resolveActiveLlm` → env branch (no stored org agent-provider row anywhere).
- Container env byte-identical to the working value: `OPENAI_API_KEY` len 53,
  `cfat_Ze7…44c0f6`, no whitespace; `OPENAI_BASE_URL` and `OPENAI_MODEL` correct.
- Request shape correct — the exact `completeChat` request returns **200** from my IP.
- Fresh deployment (forced with a nonce var) so the container snapshotted the clean key.

The container still got **HTTP 401, body `{"errors":[{"code":10000,"message":"Authentication error"}]}`**
from Cloudflare, while the SAME token + endpoint + body returned **200 from my IP at the
same moment**. Byte-identical token, opposite result — the only variable is source IP.

**Root cause:** The Cloudflare API token authenticates only from the user's network — a
Client IP Address Filter on the token (or CF blocking Railway's datacenter egress). It is a
Cloudflare-side restriction on the credential, not an app/key/code defect. Cannot be fixed
from the app: the token must be reconfigured (remove IP filtering) or replaced with an
unfiltered "Workers AI (Read)" token — a Cloudflare-dashboard action only the account owner
can do. Reading the token config to confirm the filter needs user-level token-read
(`9109 Valid user-level authentication not found`), which the token itself lacks.

**How to apply:**
1. Before blaming key value/whitespace/redeploy snapshots, run the call FROM the container.
   If it 401s there but 200s locally with a byte-identical key → source-IP restriction.
2. `railway redeploy` restores a deployment's OWN env snapshot; it does NOT pick up a var
   changed with `--skip-deploys`. Force a fresh snapshot with a real var change (a nonce)
   or a new build.
3. Graceful degradation already covers this: `completeChatOrNull` returns null on any non-2xx
   and callers fall back to a deterministic stub (HTTP 200, no user-facing error). Swapping
   in a working token needs only `railway variables --service api --set OPENAI_API_KEY=...`
   followed by a fresh deploy — no code change.
