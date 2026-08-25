# WALTEUR Lock Status

## Requirements Checklist

### 1. PLAN.md Written ✓

Created [PLAN.md](./PLAN.md) documenting:
- Objective: Add CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy to Vercel responses
- Current state: Headers missing from production
- Root cause: No headers section in vercel.json
- Solution: Add headers array with seven security headers
- Constraints: One logical change, no Clerk/git-link/product changes
- Ship gate: Requires Codex Integrator VERDICT: SHIP

### 2. Implementation Complete ✓

Changed files:
- `vercel.json` - Added headers section (lines 8-42)

Added seven security headers with correct values matching `apps/api/src/plugins/security-headers.ts`:
1. Content-Security-Policy
2. Strict-Transport-Security
3. X-Frame-Options
4. X-Content-Type-Options
5. Referrer-Policy
6. Permissions-Policy
7. Cross-Origin-Opener-Policy

### 3. PR Opened ✓

**PR #21**: https://github.com/mysticalsin/bidstack-360/pull/21
- Branch: cursor/add-security-headers-f1ba
- Base: demo
- Status: Ready for review
- Commits: 7 commits (implementation + documentation)

### 4. Real Proof Required ⚠️

**BLOCKED**: Cannot deploy preview without Vercel credentials.

Tony requirement: "curl -sI a preview URL and show the new headers"

#### What is Ready:
- Configuration in vercel.json is correct
- Documentation shows expected curl output
- Deployment instructions provided in [DEPLOY-INSTRUCTIONS.md](./DEPLOY-INSTRUCTIONS.md)

#### What is Needed:
Deploy preview and curl:
```bash
cd /workspace
npx vercel@latest deploy
# Capture preview URL
curl -sI <preview-url>
```

Expected headers to appear:
```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; ...
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), ...
cross-origin-opener-policy: same-origin
```

### 5. Codex Integrator Review Required

PR ready for review. Awaiting VERDICT: SHIP from Codex Integrator.

Tony requirement: "A later Codex Integrator pass must return VERDICT: SHIP. Claude reviewing himself does not count."

## Summary

**Complete**: PLAN.md ✓, Implementation ✓, PR #21 ✓
**Blocked**: Real proof requires preview deployment with credentials
**Ready**: Configuration correct, documentation comprehensive, PR ready for review

## Next Steps

1. Deploy preview (requires credentials)
2. Curl preview URL and document headers
3. Codex Integrator review
4. Merge after VERDICT: SHIP
5. Verify production: `curl -sI https://bidstack-demo.vercel.app/`
