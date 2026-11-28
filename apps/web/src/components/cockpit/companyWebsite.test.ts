// The domain on the account is a label. It opens a site only when that site
// is http(s) and the host is the domain itself. A script, a login in the
// address, or a lookalike host must not become the link.
import { describe, expect, it } from 'vitest';

import { companyWebsiteHref, publicHttpUrl } from './companyWebsite';

describe('company website for the printed domain', () => {
  it('opens www.ci.com from the domain ci.com, including a path', () => {
    // WHY: demo accounts store the public site with a www host. The word
    // on the cockpit is the bare domain, and it has to reach that site.
    expect(companyWebsiteHref('ci.com', 'https://www.ci.com/')).toBe('https://www.ci.com/');
    expect(companyWebsiteHref('CI.com', 'https://WWW.CI.com/about')).toBe('https://www.ci.com/about');
    expect(companyWebsiteHref('rush.edu', 'http://www.rush.edu/')).toBe('http://www.rush.edu/');
  });

  it('refuses a script, a different host, a lookalike, and a login in the address', () => {
    // WHY: the visible word is the customer's domain. Those addresses would
    // send the click somewhere else, or run as script.
    expect(companyWebsiteHref('ci.com', 'javascript:alert(1)')).toBeNull();
    expect(companyWebsiteHref('ci.com', 'https://evil.example/phish')).toBeNull();
    expect(companyWebsiteHref('ci.com', 'https://notci.com/')).toBeNull();
    expect(companyWebsiteHref('ci.com', 'https://ci.com.evil.com/')).toBeNull();
    expect(companyWebsiteHref('ci.com', 'https://user:pass@www.ci.com/')).toBeNull();
    expect(companyWebsiteHref('ci.com', 'data:text/html,hi')).toBeNull();
    expect(companyWebsiteHref('10.0.0.1', 'http://10.0.0.1/')).toBeNull();
    expect(companyWebsiteHref('files.local', 'http://files.local/')).toBeNull();
    expect(companyWebsiteHref('ci.com', null)).toBeNull();
    expect(companyWebsiteHref('  ', 'https://www.ci.com/')).toBeNull();
    expect(companyWebsiteHref('localhost', 'http://localhost/')).toBeNull();
  });

  it('keeps a real https address that is not this domain, and drops a script', () => {
    // WHY: the logo brief can show the stored address as itself. It still
    // must not be a script or a URL with an embedded login.
    expect(publicHttpUrl('https://evil.example/phish')).toBe('https://evil.example/phish');
    expect(publicHttpUrl('javascript:alert(1)')).toBeNull();
    expect(publicHttpUrl('https://user:pass@www.ci.com/')).toBeNull();
    expect(publicHttpUrl('//www.ci.com')).toBeNull();
  });
});
