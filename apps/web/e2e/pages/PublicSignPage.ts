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
    this.documentViewer = page.locator('[data-testid="document-viewer"], iframe, .pdf-viewer').first();
    this.signaturePad = page.locator('[data-testid="signature-pad"], canvas').first();
    this.clearButton = page.getByRole('button', { name: /clear|reset signature/i });
    this.submitButton = page.getByRole('button', { name: /sign|submit|complete signing/i });
    this.successMessage = page.getByText(/signed|thank you|signature recorded/i);
    this.expiredMessage = page.getByText(/expired|invalid token|link has expired/i);
  }

  async navigate(token: string): Promise<void> {
    await this.page.goto(`/sign/${token}`, { waitUntil: 'load' });
  }

  async isExpired(): Promise<boolean> {
    return this.expiredMessage.isVisible({ timeout: 5_000 }).catch(() => false);
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
    await this.submitButton.click();
  }

  async assertSigned(): Promise<void> {
    await expect(this.successMessage).toBeVisible({ timeout: 15_000 });
  }
}
