/**
 * WHY: at 390px the map table's overflow:hidden clipped the Maps-to selects,
 * so a phone user could not map Name. The control has to sit inside the
 * viewport and Name has to be the selected field.
 */
import { expect, test, type Locator } from '@playwright/test';

const CSV = {
  name: 'accounts.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from('Account Name,Employees,Country\nNorthwind Traders,120,US\n'),
};

async function boxOf(select: Locator) {
  return select.evaluate((el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

function expectInside(box: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }) {
  expect(box.width).toBeGreaterThanOrEqual(120);
  expect(box.height).toBeGreaterThanOrEqual(28);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('maps-to controls sit inside a 390x844 viewport and Name is mapped', async ({ page }) => {
  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await page.goto('/settings?tab=data-import', { waitUntil: 'load' });
  await expect(page.getByRole('button', { name: /choose a csv/i })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(CSV);

  const nameSelect = page.getByRole('combobox', { name: 'Map column Account Name' });
  await expect(nameSelect).toBeVisible();
  expectInside(await boxOf(nameSelect), viewport);
  await expect(nameSelect).toHaveValue('company.name');
  await nameSelect.selectOption({ label: 'Domain' });
  await expect(nameSelect).toHaveValue('company.domain');
  await nameSelect.selectOption({ label: 'Name *' });
  await expect(nameSelect).toHaveValue('company.name');

  const employees = page.getByRole('combobox', { name: 'Map column Employees' });
  const country = page.getByRole('combobox', { name: 'Map column Country' });
  expectInside(await boxOf(employees), viewport);
  expectInside(await boxOf(country), viewport);
  await expect(employees).toHaveValue('company.employeeCount');
  await expect(country).toHaveValue('company.countryCode');
});

test('maps-to controls stay inside a 1440px viewport', async ({ page }) => {
  const viewport = { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  await page.goto('/settings?tab=data-import', { waitUntil: 'load' });
  await page.locator('input[type="file"]').setInputFiles(CSV);
  await expect(page.getByRole('columnheader', { name: 'Maps to' })).toBeVisible();

  const nameSelect = page.getByRole('combobox', { name: 'Map column Account Name' });
  await expect(nameSelect).toBeVisible();
  expectInside(await boxOf(nameSelect), viewport);
  await expect(nameSelect).toHaveValue('company.name');
  await expect(page.getByRole('combobox', { name: 'Map column Employees' })).toHaveValue(
    'company.employeeCount',
  );
  await expect(page.getByRole('combobox', { name: 'Map column Country' })).toHaveValue(
    'company.countryCode',
  );
});
