import { test } from './fixtures.js';

test('diagnostic page load', async ({ page, gotoAndWait }) => {
  page.on('console', (msg) => {
    console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}]: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    console.error(`[BROWSER UNCAUGHT EXCEPTION]: ${err.stack || err.message}`);
  });
  page.on('requestfailed', (request) => {
    console.error(
      `[BROWSER REQUEST FAILED]: ${request.url()} - ${request.failure()?.errorText || 'unknown error'}`,
    );
  });

  console.log('Navigating to dashboard via gotoAndWait...');
  try {
    await gotoAndWait('/dashboard');
    console.log('Page loaded, waiting 5 seconds...');
    await page.waitForTimeout(5000);
    const bodyText = await page.locator('body').innerText();
    console.log('--- VISIBLE TEXT ---');
    console.log(bodyText);
    console.log('--------------------');
  } catch (e) {
    console.error('Error during navigation:', e);
  }
});
