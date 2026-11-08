import { describe, expect, it } from 'vitest';

import { createConcurrencyGate, gateSizeFromEnv } from './concurrency-gate.js';

describe('createConcurrencyGate', () => {
  it('admits up to max and refuses the rest without waiting', () => {
    const gate = createConcurrencyGate(2);
    const a = gate.tryAcquire();
    const b = gate.tryAcquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
    expect(gate.inFlight()).toBe(2);
    a!();
    expect(gate.tryAcquire()).not.toBeNull();
  });

  it('release is idempotent so a double close cannot over-free slots', () => {
    const gate = createConcurrencyGate(1);
    const release = gate.tryAcquire()!;
    release();
    release();
    expect(gate.inFlight()).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
  });

  it('rejects a nonsensical size', () => {
    expect(() => createConcurrencyGate(0)).toThrow();
  });

  it('reads the size from env with a fallback', () => {
    expect(gateSizeFromEnv('X', 4, { X: '8' })).toBe(8);
    expect(gateSizeFromEnv('X', 4, { X: 'many' })).toBe(4);
    expect(gateSizeFromEnv('X', 4, {})).toBe(4);
  });
});
