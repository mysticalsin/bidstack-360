import { test, expect } from './fixtures.js';

test.describe('Intake page', () => {
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/intake');
    await expect(page.getByRole('heading', { name: 'Intake', level: 1 })).toBeVisible();
  });

  test('stepper steps are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/intake');
    // The intake flow has 4 stepper steps
    await expect(page.getByRole('button', { name: 'Receive' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Extract' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  });

  test('initial step shows document upload area', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/intake');
    // Step 1 ("Receive") renders a "Select documents" heading and drop zone
    await expect(page.getByRole('heading', { name: 'Select documents', level: 2 })).toBeVisible();
  });

  test('drop zone is rendered on step 1', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/intake');
    await expect(page.getByText(/Drag & drop files here/i)).toBeVisible();
  });
});
