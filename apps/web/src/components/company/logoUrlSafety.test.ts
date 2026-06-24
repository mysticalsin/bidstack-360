import { describe, expect, it } from 'vitest';

import { displayableLogoUrl } from './logoUrlSafety';

describe('displayableLogoUrl', () => {
  it('allows same-origin and relative assets', () => {
    expect(displayableLogoUrl('/api/v1/assets/logos/mantu.png')).toBe(
      '/api/v1/assets/logos/mantu.png',
    );
    expect(displayableLogoUrl(`${window.location.origin}/api/v1/assets/logos/mantu.png`)).toContain(
      '/api/v1/assets/logos/mantu.png',
    );
  });

  it('blocks third-party runtime logo requests', () => {
    expect(displayableLogoUrl('https://www.google.com/s2/favicons?domain=mantu.com')).toBeNull();
    expect(displayableLogoUrl('https://commons.wikimedia.org/wiki/Special:Redirect/file/x.svg')).toBeNull();
  });
});
