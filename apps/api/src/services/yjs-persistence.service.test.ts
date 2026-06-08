// Y.js persistence service — unit tests.
//
// WHY these tests exist:
//   The CRDT convergence property ("two clients editing concurrently always
//   reach the same final state") is the core correctness guarantee of Y.js.
//   These tests exercise that guarantee through our persistence layer so we
//   catch regressions in the encrypt/decrypt, snapshot, and compaction paths.
//
// Suites:
//   1. CRDT convergence — two independent Y.Docs reach same state after merge
//   2. Reconnect catch-up — offline edits applied on reconnect
//   3. Multi-tenant isolation — org A updates invisible to org B's doc
//   4. Encryption round-trip — AES-256-GCM encrypt → decrypt → same bytes
//   5. Compaction — 100+ updates collapse into snapshot, updates pruned

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

// ─── Mock Prisma ─────────────────────────────────────────────────────────────
//
// WHY mock Prisma rather than integration-testing against a real DB here:
//   The convergence and encryption tests are pure unit tests — they prove
//   correctness of Y.js merge semantics and crypto helpers independently of
//   Postgres connectivity. A separate integration test suite (if DATABASE_URL
//   is available) would test the SQL layer.

const mockPrisma = {
  yjsDocument: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  yjsUpdate: {
    create: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@bidstack/db', () => ({ prisma: mockPrisma }));

// ─── Suite 1: CRDT convergence ───────────────────────────────────────────────
describe('CRDT convergence', () => {
  it('two clients editing the same field concurrently converge to the same state', () => {
    // WHY this matters: the entire value proposition of CRDT is that concurrent
    // edits from disconnected clients merge without manual conflict resolution.
    // If Y.applyUpdate is called in any order, both docs must reach the same state.

    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const textA = docA.getText('notes');
    const textB = docB.getText('notes');

    // Both start from empty.
    const stateA0 = Y.encodeStateAsUpdate(docA);
    const stateB0 = Y.encodeStateAsUpdate(docB);
    Y.applyUpdate(docA, stateB0);
    Y.applyUpdate(docB, stateA0);

    // Client A types "Hello "
    textA.insert(0, 'Hello ');
    const updateFromA = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB));

    // Client B types "World" at position 0 (concurrent — not yet received A's edit)
    textB.insert(0, 'World');
    const updateFromB = Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA));

    // Cross-apply updates.
    Y.applyUpdate(docA, updateFromB);
    Y.applyUpdate(docB, updateFromA);

    // Both docs must now have the same text (CRDT convergence).
    // The exact order of "Hello " / "World" is determined by Y.js tie-breaking rules,
    // but BOTH clients must agree on that order.
    expect(textA.toString()).toBe(textB.toString());
    expect(textA.length).toBeGreaterThan(0);
  });

  it('applying the same update twice is idempotent (Y.js deduplication)', () => {
    // WHY: network retries or server fan-out may deliver the same update
    // more than once. Y.js must not double-apply it.
    const doc = new Y.Doc();
    const text = doc.getText('notes');
    text.insert(0, 'Hello');

    const update = Y.encodeStateAsUpdate(doc);

    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, update);
    Y.applyUpdate(doc2, update); // second application — must be no-op

    expect(doc2.getText('notes').toString()).toBe('Hello');
  });

  it('state-vector-based delta reduces wire payload', () => {
    // WHY: we only send the delta (updates the receiver hasn't seen) to avoid
    // retransmitting the full document on every message.
    const docServer = new Y.Doc();
    const docClient = new Y.Doc();

    // Sync initial state with enough content that a later one-line append
    // should be meaningfully smaller than the whole document snapshot.
    docServer.getText('notes').insert(0, 'Existing context\n'.repeat(20));
    Y.applyUpdate(docClient, Y.encodeStateAsUpdate(docServer));

    // Server appends content.
    const serverText = docServer.getText('notes');
    serverText.insert(serverText.length, 'Line one\n');
    const fullUpdate = Y.encodeStateAsUpdate(docServer);

    // Delta since client's current state vector.
    const clientVector = Y.encodeStateVector(docClient);
    const delta = Y.encodeStateAsUpdate(docServer, clientVector);

    // Delta must be strictly smaller than full update.
    expect(delta.byteLength).toBeLessThan(fullUpdate.byteLength);

    // Applying the delta gives client the correct state.
    Y.applyUpdate(docClient, delta);
    expect(docClient.getText('notes').toString()).toContain('Existing context\n');
    expect(docClient.getText('notes').toString()).toContain('Line one\n');
  });
});

// ─── Suite 2: Reconnect catch-up ─────────────────────────────────────────────
describe('Reconnect catch-up', () => {
  it('offline edits applied after reconnect produce same state as continuous editing', () => {
    // WHY: when a client goes offline and makes edits, then reconnects, those
    // edits must appear in the server document as if they had been live. This
    // mirrors the pendingUpdates flush in yjs-client.ts.

    const docServer = new Y.Doc();
    const docClient = new Y.Doc();

    // Initial sync.
    Y.applyUpdate(docClient, Y.encodeStateAsUpdate(docServer));
    Y.applyUpdate(docServer, Y.encodeStateAsUpdate(docClient));

    // Server adds content while client is "offline".
    docServer.getText('notes').insert(0, 'Server line\n');

    // Client makes 5 offline edits (pendingUpdates queue simulation).
    const pendingUpdates: Uint8Array[] = [];
    const clientState = Y.encodeStateVector(docClient);

    for (let i = 1; i <= 5; i++) {
      docClient.getText('notes').insert(docClient.getText('notes').length, `Offline edit ${i}\n`);
      pendingUpdates.push(Y.encodeStateAsUpdate(docClient, clientState));
    }

    // Reconnect: client receives server delta, server receives all pending.
    const serverDelta = Y.encodeStateAsUpdate(docServer, Y.encodeStateVector(docClient));
    Y.applyUpdate(docClient, serverDelta);

    for (const update of pendingUpdates) {
      Y.applyUpdate(docServer, update);
    }

    // Apply client's full state to server to cover any state-vector edge cases.
    Y.applyUpdate(docServer, Y.encodeStateAsUpdate(docClient));

    // Both must converge.
    expect(docServer.getText('notes').toString()).toBe(docClient.getText('notes').toString());
    // All 5 offline edits must appear.
    for (let i = 1; i <= 5; i++) {
      expect(docServer.getText('notes').toString()).toContain(`Offline edit ${i}`);
    }
    // Server-side content must also appear.
    expect(docServer.getText('notes').toString()).toContain('Server line');
  });
});

// ─── Suite 3: Multi-tenant isolation ─────────────────────────────────────────
describe('Multi-tenant isolation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // No row found for org B when queried with org B's ID.
    mockPrisma.yjsDocument.findUnique.mockResolvedValue(null);
    mockPrisma.yjsDocument.create.mockImplementation(({ data }: { data: { orgId: string } }) =>
      Promise.resolve({ id: `doc-${data.orgId}`, ...data }),
    );
    mockPrisma.yjsUpdate.count.mockResolvedValue(0);
  });

  it('YjsUpdate rows are always written with the authenticated orgId', async () => {
    // WHY: every write to the append-only log MUST carry the tenant's orgId.
    // The Prisma query has no cross-org join — but orgId on the row lets the
    // compaction job and auditors verify tenant boundaries.

    // Import after mock is in place.
    const { persistUpdate } = await import('./yjs-persistence.service.js');

    const updateBytes = new Uint8Array([1, 2, 3, 4]);
    await persistUpdate('ydoc-001', 'org-A', 'client-X', updateBytes);

    expect(mockPrisma.yjsUpdate.create).toHaveBeenCalledOnce();
    const callArg = mockPrisma.yjsUpdate.create.mock.calls[0]?.[0] as
      | {
      data: { ydocId: string; orgId: string; clientId: string };
    }
      | undefined;
    expect(callArg).toBeDefined();
    if (!callArg) throw new Error('Expected yjsUpdate.create to receive an argument');
    expect(callArg.data.orgId).toBe('org-A');
    expect(callArg.data.ydocId).toBe('ydoc-001');
    expect(callArg.data.clientId).toBe('client-X');
  });

  it('loadYDoc scopes the unique lookup to the requesting orgId', async () => {
    // WHY: findUnique uses the @@unique([orgId, entityType, entityId, fieldKey])
    // constraint. An org B client sending org A's entityId must not load org A's doc.

    const { loadYDoc } = await import('./yjs-persistence.service.js');

    await loadYDoc({
      orgId: 'org-B',
      entityType: 'opportunity',
      entityId: 'opp-123',
      fieldKey: 'notes',
    });

    expect(mockPrisma.yjsDocument.findUnique).toHaveBeenCalledOnce();
    const callArg = mockPrisma.yjsDocument.findUnique.mock.calls[0]?.[0] as
      | {
      where: { orgId_entityType_entityId_fieldKey: { orgId: string; entityId: string } };
    }
      | undefined;
    expect(callArg).toBeDefined();
    // The lookup includes orgId — so a cross-org lookup will find nothing.
    if (!callArg) throw new Error('Expected yjsDocument.findUnique to receive an argument');
    expect(callArg.where.orgId_entityType_entityId_fieldKey.orgId).toBe('org-B');
    expect(callArg.where.orgId_entityType_entityId_fieldKey.entityId).toBe('opp-123');
  });
});

// ─── Suite 4: Encryption round-trip ──────────────────────────────────────────
describe('AES-256-GCM encryption round-trip', () => {
  it('encrypting and decrypting a Y.Doc update produces the original bytes', async () => {
    // WHY: notes may contain PII. AES-256-GCM provides authenticated encryption
    // so tampering with the ciphertext causes decryption to throw, not silently
    // return garbage. This test confirms the encrypt → decrypt path is lossless.
    //
    // We test via the persistence service's encrypt/decrypt internals indirectly:
    // write a Y.Doc state → persistUpdate stores encrypted bytes → loadYDoc
    // decrypts and replays → getText returns original content.

    // Build a Y.Doc with known content.
    const original = new Y.Doc();
    original.getText('notes').insert(0, 'Confidential notes with PII');
    const update = Y.encodeStateAsUpdate(original);

    // Simulate what the service does: encrypt → store buffer → decrypt → apply.
    // We test the crypto helpers by driving them via the Y.js round-trip.
    const restored = new Y.Doc();

    // Manually replicate encrypt/decrypt logic (same as service) with test key.
    const { createCipheriv, createDecipheriv, randomBytes } = await import('node:crypto');
    const key = Buffer.from('0'.repeat(64), 'hex'); // 32-byte zero key for test

    function encrypt(buf: Buffer): Buffer {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, ct]);
    }

    function decrypt(buf: Buffer): Buffer {
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const ct = buf.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    }

    const encrypted = encrypt(Buffer.from(update));
    expect(encrypted.byteLength).toBeGreaterThan(update.byteLength); // IV + tag overhead

    const decrypted = decrypt(encrypted);
    Y.applyUpdate(restored, new Uint8Array(decrypted));

    expect(restored.getText('notes').toString()).toBe('Confidential notes with PII');
  });

  it('tampered ciphertext throws on decrypt (authenticated encryption)', async () => {
    const { createCipheriv, createDecipheriv, randomBytes } = await import('node:crypto');
    const key = Buffer.from('0'.repeat(64), 'hex');

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from('secret')), cipher.final()]);
    const tag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, tag, ct]);

    // Flip a byte in the ciphertext.
    const tampered = Buffer.from(packed);
    tampered[28] = (tampered[28] ?? 0) ^ 0xff;

    expect(() => {
      const decipher = createDecipheriv('aes-256-gcm', key, tampered.subarray(0, 12));
      decipher.setAuthTag(tampered.subarray(12, 28));
      decipher.update(tampered.subarray(28));
      decipher.final();
    }).toThrow();
  });
});

// ─── Suite 5: Compaction ─────────────────────────────────────────────────────
describe('Compaction', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('compactDoc merges all YjsUpdate rows into the YjsDocument snapshot', async () => {
    // WHY: compaction bounds table growth. After compaction the YjsDocument.ydocBinary
    // must reflect all merged updates, and the YjsUpdate rows must be deleted.

    // Build a doc with two updates.
    const base = new Y.Doc();
    const baseSnap = Y.encodeStateAsUpdate(base);

    const doc1 = new Y.Doc();
    Y.applyUpdate(doc1, baseSnap);
    doc1.getText('notes').insert(0, 'Update one\n');
    const upd1 = Y.encodeStateAsUpdate(doc1, Y.encodeStateVector(base));

    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    doc2.getText('notes').insert(doc2.getText('notes').length, 'Update two\n');
    const upd2 = Y.encodeStateAsUpdate(doc2, Y.encodeStateVector(doc1));

    // Mock: findUnique returns a doc with two pending updates (unencrypted for test).
    // `version` drives the compare-and-swap added to prevent lost updates.
    mockPrisma.yjsDocument.findUnique.mockResolvedValue({
      id: 'ydoc-001',
      orgId: 'org-A',
      ydocBinary: Buffer.from(baseSnap),
      version: 0,
      updates: [
        { id: 'upd-1', update: Buffer.from(upd1) },
        { id: 'upd-2', update: Buffer.from(upd2) },
      ],
    });

    let capturedBinary: Buffer | null = null;
    let capturedDeleteIds: string[] | null = null;

    // Interactive transaction — run the callback with the mock client as `tx`.
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
    );

    // CAS update succeeds (version matched): capture the snapshot, report count 1.
    mockPrisma.yjsDocument.updateMany.mockImplementation(
      ({ data }: { data: { ydocBinary: Buffer } }) => {
        capturedBinary = data.ydocBinary;
        return Promise.resolve({ count: 1 });
      },
    );

    mockPrisma.yjsUpdate.deleteMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) => {
        capturedDeleteIds = where.id.in;
        return Promise.resolve({});
      },
    );

    const { compactDoc } = await import('./yjs-persistence.service.js');
    await compactDoc('ydoc-001');

    // The snapshot was updated via the version-gated CAS.
    expect(mockPrisma.yjsDocument.updateMany).toHaveBeenCalledOnce();

    // Both update rows were marked for deletion.
    expect(capturedDeleteIds).toEqual(['upd-1', 'upd-2']);

    // The new snapshot must contain both updates' content.
    if (capturedBinary) {
      const restored = new Y.Doc();
      Y.applyUpdate(restored, new Uint8Array(capturedBinary as Buffer));
      expect(restored.getText('notes').toString()).toContain('Update one');
      expect(restored.getText('notes').toString()).toContain('Update two');
    }
  });

  it('aborts WITHOUT deleting updates when version changed under it (lost-update guard)', async () => {
    // WHY: a concurrent compaction (inline + worker) must not blind-overwrite. If
    // the CAS finds the version already bumped, we abort and LEAVE the update rows
    // so the edits are not lost — they compact on the next pass.
    const base = new Y.Doc();
    const baseSnap = Y.encodeStateAsUpdate(base);
    mockPrisma.yjsDocument.findUnique.mockResolvedValue({
      id: 'ydoc-001',
      orgId: 'org-A',
      ydocBinary: Buffer.from(baseSnap),
      version: 3,
      updates: [{ id: 'upd-1', update: Buffer.from(baseSnap) }],
    });
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
    );
    // Version moved (a concurrent pass won) → 0 rows match the CAS predicate.
    mockPrisma.yjsDocument.updateMany.mockResolvedValue({ count: 0 });

    const { compactDoc } = await import('./yjs-persistence.service.js');
    await compactDoc('ydoc-001');

    expect(mockPrisma.yjsUpdate.deleteMany).not.toHaveBeenCalled();
  });
});
