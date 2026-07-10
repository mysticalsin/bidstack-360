/**
 * esignature.spec.ts
 *
 * WHY: E-signature is a legal workflow. A corrupted or undeliverable signing
 * link means contracts never close. This spec covers the full lifecycle:
 * send for signature, public signing page, and status update in the CRM.
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { PublicSignPage } from '../pages/PublicSignPage.js';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';

// Seeded by packages/db/src/seed.ts as a persistent Document row (distinct
// from the one-shot SignatureRequest also seeded there, which the "full sign
// flow" test below consumes). Reused here only as the documentId FK required
// by POST /signatures/requests — never signed itself.
const SEEDED_DOCUMENT_ID = 'd0c00000-0000-0000-0000-000000000000';

// Freshly minted (not DB-seeded) in beforeAll below, so a Playwright CI retry
// (playwright.config.ts sets retries: 1 in CI) or a local re-run without a DB
// reset re-enters this serial suite against a brand-new, never-consumed token
// instead of the one the "full sign flow" test already signed.
let signToken: string;

test.describe('E-signature flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${API_URL}/api/v1/signatures/requests`, {
      data: {
        documentId: SEEDED_DOCUMENT_ID,
        recipients: [{ email: 'e2e-signer@example.com', name: 'E2E Signer', role: 'SIGNER' }],
        provider: 'INTERNAL',
      },
      timeout: 10_000,
    });
    if (!res.ok()) {
      throw new Error(
        `esignature.spec.ts beforeAll: failed to mint a fresh signature request (${res.status()}): ${await res.text()}`,
      );
    }
    const body = (await res.json()) as { signingUrl?: string | null };
    if (!body.signingUrl) {
      throw new Error('esignature.spec.ts beforeAll: signature request response had no signingUrl');
    }
    signToken = new URL(body.signingUrl).pathname.split('/').pop() ?? '';
    await ctx.dispose();
  });

  test('signing page renders for a valid token', async ({ page }) => {
    const signPage = new PublicSignPage(page);
    await signPage.navigate(signToken);

    const expired = await signPage.isExpired();
    expect(
      expired,
      `Freshly minted signing token "${signToken}" must be valid before the suite runs`,
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
    await signPage.navigate(signToken);

    const expired = await signPage.isExpired();
    expect(expired, `Freshly minted signing token "${signToken}" must be valid`).toBe(false);

    await signPage.startSigning();

    const padVisible = await signPage.signaturePad
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    expect(padVisible, 'Signature pad must be visible for the freshly minted request').toBe(true);

    await signPage.drawSignature();
    const continueBtn = page.getByRole('button', { name: /continue/i });
    await expect(continueBtn).toBeEnabled({ timeout: 3_000 });
  });

  test('full sign flow: draw, submit, confirmation', async ({ page }) => {
    const signPage = new PublicSignPage(page);
    await signPage.navigate(signToken);

    const expired = await signPage.isExpired();
    expect(expired, `Freshly minted signing token "${signToken}" must be valid`).toBe(false);

    await signPage.startSigning();

    const padVisible = await signPage.signaturePad
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    expect(padVisible, 'Signature pad must be visible for the freshly minted request').toBe(true);

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
