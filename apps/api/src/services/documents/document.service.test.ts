import { describe, expect, it } from 'vitest';

import { resolvePuppeteerExecutablePath } from './document.service.js';

describe('resolvePuppeteerExecutablePath', () => {
  it('uses an explicit Puppeteer executable path before probing the filesystem', () => {
    const path = resolvePuppeteerExecutablePath(
      { PUPPETEER_EXECUTABLE_PATH: '  /opt/chrome/chrome  ', CHROME_BIN: '/ignored/chrome' },
      () => false,
    );

    expect(path).toBe('/opt/chrome/chrome');
  });

  it('uses CHROME_BIN when Puppeteer executable path is unset', () => {
    const path = resolvePuppeteerExecutablePath({ CHROME_BIN: '/usr/local/bin/chromium' }, () => {
      throw new Error('explicit configuration should not touch the filesystem');
    });

    expect(path).toBe('/usr/local/bin/chromium');
  });

  it('returns explicit configuration even when the path cannot be probed locally', () => {
    const path = resolvePuppeteerExecutablePath(
      { PUPPETEER_EXECUTABLE_PATH: '/misconfigured/chrome' },
      () => false,
    );

    expect(path).toBe('/misconfigured/chrome');
  });

  it('finds the first installed system Chromium path', () => {
    const checked: string[] = [];
    const path = resolvePuppeteerExecutablePath({}, (candidate) => {
      checked.push(candidate);
      return candidate === '/usr/bin/chromium';
    });

    expect(path).toBe('/usr/bin/chromium');
    expect(checked).toEqual(['/usr/bin/chromium-browser', '/usr/bin/chromium']);
  });

  it('returns undefined when no browser path is configured or installed', () => {
    expect(resolvePuppeteerExecutablePath({}, () => false)).toBeUndefined();
  });
});
