// The TRUSTED_PROXIES parser lives in @bidstack/shared/server so the api and
// the mcp-server read the same env var the same way. Re-exported here so the
// existing api imports keep working.
export {
  hopCountTrust,
  isInternalPeer,
  parseTrustProxy,
  type TrustProxyValue,
} from '@bidstack/shared/server';
