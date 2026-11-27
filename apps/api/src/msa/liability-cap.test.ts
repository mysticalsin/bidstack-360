import Fastify, { type FastifyError } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { MsaLiabilityCap } from '@bidstack/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { liabilityCapForRead, liabilityFields } from './liability-cap.js';

// Same split as plugins/error-handler.ts: a status under 500 is the route's
// own refusal. A thrown cast, or a detail body that fails MsaLiabilityCap,
// has no 4xx status and is a 500.
const CapResponse = z.object({ liabilityCap: MsaLiabilityCap.nullable() });

// A 16-digit amount is the longest the extractor accepts, then it multiplies
// by 1e6. That product is past the safe integer max and past int8.
const EXTRACTED_OVER_MAX = Math.round(Number('9999999999999999') * 1_000_000);

const BAD_WRITES = [
  ['a negative cap', { amountMicros: -1_500_000, currency: 'EUR' }],
  ['a euro-symbol amount', { amountMicros: '€500000', currency: 'EUR' }],
  ['a euro-symbol currency', { amountMicros: 500_000_000, currency: '€' }],
  ['an over-max cap', { amountMicros: Number.MAX_SAFE_INTEGER + 1, currency: 'EUR' }],
  ['an extracted over-max cap', { amountMicros: EXTRACTED_OVER_MAX, currency: 'EUR' }],
] as const;

function capApp() {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ statusCode: err.statusCode, message: err.message });
    }
    return reply.status(500).send({ statusCode: 500, message: 'Something went wrong' });
  });
  return app;
}

async function writeStatus(cap: unknown) {
  const app = capApp();
  app.post('/cap', { schema: { response: { 200: CapResponse } } }, async () => {
    const cols = liabilityFields(cap);
    const liabilityCap =
      cols.liabilityCapMicros != null && cols.liabilityCapCurrency
        ? { amountMicros: Number(cols.liabilityCapMicros), currency: cols.liabilityCapCurrency }
        : null;
    return { liabilityCap };
  });
  const res = await app.inject({ method: 'POST', url: '/cap', payload: {} });
  await app.close();
  return res;
}

async function readStatus(micros: bigint | null, currency: string | null) {
  const app = capApp();
  app.get('/cap', { schema: { response: { 200: CapResponse } } }, async () => ({
    liabilityCap: liabilityCapForRead(micros, currency),
  }));
  const res = await app.inject({ method: 'GET', url: '/cap' });
  await app.close();
  return res;
}

describe('liability cap input', () => {
  it('leaves a patch that omits the cap unchanged', () => {
    // An omitted field is not a clear. Confirm uses null for "no cap".
    expect(liabilityFields(undefined)).toEqual({});
  });

  it('clears the cap when the caller sends null', async () => {
    const res = await writeStatus(null);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ liabilityCap: null });
  });

  it('keeps a non-negative cap inside the safe integer max', async () => {
    const res = await writeStatus({ amountMicros: 2_000_000_000_000, currency: 'EUR' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      liabilityCap: { amountMicros: 2_000_000_000_000, currency: 'EUR' },
    });
  });

  it.each(BAD_WRITES)('returns 400 for %s', async (_label, cap) => {
    // WHY: these values pass BigInt (or throw inside it) and then fail the
    // detail schema or overflow int8. That is a 500. The write has to refuse
    // them before either happens.
    const res = await writeStatus(cap);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400 });
  });

  it('returns a stored cap that still fits the detail schema', async () => {
    const res = await readStatus(2_000_000_000_000n, 'EUR');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      liabilityCap: { amountMicros: 2_000_000_000_000, currency: 'EUR' },
    });
  });

  it.each([
    ['negative', -1_500_000n, 'EUR'],
    ['a euro symbol', 500_000_000n, '€'],
    ['over the safe integer max', BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'EUR'],
  ] as const)('still loads the agreement when the stored cap is %s', async (_label, micros, currency) => {
    // WHY: a cap that was stored before the write check must not take the
    // agreement page down. The unreadable cap is omitted. The page is 200.
    const res = await readStatus(micros, currency);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ liabilityCap: null });
  });
});
