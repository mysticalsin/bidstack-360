import { test, expect } from './fixtures.js';
import type { APIRequestContext, Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';
const SCANNED_MSA_FIXTURE_PATH = path.resolve(
  process.cwd(),
  'e2e/fixtures/scanned-msa-e2e.pdf',
);

type DashboardSnapshot = {
  cockpit: {
    company: {
      id: string;
      name: string;
    };
  };
  companies: Array<{
    id: string;
    name: string;
  }>;
};

async function fetchDashboardAccountId(request: APIRequestContext) {
  const response = await request.get(`${API_URL}/api/v1/crm/dashboard`);
  expect(response.ok(), 'dashboard endpoint must respond before account QA').toBeTruthy();
  const snapshot = (await response.json()) as DashboardSnapshot;
  const account = snapshot.companies.find((company) => company.id !== snapshot.cockpit.company.id)
    ?? snapshot.companies[0]
    ?? snapshot.cockpit.company;
  expect(account?.id, 'seeded account id is required for contract QA').toBeTruthy();
  return account.id;
}

async function dropPdfOn(locator: Locator, fileName: string) {
  await locator.evaluate((node, name) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n'], name, {
        type: 'application/pdf',
      }),
    );
    node.dispatchEvent(
      new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    node.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    node.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  }, fileName);
}

async function dropTextDocumentOn(locator: Locator, fileName: string, text: string) {
  await locator.evaluate(
    (node, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([payload.text], payload.fileName, {
          type: 'text/plain',
        }),
      );
      node.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      node.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      node.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    },
    { fileName, text },
  );
}

async function dropBinaryDocumentOn(
  locator: Locator,
  args: { fileName: string; contentType: string; bytes: Buffer },
) {
  const base64 = args.bytes.toString('base64');
  await locator.evaluate(
    (node, payload) => {
      const binary = atob(payload.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], payload.fileName, {
          type: payload.contentType,
        }),
      );
      node.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      node.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      node.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    },
    { fileName: args.fileName, contentType: args.contentType, base64 },
  );
}

async function expectDocumentWorkerReady() {
  const healthUrl = process.env.E2E_DOCUMENT_WORKER_HEALTH_URL;
  expect(
    healthUrl,
    'E2E_DOCUMENT_WORKER=1 must configure the focused worker health URL',
  ).toBeTruthy();
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(healthUrl!);
          return response.ok ? 'ready' : `health ${response.status}`;
        } catch {
          return 'waiting';
        }
      },
      { timeout: 15_000, intervals: [250, 500, 1000] },
    )
    .toBe('ready');
}

test.describe('SERUM and account experience controls', () => {
  test('SERUM status and industry panels stay live and operable', async ({
    page,
    gotoAndWait,
  }) => {
    const serumResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/serum/status') &&
        response.request().method() === 'GET',
    );
    const serumConfigResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/serum/configs/general/deployment') &&
        response.request().method() === 'GET',
    );

    await gotoAndWait('/settings?tab=serum');
    expect((await serumResponse).ok(), 'SERUM status endpoint must return live JSON').toBe(true);
    expect((await serumConfigResponse).ok(), 'SERUM config snapshot must return live JSON').toBe(true);
    await expect(page.getByRole('heading', { name: 'SERUM Control Plane' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Validation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Backend signals' })).toBeVisible();
    await expect(page.getByText('Source tables')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
    await expect(page.getByLabel('Config JSON')).toBeVisible();
    await expect(page.getByLabel('Change reason')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rollback' })).toBeVisible();
    await expect(page.getByText('Audit history')).toBeVisible();
    const agentsConfigResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/serum/configs/agents/registry') &&
        response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: /Agents.*crew agent personas/ }).click();
    expect((await agentsConfigResponse).ok(), 'SERUM agents config snapshot must return live JSON').toBe(true);
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await expect(page.getByText('Operator controls')).toBeVisible();
    await expect(page.getByText('Approval gate', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request approval' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    const agentsEnabled = page.getByRole('switch', { name: 'Enabled' });
    await agentsEnabled.click();
    await expect(agentsEnabled).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('Max concurrent runs').fill('2');
    await page.getByLabel('Allowed agents').fill('agent-rfp, agent-pricing');
    await expect(page.getByLabel('Config JSON')).toHaveValue(/allowedAgentIds/);
    await expect(page.getByLabel('Config JSON')).toHaveValue(/"enabled": true/);
    await expect(page.getByLabel('Config JSON')).toHaveValue(/agent-pricing/);
    await expect(page.getByLabel('Config JSON')).toHaveValue(/"maxConcurrentRuns": 2/);
    const agentsTestResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/serum/configs/agents/registry/test') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    expect((await agentsTestResponse).ok(), 'SERUM agents config test must return readiness checks').toBe(true);
    const configTestResults = page.getByRole('region', { name: 'Config test results' });
    await expect(configTestResults).toBeVisible();
    await expect(configTestResults.getByText('Human approval', { exact: true })).toBeVisible();
    await expect(page.getByText('SERUM status is unavailable')).toHaveCount(0);

    await gotoAndWait('/accounts?view=key');
    await expect(page.getByRole('heading', { name: 'Strategic Accounts' })).toBeVisible();
    const keySignal = page.getByRole('region', { name: 'Key account industry signal' });
    await expect(keySignal).toBeVisible({ timeout: 15_000 });
    const keyIndustry = keySignal.getByRole('button', { name: /Filter key accounts by/ }).first();
    await expect(keyIndustry, 'key account industry cards must be actionable').toBeVisible();
    await keyIndustry.click();
    await expect(keyIndustry).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(keyIndustry).toHaveAttribute('aria-pressed', 'false');

    await gotoAndWait('/accounts?view=top');
    await expect(page.getByRole('heading', { name: 'Top accounts' })).toBeVisible();
    const rankingPanel = page.getByRole('region', { name: 'Account ranking command panel' });
    await expect(rankingPanel).toBeVisible({ timeout: 15_000 });
    await expect(rankingPanel.getByText('Leaderboard signal')).toBeVisible();
    await expect(rankingPanel.getByText('Industry mix')).toBeVisible();
    const topIndustry = rankingPanel.getByRole('button', { name: /Filter top accounts by/ }).first();
    await expect(topIndustry, 'top account industry cards must be actionable').toBeVisible();
    await topIndustry.click();
    await expect(topIndustry).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(topIndustry).toHaveAttribute('aria-pressed', 'false');
  });

  test('contract card supports drag-drop upload, rate lines, save, and cleanup', async ({
    page,
    gotoAndWait,
  }) => {
    test.setTimeout(90_000);
    const accountId = await fetchDashboardAccountId(page.request);
    const reference = `E2E-MSA-${Date.now()}`;
    const fileName = `${reference}.pdf`;
    let fileId: string | null = null;
    let agreementId: string | null = null;

    try {
      await gotoAndWait(`/accounts/${accountId}`);
      const contracts = page.getByRole('region', { name: 'Contractual agreements' });
      await expect(contracts).toBeVisible({ timeout: 30_000 });

      await contracts.getByRole('button', { name: 'Add agreement' }).click();
      await expect(contracts.getByLabel('Contract reference')).toBeVisible();
      const dropzone = contracts.getByTestId('contract-source-dropzone');
      await expect(dropzone).toBeVisible();

      const finalizeResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/files/finalize') &&
          response.request().method() === 'POST',
      );
      await dropPdfOn(dropzone, fileName);
      const finalized = await finalizeResponse;
      expect(finalized.ok(), 'source document upload must finalize').toBe(true);
      fileId = ((await finalized.json()) as { id: string }).id;
      await expect(contracts.getByText(fileName)).toBeVisible({ timeout: 15_000 });

      await contracts.getByLabel('Contract reference').fill(reference);
      await contracts.getByLabel('Countries covered').fill('FR, DE');
      await contracts.getByLabel('Global rebate percent').fill('7.5');
      await contracts.getByRole('button', { name: /Add rate line/ }).click();
      await contracts.getByLabel('Rate line 1 role').fill('E2E Architect');
      await contracts.getByLabel('Rate line 1 rate').fill('1100');
      await contracts.getByLabel('Rate line 1 unit').selectOption('day');

      const createResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/contract-agreements') &&
          !response.url().includes('/extract') &&
          response.request().method() === 'POST',
      );
      await contracts.getByRole('button', { name: 'Save' }).click();
      const created = await createResponse;
      expect(created.ok(), 'reviewed contract agreement must save').toBe(true);
      agreementId = ((await created.json()) as { id: string }).id;

      await expect(contracts.getByText(reference)).toBeVisible({ timeout: 15_000 });
      await expect(contracts.getByText('E2E Architect')).toBeVisible();
      await expect(contracts.getByRole('link', { name: 'View document' }).first()).toBeVisible();
    } finally {
      if (agreementId) {
        const response = await page.request.delete(
          `${API_URL}/api/v1/contract-agreements/${agreementId}`,
        );
        expect(response.ok(), 'created contract agreement cleanup must succeed').toBe(true);
      }
      if (fileId) {
        const response = await page.request.delete(`${API_URL}/api/v1/files/${fileId}`);
        expect(response.ok(), 'created source file cleanup must succeed').toBe(true);
      }
    }
  });

  test('contract extraction runs from browser upload through BullMQ worker to approval', async ({
    page,
    gotoAndWait,
  }) => {
    test.skip(
      process.env.E2E_DOCUMENT_WORKER !== '1',
      'Set E2E_DOCUMENT_WORKER=1 to start the focused document-extract worker.',
    );
    await expectDocumentWorkerReady();
    const accountId = await fetchDashboardAccountId(page.request);
    const reference = 'MSA-E2E-FULLSTACK-001';
    const fileName = `${reference}-${Date.now()}.txt`;
    const sourceText = `
MASTER SERVICES AGREEMENT
Reference: ${reference}
Countries: FR, DE, ES
Currency: EUR
This agreement grants a global rebate of 7.5% on all services.
Effective date: 2026-01-01
Expiry date: 2028-12-31
Rate review: annual

Rate card
Fullstack Architect     1100 / day
Senior Consultant       800 / day
`;
    let fileId: string | null = null;
    let agreementId: string | null = null;

    try {
      await gotoAndWait(`/accounts/${accountId}`);
      const contracts = page.getByRole('region', { name: 'Contractual agreements' });
      await expect(contracts).toBeVisible({ timeout: 30_000 });

      await contracts.getByRole('button', { name: 'Add agreement' }).click();
      const dropzone = contracts.getByTestId('contract-source-dropzone');
      await expect(dropzone).toBeVisible();

      const finalizeResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/files/finalize') &&
          response.request().method() === 'POST',
      );
      await dropTextDocumentOn(dropzone, fileName, sourceText);
      const finalized = await finalizeResponse;
      expect(finalized.ok(), 'source document upload must finalize').toBe(true);
      fileId = ((await finalized.json()) as { id: string }).id;
      await expect(contracts.getByText(fileName)).toBeVisible({ timeout: 15_000 });

      const extractResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/contract-agreements/extract') &&
          response.request().method() === 'POST',
      );
      await contracts.getByRole('button', { name: /Extract fields from document/ }).click();
      const started = await extractResponse;
      expect(started.ok(), 'contract extraction must enqueue from the browser').toBe(true);
      const extractionId = ((await started.json()) as { id: string }).id;

      await expect(contracts.getByText(/Extracting/)).toBeVisible({ timeout: 10_000 });
      const applyButton = contracts.getByRole('button', {
        name: /Apply extracted fields/,
      });
      await expect(applyButton).toBeVisible({ timeout: 45_000 });
      await applyButton.click();

      await expect(contracts.getByLabel('Contract reference')).toHaveValue(reference);
      await expect(contracts.getByLabel('Countries covered')).toHaveValue('FR, DE, ES');
      await expect(contracts.getByLabel('Global rebate percent')).toHaveValue('7.5');
      await expect(contracts.getByLabel('Rate line 1 role')).toHaveValue('Fullstack Architect');
      await expect(contracts.getByLabel('Rate line 1 rate')).toHaveValue('1100');

      const approveResponse = page.waitForResponse(
        (response) =>
          response.url().includes(
            `/api/v1/contract-agreements/extractions/${extractionId}/approve`,
          ) && response.request().method() === 'POST',
      );
      await contracts.getByRole('button', { name: 'Approve and save' }).click();
      const approved = await approveResponse;
      expect(approved.ok(), 'reviewed extraction approval must save').toBe(true);
      agreementId = ((await approved.json()) as { id: string }).id;

      await expect(contracts.getByText(reference)).toBeVisible({ timeout: 15_000 });
      await expect(contracts.getByText('Fullstack Architect')).toBeVisible();
      await expect(contracts.getByRole('link', { name: 'View document' }).first()).toBeVisible();
    } finally {
      if (agreementId) {
        const response = await page.request.delete(
          `${API_URL}/api/v1/contract-agreements/${agreementId}`,
        );
        expect(response.ok(), 'approved contract agreement cleanup must succeed').toBe(true);
      }
      if (fileId) {
        const response = await page.request.delete(`${API_URL}/api/v1/files/${fileId}`);
        expect(response.ok(), 'extracted source file cleanup must succeed').toBe(true);
      }
    }
  });

  test('contract extraction approves an OCR-scanned PDF from browser upload through worker', async ({
    page,
    gotoAndWait,
  }) => {
    test.skip(
      process.env.E2E_DOCUMENT_WORKER !== '1',
      'Set E2E_DOCUMENT_WORKER=1 to start the focused document-extract worker.',
    );
    test.skip(
      process.env.BIDSTACK_OCR_ENABLED !== 'true',
      'Set E2E_DOCUMENT_WORKER_OCR=1 or BIDSTACK_OCR_ENABLED=true to prove scanned-PDF OCR.',
    );
    test.setTimeout(120_000);

    await expectDocumentWorkerReady();
    const accountId = await fetchDashboardAccountId(page.request);
    const reference = 'MSA-OCR-E2E-001';
    const fileName = `${reference}-${Date.now()}.pdf`;
    const pdfBytes = await readFile(SCANNED_MSA_FIXTURE_PATH);
    let fileId: string | null = null;
    let agreementId: string | null = null;

    try {
      await gotoAndWait(`/accounts/${accountId}`);
      const contracts = page.getByRole('region', { name: 'Contractual agreements' });
      await expect(contracts).toBeVisible({ timeout: 30_000 });

      await contracts.getByRole('button', { name: 'Add agreement' }).click();
      const dropzone = contracts.getByTestId('contract-source-dropzone');
      await expect(dropzone).toBeVisible();

      const finalizeResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/files/finalize') &&
          response.request().method() === 'POST',
      );
      await dropBinaryDocumentOn(dropzone, {
        fileName,
        contentType: 'application/pdf',
        bytes: pdfBytes,
      });
      const finalized = await finalizeResponse;
      expect(finalized.ok(), 'scanned source PDF upload must finalize').toBe(true);
      fileId = ((await finalized.json()) as { id: string }).id;
      await expect(contracts.getByText(fileName)).toBeVisible({ timeout: 15_000 });

      const extractResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/contract-agreements/extract') &&
          response.request().method() === 'POST',
      );
      await contracts.getByRole('button', { name: /Extract fields from document/ }).click();
      const started = await extractResponse;
      expect(started.ok(), 'scanned contract extraction must enqueue from the browser').toBe(true);
      const extractionId = ((await started.json()) as { id: string }).id;

      await expect(contracts.getByText(/Extracting/)).toBeVisible({ timeout: 10_000 });
      const applyButton = contracts.getByRole('button', {
        name: /Apply extracted fields/,
      });
      await expect(applyButton).toBeVisible({ timeout: 90_000 });
      await applyButton.click();

      await expect(contracts.getByLabel('Contract reference')).toHaveValue(reference);
      await expect(contracts.getByLabel('Countries covered')).toHaveValue('FR, DE, ES');
      await expect(contracts.getByLabel('Global rebate percent')).toHaveValue('7.5');
      await expect(contracts.getByLabel('Rate line 1 role')).toHaveValue('Fullstack Architect');
      await expect(contracts.getByLabel('Rate line 1 rate')).toHaveValue('1100');

      const approveResponse = page.waitForResponse(
        (response) =>
          response.url().includes(
            `/api/v1/contract-agreements/extractions/${extractionId}/approve`,
          ) && response.request().method() === 'POST',
      );
      await contracts.getByRole('button', { name: 'Approve and save' }).click();
      const approved = await approveResponse;
      expect(approved.ok(), 'reviewed scanned extraction approval must save').toBe(true);
      agreementId = ((await approved.json()) as { id: string }).id;

      await expect(contracts.getByText(reference)).toBeVisible({ timeout: 15_000 });
      await expect(contracts.getByText('Fullstack Architect')).toBeVisible();
      await expect(contracts.getByRole('link', { name: 'View document' }).first()).toBeVisible();
    } finally {
      if (agreementId) {
        const response = await page.request.delete(
          `${API_URL}/api/v1/contract-agreements/${agreementId}`,
        );
        expect(response.ok(), 'approved scanned agreement cleanup must succeed').toBe(true);
      }
      if (fileId) {
        const response = await page.request.delete(`${API_URL}/api/v1/files/${fileId}`);
        expect(response.ok(), 'scanned source file cleanup must succeed').toBe(true);
      }
    }
  });
});
