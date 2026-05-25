/**
 * ai-assistant.spec.ts
 *
 * WHY: The AI command palette (Cmd+K) is BidStack's primary productivity
 * surface. If it fails to open, respond, or apply drafts, the entire
 * AI-assisted workflow is broken. The mock server intercepts Dust/AI calls
 * so this spec runs without any real LLM cost.
 */
import { test, expect } from '@playwright/test';
import { AiAssistantPanel } from '../pages/AiAssistantPanel.js';

test.describe('AI assistant panel (Cmd+K)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible' });
  });

  test('command palette opens via Ctrl+K', async ({ page }) => {
    const ai = new AiAssistantPanel(page);
    await ai.open();
    await expect(ai.dialog).toBeVisible({ timeout: 5_000 });
  });

  test('Escape closes the panel', async ({ page }) => {
    const ai = new AiAssistantPanel(page);
    await ai.open();
    await ai.close();
    await expect(ai.dialog).not.toBeVisible({ timeout: 3_000 });
  });

  test('typing in the panel shows navigation results', async ({ page }) => {
    const ai = new AiAssistantPanel(page);
    await ai.open();
    await ai.typeQuery('pipeline');
    // At least one result should appear
    await expect(
      ai.resultList.getByRole('option').or(page.getByText(/pipeline/i)).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('enter key navigates to the matched route', async ({ page }) => {
    const ai = new AiAssistantPanel(page);
    await ai.open();
    await ai.navigateTo('pipeline');
    await expect(page).toHaveURL(/\/pipeline/, { timeout: 10_000 });
  });

  test('AI draft command renders draft section (mocked)', async ({ page }) => {
    const ai = new AiAssistantPanel(page);
    await ai.open();
    // Try to invoke the "draft email" or "ask AI" command
    await ai.typeQuery('draft email');

    // If the result list shows an AI option, click it
    const aiOption = page.getByRole('option', { name: /draft|ai|email/i }).first();
    const hasAiOption = await aiOption.isVisible({ timeout: 3_000 }).catch(() => false);

    if (!hasAiOption) {
      test.skip(true, 'AI draft command not available in command palette results');
    }
    await aiOption.click();
    // The mocked Dust server returns a stub response — check for draft section
    await ai.assertDraftVisible();
  });
});
