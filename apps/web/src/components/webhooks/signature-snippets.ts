export const SIGNATURE_SNIPPETS = {
  'Node.js': `const crypto = require('crypto');

// During a secret rotation the header carries one v1 per active secret.
function verifySignature(rawBody, header, secret) {
  const pairs = header.split(',').map((p) => p.split('=', 2));
  const t = pairs.find(([k]) => k === 't')?.[1];
  const sigs = pairs.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || sigs.length === 0) return false;

  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(\`\${t}.\${rawBody}\`)
    .digest('hex');

  return sigs.some(
    (v1) =>
      v1.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex')),
  );
}`,
  Python: `import hmac, hashlib, time

# During a secret rotation the header carries one v1 per active secret.
def verify_signature(raw_body: bytes, header: str, secret: str) -> bool:
    pairs = [item.split("=", 1) for item in header.split(",")]
    t = next((v for k, v in pairs if k == "t"), None)
    sigs = [v for k, v in pairs if k == "v1"]
    if not t or not sigs:
        return False

    if abs(time.time() - int(t)) > 300:
        return False

    expected = hmac.new(
        secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()

    return any(hmac.compare_digest(expected, v1) for v1 in sigs)`,
  Ruby: `require 'openssl'

# During a secret rotation the header carries one v1 per active secret.
def verify_signature(raw_body, header, secret)
  pairs = header.split(',').map { |p| p.split('=', 2) }
  t = pairs.find { |k, _| k == 't' }&.last
  sigs = pairs.select { |k, _| k == 'v1' }.map(&:last)
  return false unless t && sigs.any?

  return false if (Time.now.to_i - t.to_i).abs > 300

  expected = OpenSSL::HMAC.hexdigest('sha256', secret, "#{t}.#{raw_body}")
  sigs.any? { |v1| ActiveSupport::SecurityUtils.secure_compare(expected, v1) }
end`,
};

export type SignatureLang = keyof typeof SIGNATURE_SNIPPETS;
