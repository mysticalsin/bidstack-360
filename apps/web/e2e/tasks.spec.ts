import { test, expect } from './fixtures.js';

test.describe('Tasks page', () => {
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/tasks');
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  });

  test('filter chips are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/tasks');
    const filterGroup = page.getByRole('group', { name: 'Filter tasks' });
    await expect(filterGroup).toBeVisible();
    await expect(filterGroup.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(filterGroup.getByRole('button', { name: 'Today' })).toBeVisible();
    await expect(filterGroup.getByRole('button', { name: 'Overdue' })).toBeVisible();
    await expect(filterGroup.getByRole('button', { name: 'Open' })).toBeVisible();
    await expect(filterGroup.getByRole('button', { name: 'In progress' })).toBeVisible();
    await expect(filterGroup.getByRole('button', { name: 'Done' })).toBeVisible();
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
    const filterGroup = page.getByRole('group', { name: 'Filter tasks' });
    await filterGroup.getByRole('button', { name: 'Overdue' }).click();
    await expect(page).toHaveURL(/filter=overdue/);
  });

  test('natural ordering exposes keyboard reorder and status actions', async ({
    page,
    gotoAndWait,
  }) => {
    await gotoAndWait('/tasks');
    const taskItems = page.locator('[role="listitem"]');
    const emptyState = page.getByText(/no tasks|nothing here/i);
    await expect(taskItems.or(emptyState).first()).toBeVisible();
    test.skip((await taskItems.count()) === 0, 'no task rows visible');

    await expect(page.getByRole('button', { name: /^Move .+ down$/ }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Status: .+ Activate to change to .+$/ }).first(),
    ).toBeVisible();
  });
});
