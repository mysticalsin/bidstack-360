/**
 * PublicSignPage POM
 *
 * Covers /sign/:token — the public e-signature page.
 * No auth required. Recipients see the document and a signature pad.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class PublicSignPage {
  readonly page: Page;
  readonly documentViewer: Locator;
  readonly signaturePad: Locator;
  readonly clearButton: Locator;
  readonly submitButton: Locator;
  readonly successMessage: Locator;
  readonly expiredMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.documentViewer = page
      .locator('[data-testid="document-viewer"], iframe, .pdf-viewer')
      .first();
    this.signaturePad = page.locator('[data-testid="signature-pad"], canvas').first();
    this.clearButton = page.getByRole('button', { name: /clear|reset signature/i });
    this.submitButton = page.getByRole('button', { name: /sign|submit|complete signing/i });
    this.successMessage = page.getByRole('heading', { name: 'Signature submitted' });
    this.expiredMessage = page.getByText(
      /expired|invalid signing link|invalid token|link has expired/i,
    );
  }

  async navigate(token: string): Promise<void> {
    await this.page.goto(`/sign/${token}`, { waitUntil: 'load' });
  }

  async startSigning(): Promise<void> {
    const startBtn = this.page.getByRole('button', { name: /review and sign/i });
    if (await startBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await startBtn.click();
    }
  }

  async isExpired(): Promise<boolean> {
    await this.expiredMessage
      .or(this.documentViewer)
      .or(this.signaturePad)
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => undefined);
    return this.expiredMessage
      .first()
      .isVisible()
      .catch(() => false);
  }

  async drawSignature(): Promise<void> {
    const box = await this.signaturePad.boundingBox();
    if (!box) throw new Error('Signature pad bounding box not found');
    // Draw a simple stroke across the canvas
    await this.page.mouse.move(box.x + 20, box.y + box.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
    await this.page.mouse.up();
  }

  async signAndSubmit(): Promise<void> {
    await this.drawSignature();

    // Click Continue on the draw signature step
    const continueBtn = this.page.getByRole('button', { name: /continue/i });
    await expect(continueBtn).toBeEnabled({ timeout: 5_000 });
    await continueBtn.click();

    // Check terms checkbox on the submit step
    const termsCheckbox = this.page.getByRole('checkbox');
    await expect(termsCheckbox).toBeVisible({ timeout: 5_000 });
    await termsCheckbox.check();

    // Click Submit signature (which matches submitButton)
    await expect(this.submitButton).toBeEnabled({ timeout: 5_000 });
    await this.submitButton.click();
  }

  async assertSigned(): Promise<void> {
    await expect(this.successMessage).toBeVisible({ timeout: 15_000 });
  }
}
