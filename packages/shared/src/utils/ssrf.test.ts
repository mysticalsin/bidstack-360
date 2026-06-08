import { describe, expect, it } from 'vitest';

import { isPublicHostname } from './webhook-url.js';
import { assertPublicHttpUrl } from './ssrf.js';

describe('isPublicHostname', () => {
  it('allows ordinary public hosts (incl. domains starting with fc/fd)', () => {
    for (const h of ['example.com', '8.8.8.8', 'api.usaspending.gov', 'fc-cdn.example.com']) {
      expect(isPublicHostname(h)).toBe(true);
    }
  });

  it('blocks loopback, RFC1918, and link-local IPv4', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254']) {
      expect(isPublicHostname(h)).toBe(false);
    }
  });

  it('blocks the WHOLE 127.0.0.0/8 and 0.0.0.0/8 ranges, not just .0.0.1 (regression)', () => {
    for (const h of ['127.0.0.2', '127.1.2.3', '127.255.255.255', '0.0.0.0', '0.0.0.1']) {
      expect(isPublicHostname(h)).toBe(false);
    }
  });

  it('blocks hex-mapped IPv4 loopback in IPv6 (::ffff:7f00:1 = 127.0.0.1)', () => {
    expect(isPublicHostname('[::ffff:7f00:1]')).toBe(false);
    expect(isPublicHostname('::ffff:7f00:1')).toBe(false);
    expect(isPublicHostname('::ffff:0a00:1')).toBe(false); // 10.0.0.1
    expect(isPublicHostname('::')).toBe(false); // unspecified
  });

  it('blocks CGNAT 100.64.0.0/10 but allows 100.63/100.128', () => {
    expect(isPublicHostname('100.64.0.1')).toBe(false);
    expect(isPublicHostname('100.127.255.255')).toBe(false);
    expect(isPublicHostname('100.63.0.1')).toBe(true);
    expect(isPublicHostname('100.128.0.1')).toBe(true);
  });

  it('blocks IPv6 ULA, link-local, and IPv4-mapped private (bracketed + bare)', () => {
    for (const h of ['[fd00::1]', 'fd00::1', '[fc00::1]', '[fe80::1]', '[::ffff:10.0.0.1]', '[::1]']) {
      expect(isPublicHostname(h)).toBe(false);
    }
  });
});

describe('assertPublicHttpUrl', () => {
  it('returns the URL for public http(s)', () => {
    expect(assertPublicHttpUrl('https://example.com/p').hostname).toBe('example.com');
    expect(assertPublicHttpUrl('http://example.com/p').protocol).toBe('http:');
  });

  it('throws on internal hosts and non-http(s) protocols', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1/')).toThrow();
    expect(() => assertPublicHttpUrl('http://169.254.169.254/latest')).toThrow();
    expect(() => assertPublicHttpUrl('ftp://example.com/f')).toThrow();
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow();
    expect(() => assertPublicHttpUrl('not a url')).toThrow();
  });
});
