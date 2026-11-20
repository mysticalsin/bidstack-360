import { type Page } from '@playwright/test';

/**
 * Chromium-safe slice of a Playwright device descriptor.
 *
 * WHY: `devices['iPhone SE']` / `devices['iPad Mini']` set
 * `defaultBrowserType: 'webkit'`. Spreading the full descriptor into
 * `test.use()` makes the chromium-desktop project try to launch WebKit,
 * which CI does not install (1ms "Executable doesn't exist" failures).
 * Viewport, UA, and touch flags are what the responsive specs actually
 * assert; keep the project's configured browser.
 */
export function chromiumDeviceUse(
  device: {
    viewport: { width: number; height: number };
    userAgent: string;
    isMobile?: boolean;
    hasTouch?: boolean;
    deviceScaleFactor?: number;
  },
) {
  return {
    viewport: device.viewport,
    userAgent: device.userAgent,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    deviceScaleFactor: device.deviceScaleFactor,
  };
}

const STABLE_DYNAMIC_TEXT_CSS = `
  [data-testid="opportunity-updated-at"] {
    color: transparent !important;
    display: inline-block !important;
    font-size: 0 !important;
    line-height: 1rem !important;
    overflow: hidden !important;
    vertical-align: baseline !important;
    width: 4.75rem !important;
  }

  [data-testid="opportunity-updated-at"]::after {
    color: var(--fg-tertiary) !important;
    content: "recently";
    font-size: 0.75rem !important;
  }

  /* Demo/real-mode banner is env-dependent and is not part of the layout
     baseline these screenshots lock. Hide it so #245 copy cannot flake every
     viewport snapshot. */
  [data-testid="data-mode-banner"] {
    display: none !important;
  }
`;

export async function stabilizeResponsiveScreenshot(page: Page) {
  await page.addStyleTag({ content: STABLE_DYNAMIC_TEXT_CSS });
}
