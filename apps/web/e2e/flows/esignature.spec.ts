/**
 * esignature.spec.ts
 *
 * WHY: E-signature is a legal workflow. A corrupted or undeliverable signing
 * link means contracts never close. This spec covers the full lifecycle:
 * send for signature, public signing page, and status update in the CRM.
 */
import { test, expect } from '@playwright/test';
import { seededValue } from '../fixtures/env.js';
import { PublicSignPage } from '../pages/PublicSignPage.js';

const TEST_SIGN_TOKEN = seededValue('E2E_SIGN_TOKEN', 'test-sign-token');

test.describe('E-signature flow', () => {
  test.describe.configure({ mode: 'serial' });

  test('signing page renders for a valid token', async ({ page }) => {
    const signPage = new PublicSignPage(page);
    await signPage.navigate(TEST_SIGN_TOKEN);

    const expired = await signPage.isExpired();
    expect(
      expired,
      `Seeded signing token "${TEST_SIGN_TOKEN}" must be valid before the suite runs`,
    ).toBe(false);

    await expect(signPage.signaturePad.or(signPage.documentViewer)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('signing page shows error for an expired token', async ({ page }) => {
    const signPage = new PublicSignPage(page);
    await signPage.navigate('definitely-invalid-token-xyz-123');

    await expect(
      signPage.expiredMessage.or(page.getByText(/not found|invalid|error/i)).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('signature pad is interactable', async ({ page }) => {
    const signPage = new PublicSignPage(page);
    await signPage.navigate(TEST_SIGN_TOKEN);

    const expired = await signPage.isExpired();
    expect(expired, `Seeded signing token "${TEST_SIGN_TOKEN}" must be valid`).toBe(false);

    await signPage.startSigning();

    const padVisible = await signPage.signaturePad
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    expect(padVisible, 'Signature pad must be visible for the seeded request').toBe(true);

    await signPage.drawSignature();
    const continueBtn = page.getByRole('button', { name: /continue/i });
    await expect(continueBtn).toBeEnabled({ timeout: 3_000 });
  });

  test('full sign flow: draw, submit, confirmation', async ({ page }) => {
    const signPage = new PublicSignPage(page);
    await signPage.navigate(TEST_SIGN_TOKEN);

    const expired = await signPage.isExpired();
    expect(expired, `Seeded signing token "${TEST_SIGN_TOKEN}" must be valid`).toBe(false);

    await signPage.startSigning();

    const padVisible = await signPage.signaturePad
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    expect(padVisible, 'Signature pad must be visible for the seeded request').toBe(true);

    await signPage.signAndSubmit();
    await signPage.assertSigned();
  });

  test('send-for-signature UI is accessible from deal detail', async ({ page }) => {
    await page.goto('/opportunities', { waitUntil: 'load' });
    const firstLink = page.locator('main a[href^="/opportunities/"]').first();
    await expect(
      firstLink,
      'Seeded E2E data must include at least one visible opportunity link',
    ).toBeVisible({ timeout: 15_000 });

    await firstLink.click();
    await expect(page.locator('#main')).toBeVisible({ timeout: 10_000 });

    const docTab = page.getByRole('tab', { name: /documents|files/i });
    await expect(docTab, 'Opportunity detail must expose a Documents tab').toBeVisible({
      timeout: 10_000,
    });
    await docTab.click();

    const sendBtn = page.getByRole('button', {
      name: /send for signature|e-sign|sign document/i,
    });
    await expect(
      sendBtn,
      'Opportunity detail must expose a Send for Signature CTA in Documents',
    ).toBeVisible({ timeout: 5_000 });
    await expect(sendBtn).toBeEnabled();
  });
});
