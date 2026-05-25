import { test, expect } from './fixtures.js';

test.describe('Integrations page', () => {
  test('shows the connection command center and setup surfaces', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/integrations');

    await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connection command center' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /MCP server/ })).toBeVisible();
    await expect(page.getByText('MCP Streamable HTTP URL')).toBeVisible();

    await page.getByRole('tab', { name: /REST API/ }).click();
    await expect(page.getByText('REST base URL')).toBeVisible();
    await expect(page.getByText('Opportunity search example')).toBeVisible();

    await page.getByRole('tab', { name: /Webhooks/ }).click();
    await expect(page.getByText('Subscriptions API')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connection tester' })).toBeVisible();
    await expect(page.getByText('No secrets sent')).toBeVisible();

    await page.getByRole('button', { name: /REST API Data sync endpoints/ }).click();
    await page.getByLabel('Endpoint URL').fill('http://localhost:4010/livez?token=secret#frag');
    await page.getByRole('button', { name: /Test endpoint/ }).click();
    await expect(page.getByTestId('connection-probe-result')).toContainText('Endpoint is reachable.');
    await expect(page.getByText('HTTP 200')).toBeVisible();
    await expect(page.getByTestId('connection-probe-result')).not.toContainText('secret');

    await page.getByRole('tab', { name: /Developer Tools/ }).click();
    await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Webhook subscriptions' })).toBeVisible();
  });
});
