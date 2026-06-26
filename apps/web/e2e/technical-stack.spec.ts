import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';

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

type TechnicalStackCategory = {
  label: string;
  items: Array<{
    name: string;
    source: string;
    confidence: number;
  }>;
};

type TechnicalStackState = {
  manualStack: TechnicalStackCategory[];
  effectiveStack?: TechnicalStackCategory[];
};

type TechnicalStackRefreshResponse = {
  providers: Array<{ id: string }>;
};

const BLOCKING_AXE_IMPACTS = ['critical', 'serious'] as const;

function stackContainsVendor(stack: TechnicalStackCategory[] | undefined, vendor: string): boolean {
  return Boolean(stack?.some((category) => category.items.some((item) => item.name === vendor)));
}

function stackHasEntries(stack: TechnicalStackCategory[] | undefined): boolean {
  return Boolean(stack?.some((category) => category.items.length > 0));
}

async function fetchDashboardSnapshot(request: APIRequestContext): Promise<DashboardSnapshot> {
  const response = await request.get(`${API_URL}/api/v1/crm/dashboard`);
  expect(response.ok(), 'dashboard endpoint must respond').toBeTruthy();
  return (await response.json()) as DashboardSnapshot;
}

async function fetchAccountSnapshot(request: APIRequestContext): Promise<{
  accountId: string;
  companyName: string;
}> {
  const baseline = await fetchDashboardSnapshot(request);
  const target =
    baseline.companies.find((company) => company.id !== baseline.cockpit.company.id) ??
    baseline.companies[0] ??
    baseline.cockpit.company;
  const response = await request.get(
    `${API_URL}/api/v1/crm/dashboard?account=${encodeURIComponent(target.id)}`,
  );
  expect(response.ok(), 'target account dashboard endpoint must respond').toBeTruthy();
  const snapshot = (await response.json()) as DashboardSnapshot;
  expect(snapshot.cockpit.company.id, 'dashboard must resolve the requested account id').toBe(
    target.id,
  );
  return { accountId: target.id, companyName: snapshot.cockpit.company.name };
}

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .include('[aria-label="Technical Stack Overview"]')
    .exclude('iframe')
    .analyze();
  const blockingViolations = results.violations.filter((violation) =>
    BLOCKING_AXE_IMPACTS.includes(violation.impact as (typeof BLOCKING_AXE_IMPACTS)[number]),
  );
  expect(
    blockingViolations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.slice(0, 2).map((node) => node.target),
    })),
    'technical stack editor must have no critical/serious axe violations',
  ).toEqual([]);
}

test('technical stack source pull and manual add flow stay usable', async ({
  page,
  gotoAndWait,
}) => {
  const { accountId, companyName } = await fetchAccountSnapshot(page.request);
  const stackPath = `${API_URL}/api/v1/crm/companies/${encodeURIComponent(companyName)}/technical-stack`;
  const initialResponse = await page.request.get(stackPath);
  expect(initialResponse.ok(), 'initial technical stack state must load').toBeTruthy();
  const initialState = (await initialResponse.json()) as TechnicalStackState;
  const shouldSeedLaunchpad =
    !stackHasEntries(initialState.manualStack) && !stackHasEntries(initialState.effectiveStack);

  if (shouldSeedLaunchpad) {
    const seedResponse = await page.request.put(stackPath, {
      data: {
        stack: [
          {
            label: 'QA',
            items: [
              {
                name: 'Seeded Launchpad Baseline',
                source: 'manual',
                confidence: 1,
              },
            ],
          },
        ],
      },
    });
    expect(seedResponse.ok(), 'technical stack launchpad seed must persist').toBeTruthy();
  }

  try {
    await gotoAndWait(`/accounts/${accountId}`);

    const stackSection = page.getByRole('region', { name: /technical stack overview/i });
    await expect(stackSection, 'technical stack region must mount').toBeVisible({
      timeout: 15_000,
    });
    const sourceRail = stackSection.getByLabel('Technical stack sources', { exact: true });
    await expect(sourceRail.getByText('Apollo')).toBeVisible();
    await expect(sourceRail.getByText('Seamless')).toBeVisible();
    await expect(sourceRail.getByText('Tech Intel')).toBeVisible();
    await expect(sourceRail.getByText('Open data')).toBeVisible();
    const addLaunchpad = stackSection.getByLabel('Source-backed stack add launchpad');
    await expect(addLaunchpad).toBeVisible();
    await expect(addLaunchpad).toContainText('Add from verified sources');
    await expect(addLaunchpad).toContainText('Apollo');
    await expect(addLaunchpad).toContainText('Seamless.AI');
    await expect(addLaunchpad).toContainText('Tech Intel');
    await expect(addLaunchpad).toContainText('Other sources');

    const refreshResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/technical-stack/refresh'),
    );
    await addLaunchpad
      .getByRole('button', {
        name: 'Pull and review technical stack sources from Apollo, Seamless, Tech Intel MCPs, and attributed sources',
      })
      .click();
    const refreshResponse = await refreshResponsePromise;
    expect(refreshResponse.ok(), 'source pull endpoint must respond').toBeTruthy();
    const refreshBody = (await refreshResponse.json()) as TechnicalStackRefreshResponse;
    expect(
      refreshBody.providers.map((provider) => provider.id).sort(),
      'source pull must report every configured provider lane',
    ).toEqual(['apollo', 'open_data', 'seamless', 'tech_intel']);
    await expect(
      stackSection.getByText(/Queued MCP|Queued API|Synced|Disabled|Review|No signal/).first(),
    ).toBeVisible();

    await expect(stackSection.getByLabel('Stack categories')).toBeVisible();
    await expect(stackSection.getByRole('button', { name: 'Import stack file' })).toBeVisible();
    await expect(stackSection.getByLabel('Source readiness map')).toBeVisible();
    await expect(stackSection.getByLabel('Source readiness map')).toContainText('Open data');
    await expect(stackSection.getByLabel('Source readiness map')).toContainText('Valid open data');
    await expectNoBlockingAxeViolations(page);

    const vendor = `Playwright QA Stack ${Date.now()}`;
    await stackSection.getByLabel('New stack category').fill('QA');
    await stackSection.getByLabel('New stack vendor').fill(vendor);
    const verificationGuide = stackSection.getByLabel('Source verification guide');
    await expect(verificationGuide).toBeVisible();
    await expect(verificationGuide).toContainText(/Manual route clear|Verify before staging|Stage source-backed/);
    await expect(verificationGuide.getByLabel('Source verification steps')).toContainText('Stage');
    await page.setViewportSize({ width: 390, height: 844 });
    await verificationGuide.scrollIntoViewIfNeeded();
    await expect(verificationGuide).toBeVisible();
    await expect
      .poll(async () =>
        stackSection.evaluate((section) => section.scrollWidth <= section.clientWidth + 1),
      )
      .toBe(true);
    expect(
      await verificationGuide.locator('button').evaluateAll((buttons) =>
        buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width >= 44 && rect.height >= 44;
        }),
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await stackSection.getByRole('button', { name: 'Add vendor' }).click();
    await expect(stackSection.getByLabel('Recently staged stack entries')).toContainText(vendor);
    await expect
      .poll(async () =>
        stackSection
          .locator('input')
          .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
      )
      .toContain(vendor);

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && response.url().endsWith('/technical-stack'),
    );
    await stackSection.getByRole('button', { name: 'Save technical stack' }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok(), 'manual technical stack save must persist').toBeTruthy();
    const savedBody = (await saveResponse.json()) as TechnicalStackState;
    expect(
      stackContainsVendor(savedBody.manualStack, vendor) ||
        stackContainsVendor(savedBody.effectiveStack, vendor),
      'save response must include the vendor just added in the editor',
    ).toBe(true);

    await stackSection.getByRole('button', { name: 'Edit technical stack' }).click();
    await expect
      .poll(async () =>
        stackSection
          .locator('input')
          .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
      )
      .toContain(vendor);
    await stackSection.getByRole('button', { name: 'Cancel technical stack editing' }).click();
  } finally {
    await page.request.put(stackPath, { data: { stack: initialState.manualStack } });
  }
});
