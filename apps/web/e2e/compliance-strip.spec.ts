// The money screen, end to end: propose → accept → provenance → dismiss → gone
// after a reload.
//
// WHY THE API IS STUBBED HERE AND NOWHERE ELSE IN THIS SUITE: reaching the
// compliance matrix through real data means uploading an RFP, running the
// extraction pipeline, waiting for the compliance-fill worker to propose behind
// RFP_PROPOSE_FACTS, and parking the orchestration at `awaiting_approval` —
// minutes of worker time per assertion, and a test that fails for a dozen
// reasons that have nothing to do with the strip. The bid-facts CONTRACT is
// already covered by the API's own tests (13/13, apps/api/src/routes/
// bid-facts.ts); what has never been covered is the browser half — that an
// accept collapses the strip and re-renders the answer with a receipt, and that
// a dismissal survives a page reload. That is what this spec pins, against the
// real bundle, the real router and the real react-query cache.

import type { Page } from '@playwright/test';

import { test, expect } from './fixtures.js';

const OPPORTUNITY_ID = '4b0f9b1e-3d1a-4a5e-9c1e-1f2a3b4c5d6e';
const ORCHESTRATION_ID = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const ROW_ACCEPT = 'a1111111-1111-4111-8111-111111111111';
const ROW_DISMISS = 'b2222222-2222-4222-8222-222222222222';
const FACT_ACCEPT = 'c3333333-3333-4333-8333-333333333333';
const FACT_DISMISS = 'd4444444-4444-4444-8444-444444444444';

const ACCEPTED_ANSWER = 'YES — hosting is delivered from EU datacentres';
const CITED_QUOTE = 'all data shall reside within the EEA';
const DOCUMENT_NAME = 'Meridian delivery model';

/** The frame the pipeline page needs to park itself at the approval gate. */
const SSE_FRAME = `data: ${JSON.stringify({
  phase: 'awaiting_approval',
  state: 'awaiting_approval',
  progress: 100,
  message: 'Awaiting approval',
  // Fixed: the store discards any replayed frame that is not strictly newer,
  // so EventSource reconnecting on a closed stub stream is a no-op.
  updatedAt: '2026-08-01T09:00:00.000Z',
})}\n\n`;

type FactRow = {
  id: string;
  subjectId: string;
  status: 'PROPOSED' | 'APPLIED' | 'DISMISSED';
  claim: string;
  rationale: string;
};

/**
 * The stub's whole state. One accept and one dismiss move rows through it
 * exactly as the real decide route would: accept writes the claim onto the
 * matrix row and flips the fact to APPLIED, dismiss flips it to DISMISSED and
 * nothing is ever re-offered.
 */
function makeLedger() {
  const facts: FactRow[] = [
    {
      id: FACT_ACCEPT,
      subjectId: ROW_ACCEPT,
      status: 'PROPOSED',
      claim: ACCEPTED_ANSWER,
      rationale: 'The bid library states this directly',
    },
    {
      id: FACT_DISMISS,
      subjectId: ROW_DISMISS,
      status: 'PROPOSED',
      claim: 'PARTIAL — support is 8x5 in the base contract',
      rationale: 'Held: amendment 2 contradicts the base document on SLA.',
    },
  ];
  const answers: Record<string, string | null> = { [ROW_ACCEPT]: null, [ROW_DISMISS]: null };
  return { facts, answers };
}

function complianceBody(ledger: ReturnType<typeof makeLedger>) {
  const items = [
    {
      id: ROW_ACCEPT,
      requirement: 'Data must reside in the EEA',
      response: ledger.answers[ROW_ACCEPT],
      status: ledger.answers[ROW_ACCEPT] ? 'compliant' : 'pending',
      autoFilled: !!ledger.answers[ROW_ACCEPT],
      aiConfidenceBps: ledger.answers[ROW_ACCEPT] ? 9100 : null,
      assessmentStatus: ledger.answers[ROW_ACCEPT] ? 'ASSESSED' : 'PENDING',
      section: 'security',
      mandatory: true,
    },
    {
      id: ROW_DISMISS,
      requirement: 'Support must be 24x7',
      response: ledger.answers[ROW_DISMISS],
      status: 'pending',
      autoFilled: false,
      aiConfidenceBps: null,
      assessmentStatus: 'PENDING',
      section: 'service',
      mandatory: false,
    },
  ];
  return {
    items,
    total: items.length,
    compliantCount: items.filter((item) => item.status === 'compliant').length,
    pendingCount: items.filter((item) => item.status === 'pending').length,
  };
}

function factBody(ledger: ReturnType<typeof makeLedger>, subjectId: string, status: string) {
  const items = ledger.facts
    .filter((fact) => fact.subjectId === subjectId && fact.status === status)
    .map((fact) => ({
      id: fact.id,
      opportunityId: OPPORTUNITY_ID,
      subjectType: 'matrix_row',
      subjectId: fact.subjectId,
      claim: fact.claim,
      verdict: fact.claim.startsWith('YES') ? 'YES' : 'PARTIAL',
      confidenceBps: fact.rationale.startsWith('Held') ? 4500 : 9100,
      band: fact.rationale.startsWith('Held') ? 'POSSIBLE' : 'VERIFIED',
      assessmentStatus: 'ASSESSED',
      rationale: fact.rationale,
      status: fact.status,
      producedByAgentKey: 'compliance-fill',
      decidedByUserId: null,
      decidedAt: fact.status === 'PROPOSED' ? null : '2026-08-01T10:00:00.000Z',
      createdAt: '2026-08-01T09:00:00.000Z',
      citations: [
        {
          id: 'e5555555-5555-4555-8555-555555555555',
          sourceChunkId: 'f6666666-6666-4666-8666-666666666666',
          quote: CITED_QUOTE,
          pageStart: 14,
          pageEnd: 14,
          documentName: DOCUMENT_NAME,
        },
      ],
    }));
  return { items, total: items.length };
}

async function stubWorkspace(page: Page) {
  const ledger = makeLedger();
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  await page.route('**/api/v1/bid-workspaces/*/rfp-latest', (route) =>
    route.fulfill(
      json({
        orchestration: {
          id: ORCHESTRATION_ID,
          state: 'awaiting_approval',
          currentPhase: 'awaiting_approval',
        },
      }),
    ),
  );

  await page.route('**/api/v1/bid-workspaces/*/rfp/*/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_FRAME }),
  );

  await page.route('**/api/v1/bid-workspaces/*/compliance', (route) =>
    route.fulfill(json(complianceBody(ledger))),
  );

  // The sibling review panels are not under test; empty payloads keep them from
  // painting error banners over the screen the spec is about.
  await page.route('**/api/v1/bid-workspaces/*/requirements', (route) =>
    route.fulfill(json({ items: [], total: 0 })),
  );
  await page.route('**/api/v1/bid-workspaces/*/story-matches', (route) =>
    route.fulfill(json({ items: [], total: 0 })),
  );
  await page.route('**/api/v1/bid-workspaces/*/draft', (route) =>
    route.fulfill(json({ proposalId: null, sections: [] })),
  );
  await page.route('**/api/v1/bid-workspaces/*/crew-layout', (route) =>
    route.fulfill(json({ layout: null })),
  );

  await page.route('**/api/v1/bid-facts?*', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill(
      json(
        factBody(
          ledger,
          url.searchParams.get('subjectId') ?? '',
          url.searchParams.get('status') ?? 'PROPOSED',
        ),
      ),
    );
  });

  await page.route('**/api/v1/bid-facts/*/decide', async (route) => {
    const factId = new URL(route.request().url()).pathname.split('/').slice(-2)[0];
    const decision = (route.request().postDataJSON() as { decision: string }).decision;
    const target = ledger.facts.find((fact) => fact.id === factId);
    if (target) {
      target.status = decision === 'accept' ? 'APPLIED' : 'DISMISSED';
      // An accept writes through to the matrix row, exactly as the real
      // transaction does (bid-facts.ts: complianceMatrixRow.updateMany).
      if (decision === 'accept') ledger.answers[target.subjectId] = target.claim;
    }
    return route.fulfill(
      json({
        id: factId,
        status: decision === 'accept' ? 'APPLIED' : 'DISMISSED',
        decidedAt: '2026-08-01T10:00:00.000Z',
        decidedByUserId: '9a777777-7777-4777-8777-777777777777',
        decisionId: '8b888888-8888-4888-8888-888888888888',
        matrixRowUpdated: decision === 'accept',
        supersededFactIds: [],
      }),
    );
  });
}

const PIPELINE_URL = `/rfp/${OPPORTUNITY_ID}/pipeline`;

test.describe('Compliance matrix — the proposed-answers strip', () => {
  test('propose → accept → provenance → dismiss → gone after reload', async ({
    page,
    gotoAndWait,
  }) => {
    await stubWorkspace(page);
    await gotoAndWait(PIPELINE_URL);

    // 1. PROPOSE — both rows arrive with a live proposal under them.
    const strips = page.locator('[data-slot="agent-suggestion"]');
    await expect(strips).toHaveCount(2, { timeout: 20_000 });
    // Scoped to the strip: the same claim also appears in the collapsed
    // "what the agent did" ledger below the table, which is the point of that
    // panel — but it would make a bare getByText ambiguous.
    await expect(strips.first()).toContainText(ACCEPTED_ANSWER);

    // The held one is amber and says so — disagreement is not low confidence.
    const held = page.locator('[data-slot="agent-suggestion"][data-held="true"]');
    await expect(held).toHaveCount(1);

    // 2. ACCEPT — the strip collapses and the answer takes the row's value slot,
    //    with the dotted underline that says "there is a receipt".
    const acceptButtons = page.getByRole('button', { name: /accept the proposed answer/i });
    await acceptButtons.first().click();
    await expect(strips).toHaveCount(1, { timeout: 20_000 });

    const sourced = page.locator('td .underline.decoration-dotted', {
      hasText: 'EU datacentres',
    });
    await expect(sourced).toBeVisible({ timeout: 20_000 });

    // 3. PROVENANCE — hovering the answer shows the claim, the quote, the page
    //    range and the document it came from.
    await sourced.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible({ timeout: 10_000 });
    await expect(tooltip).toContainText(CITED_QUOTE);
    await expect(tooltip).toContainText(DOCUMENT_NAME);
    await expect(tooltip).toContainText('14');

    // 4. DISMISS — the remaining strip disappears.
    await page.getByRole('button', { name: /dismiss the proposed answer/i }).click();
    await expect(strips).toHaveCount(0, { timeout: 20_000 });

    // 5. RELOAD — the dismissal is permanent (the valueHash guarantees the same
    //    value is never re-offered), and the accepted answer is still sourced.
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible' });
    await expect(page.getByText('Data must reside in the EEA')).toBeVisible({ timeout: 20_000 });
    await expect(strips).toHaveCount(0);
    await expect(
      page.locator('td .underline.decoration-dotted', { hasText: 'EU datacentres' }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('the matrix round-trips its filters through the URL', async ({ page, gotoAndWait }) => {
    await stubWorkspace(page);
    await gotoAndWait(`${PIPELINE_URL}?status=pending&section=service`);

    await expect(page.getByText('Support must be 24x7')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Data must reside in the EEA')).toHaveCount(0);
  });
});
