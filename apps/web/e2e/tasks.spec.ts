import { test, expect } from './fixtures.js';

test.describe('Tasks page', () => {
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/tasks');
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  });

  test('filter chips are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/tasks');
    const tablist = page.getByRole('tablist', { name: 'Filter tasks' });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByText('All')).toBeVisible();
    await expect(tablist.getByText('Today')).toBeVisible();
    await expect(tablist.getByText('Overdue')).toBeVisible();
    await expect(tablist.getByText('Open')).toBeVisible();
    await expect(tablist.getByText('In progress')).toBeVisible();
    await expect(tablist.getByText('Done')).toBeVisible();
  });

  test('"+ New task" button is present', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/tasks');
    await expect(page.getByRole('button', { name: '+ New task' })).toBeVisible();
  });

  test('task list or empty state is shown', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/tasks');
    // Either a task row or an empty state must be visible — never a blank page
    const taskItems = page.locator('[role="listitem"]');
    const emptyState = page.getByText(/no tasks|nothing here/i);
    await expect(taskItems.or(emptyState).first()).toBeVisible();
  });

  test('clicking "Overdue" filter chip updates URL', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/tasks');
    const tablist = page.getByRole('tablist', { name: 'Filter tasks' });
    await tablist.getByText('Overdue').click();
    await expect(page).toHaveURL(/filter=overdue/);
  });
});
