// The run route starts runJarvisLoop without awaiting it. A Redis outage on
// the final saveRun used to reject that promise, and main.ts exits the process
// on any unhandled rejection: one bad run took the whole API down.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./jarvis.store.js', () => ({
  saveRun: vi.fn(async () => {
    throw new Error('Redis connection lost');
  }),
  stageAction: vi.fn(),
}));

import { __setJarvisLlmForTest, runJarvisLoop } from './jarvis.loop.js';
import type { JarvisRunView } from './jarvis.types.js';

afterEach(() => __setJarvisLlmForTest(null));

describe('runJarvisLoop', () => {
  it('settles and logs when the final run state cannot be saved', async () => {
    __setJarvisLlmForTest(async () => JSON.stringify({ type: 'answer', text: 'Nothing to do.' }));
    const error = vi.fn();
    const log = { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
    const view: JarvisRunView = {
      runId: '11111111-1111-4111-8111-111111111111',
      status: 'running',
      mode: 'demo',
      steps: [],
      answer: null,
      pendingActions: [],
    };
    await expect(
      runJarvisLoop(
        {
          runId: view.runId,
          orgId: '22222222-2222-4222-8222-222222222222',
          userId: '33333333-3333-4333-8333-333333333333',
          message: 'hello',
          context: {},
          log,
        },
        view,
      ),
    ).resolves.toBeUndefined();
    expect(view.status).toBe('done');
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ runId: view.runId }), expect.any(String));
  });
});
