// Penetration tests — SEC-1: demo session takeover
//
// `POST /demo/session` is a PUBLIC, passwordless door. The original finding:
// it used to hand a signed admin session to anyone who typed an email that had
// already been used for the demo, so a guessed address = full access to that
// visitor's workspace (including their uploaded RFP documents).
//
// The contract under test (availability-hardened, 2026-08-08): a claimed email
// WITHOUT its resume proof is never refused outright — the email is released
// from the old visitor (tombstone alias) and a FRESH workspace is seeded. The
// takeover invariant is unchanged and is the point of this suite:
//
//   - no proof / forged proof / someone else's proof NEVER yields the victim's
//     org — the caller lands in a brand-new workspace
//   - the release path renames the victim's user to an alias (their token-only
//     access survives; the response never leaks their ids)
//   - the legitimate owner (valid or merely expired own token) still resumes
//     their OWN workspace, and no release happens
//   - a provisioning race (P2002) without proof is refused, not reclaimed —
//     otherwise two racers could rename ping-pong forever
//
// DB-free by design: the demo provisioning path is mocked so this suite runs in
// CI without Postgres — the takeover assertions must never silently skip.

import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma, prisma, seedOrgData } from '@bidstack/db';

import { signDemoToken, verifyDemoToken } from '../plugins/demo-auth.js';
import { demoRoutes } from '../routes/demo.js';

vi.mock('@bidstack/db', () => ({
  prisma: {
    user: { findFirst: vi.fn(), update: vi.fn() },
    org: { deleteMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
  seedOrgData: vi.fn(),
  // Only the shape `provisionDemoSession` narrows on (P2002 race handling).
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {
      code = 'P2002';
    },
  },
}));

// The enrich queue opens a BullMQ/Redis connection at import time.
vi.mock('../queues/company-enrich-apollo.js', () => ({
  enqueueApolloEnrich: vi.fn(),
}));

const DEMO_SECRET = 'pentest-demo-session-secret';
const VICTIM = { id: 'victim-user-id', orgId: 'victim-org-id' };
const VICTIM_EMAIL = 'victim@prospect.example';
const FRESH = { id: 'fresh-user-id', orgId: 'fresh-org-id' };

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ORIGINAL_DEMO_SECRET = process.env.DEMO_SESSION_SECRET;

const mockedUserFindFirst = vi.mocked(prisma.user.findFirst);
const mockedUserUpdate = vi.mocked(prisma.user.update);
const mockedOrgCount = vi.mocked(prisma.org.count);
const mockedTransaction = vi.mocked(prisma.$transaction);
const mockedSeedOrgData = vi.mocked(seedOrgData);

let app: FastifyInstance;

/** Sign a token the API never issued (correct format, attacker's key). */
function forgeToken(userId: string, orgId: string, secret: string, expOffsetSeconds = 3600): string {
  const body = Buffer.from(
    JSON.stringify({ u: userId, o: orgId, exp: Math.floor(Date.now() / 1000) + expOffsetSeconds }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `demo_${body}.${sig}`;
}

async function postSession(email: string, bearer?: string) {
  return app.inject({
    method: 'POST',
    url: '/demo/session',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    payload: { email },
  });
}

/**
 * The email already belongs to a provisioned demo visitor, and (for the
 * no-proof paths) the release-then-reprovision flow succeeds: first lookup
 * finds the victim, the seed transaction creates a fresh org, the final lookup
 * returns the freshly seeded user.
 */
function emailIsClaimedAndReleasable(): void {
  mockedUserFindFirst
    .mockResolvedValueOnce(VICTIM as never)
    .mockResolvedValueOnce({ id: FRESH.id } as never);
  mockedUserUpdate.mockResolvedValue({} as never);
  const tx = { org: { create: async () => ({ id: FRESH.orgId }) } };
  mockedTransaction.mockImplementation(
    (async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never,
  );
}

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  process.env.DEMO_SESSION_SECRET = DEMO_SECRET;

  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(demoRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  if (ORIGINAL_DEMO_SECRET === undefined) delete process.env.DEMO_SESSION_SECRET;
  else process.env.DEMO_SESSION_SECRET = ORIGINAL_DEMO_SECRET;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedOrgCount.mockResolvedValue(0 as never);
});

describe('penetration: demo session takeover (SEC-1)', () => {
  it('a claimed email with no proof lands in a FRESH workspace, never the victim one', async () => {
    emailIsClaimedAndReleasable();

    const res = await postSession(VICTIM_EMAIL);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orgId).toBe(FRESH.orgId);
    expect(body.orgId).not.toBe(VICTIM.orgId);
    expect(verifyDemoToken(body.token)).toMatchObject({ u: FRESH.id, o: FRESH.orgId });
    // The victim's claim on the email is released via tombstone alias...
    expect(mockedUserUpdate).toHaveBeenCalledTimes(1);
    const renameArgs = mockedUserUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { email: string };
    };
    expect(renameArgs.where.id).toBe(VICTIM.id);
    expect(renameArgs.data.email).not.toBe(VICTIM_EMAIL);
    expect(renameArgs.data.email).toContain('+reclaimed-');
    // ...and a fresh org is actually seeded.
    expect(mockedSeedOrgData).toHaveBeenCalledTimes(1);
  });

  it('a forged proof signed with an attacker key gets the fresh workspace, not the victim one', async () => {
    emailIsClaimedAndReleasable();

    const res = await postSession(
      VICTIM_EMAIL,
      forgeToken(VICTIM.id, VICTIM.orgId, 'attacker-secret'),
    );

    expect(res.statusCode).toBe(200);
    expect(res.json().orgId).toBe(FRESH.orgId);
  });

  it('a validly-signed proof issued for a different visitor cannot pivot into the victim org', async () => {
    emailIsClaimedAndReleasable();

    // The attacker holds a real demo session — their own. It must not pivot.
    const ownSession = signDemoToken('attacker-user-id', 'attacker-org-id');
    const res = await postSession(VICTIM_EMAIL, ownSession);

    expect(res.statusCode).toBe(200);
    expect(res.json().orgId).toBe(FRESH.orgId);
  });

  it('a proof carrying the victim org but a foreign user id cannot pivot either', async () => {
    emailIsClaimedAndReleasable();

    const res = await postSession(VICTIM_EMAIL, signDemoToken('attacker-user-id', VICTIM.orgId));

    expect(res.statusCode).toBe(200);
    expect(res.json().orgId).toBe(FRESH.orgId);
  });

  it('never leaks the previous workspace owner in the response', async () => {
    emailIsClaimedAndReleasable();

    const res = await postSession(VICTIM_EMAIL);

    expect(res.body).not.toContain(VICTIM.orgId);
    expect(res.body).not.toContain(VICTIM.id);
  });

  it('a provisioning race (P2002) without proof is refused, not reclaimed', async () => {
    // First lookup: unclaimed. The seed then loses the User.email unique race,
    // and the post-race lookup finds the winner's visitor.
    mockedUserFindFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(VICTIM as never);
    // Must be the SAME class provisionDemoSession narrows on (the module mock's).
    mockedTransaction.mockRejectedValue(
      new (Prisma.PrismaClientKnownRequestError as unknown as new (msg: string) => Error)(
        'unique violation',
      ),
    );

    const res = await postSession(VICTIM_EMAIL);

    expect(res.statusCode).toBe(409);
    expect(res.json().token).toBeUndefined();
    // The race loser must not rename the winner's user out from under them.
    expect(mockedUserUpdate).not.toHaveBeenCalled();
  });
});

describe('demo session: legitimate flows still work', () => {
  it('resumes the visitor holding their own valid token — no release happens', async () => {
    mockedUserFindFirst.mockResolvedValue(VICTIM as never);

    const res = await postSession(VICTIM_EMAIL, signDemoToken(VICTIM.id, VICTIM.orgId));

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orgId).toBe(VICTIM.orgId);
    expect(verifyDemoToken(body.token)).toMatchObject({ u: VICTIM.id, o: VICTIM.orgId });
    expect(mockedUserUpdate).not.toHaveBeenCalled();
    expect(mockedSeedOrgData).not.toHaveBeenCalled();
  });

  it('resumes the visitor whose own token has expired (session TTL < org TTL)', async () => {
    mockedUserFindFirst.mockResolvedValue(VICTIM as never);

    // Expired but signed by us — still proof the caller once held the session.
    const expired = forgeToken(VICTIM.id, VICTIM.orgId, DEMO_SECRET, -60);
    const res = await postSession(VICTIM_EMAIL, expired);

    expect(res.statusCode).toBe(200);
    expect(res.json().orgId).toBe(VICTIM.orgId);
    expect(mockedUserUpdate).not.toHaveBeenCalled();
  });

  it('provisions a fresh seeded workspace for an unclaimed email', async () => {
    // 1st lookup: no existing demo visitor. 2nd: the user created by the seed.
    mockedUserFindFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: FRESH.id } as never);
    const tx = { org: { create: async () => ({ id: FRESH.orgId }) } };
    mockedTransaction.mockImplementation(
      (async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never,
    );

    const res = await postSession('brand-new@prospect.example');

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orgId).toBe(FRESH.orgId);
    expect(verifyDemoToken(body.token)).toMatchObject({ u: FRESH.id, o: FRESH.orgId });
    expect(mockedSeedOrgData).toHaveBeenCalledTimes(1);
    expect(mockedTransaction).toHaveBeenCalledTimes(1);
  });
});
