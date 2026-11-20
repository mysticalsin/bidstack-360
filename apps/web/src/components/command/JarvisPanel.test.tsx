// Jarvis panel behaviour the user relies on:
// - the ask is sent with the record on screen as context ("this"),
// - each tool step shows its status in words, not colour alone,
// - the answer cites records as links,
// - a write shows the exact change and only a Confirm click sends it,
// - the mic only appears where the browser can listen,
// - the mute choice persists.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JarvisPanel } from './JarvisPanel';
import { useJarvisStore } from './jarvisStore';
import { JARVIS_MUTE_KEY } from './jarvisVoice';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => String(values[key] ?? ''));
    },
  }),
}));

const OPP = '00000000-0000-4000-8000-0000000000a1';

const hoisted = vi.hoisted(() => ({
  start: vi.fn(),
  decide: vi.fn(),
  run: undefined as unknown,
}));

vi.mock('@/hooks/useAiAssistant', () => ({
  useStartJarvisRun: () => ({ mutate: hoisted.start, isPending: false, error: null }),
  useJarvisRunStatus: () => ({ data: hoisted.run, isLoading: false, error: null }),
  useJarvisActionDecision: () => ({ mutate: hoisted.decide, isPending: false, error: null }),
}));

const RUN_WITH_WRITE = {
  runId: 'run-1',
  status: 'done',
  mode: 'demo',
  steps: [
    { id: 's1', tool: 'opportunities.get', kind: 'read', status: 'done', summary: 'OP-2048' },
    {
      id: 's2',
      tool: 'tasks.create',
      kind: 'write',
      status: 'pending',
      summary: 'Waiting for confirmation',
    },
  ],
  answer: {
    text: 'I prepared a follow-up task on OP-2048.',
    citations: [
      {
        kind: 'opportunity',
        label: 'OP-2048 DNB Bank',
        href: `/opportunities/${OPP}`,
        date: '2026-09-15',
      },
    ],
    missing: ['No owner email on record'],
  },
  pendingActions: [
    {
      id: 'act-1',
      tool: 'tasks.create',
      title: 'Create task',
      changes: [
        { field: 'Title', value: 'Follow-up' },
        { field: 'Due date', value: '2026-11-13' },
        { field: 'Opportunity', value: 'OP-2048' },
      ],
    },
  ],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <JarvisPanel />
    </MemoryRouter>,
  );
}

function ask(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask Jarvis' }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

beforeEach(() => {
  hoisted.start = vi.fn((_vars: unknown, opts?: { onSuccess?: (d: { runId: string }) => void }) =>
    opts?.onSuccess?.({ runId: 'run-1' }),
  );
  hoisted.decide = vi.fn();
  hoisted.run = undefined;
  useJarvisStore.getState().openJarvis();
});

afterEach(() => {
  cleanup();
  useJarvisStore.getState().close();
  localStorage.clear();
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

describe('JarvisPanel', () => {
  it('sends the ask with the record on screen as context', () => {
    renderAt(`/opportunities/${OPP}`);
    ask('Create a follow-up task for Friday');
    expect(hoisted.start).toHaveBeenCalledWith(
      { message: 'Create a follow-up task for Friday', context: { opportunityId: OPP } },
      expect.anything(),
    );
  });

  it('shows each step with a status in words', () => {
    hoisted.run = RUN_WITH_WRITE;
    renderAt('/dashboard');
    ask('Create a follow-up task for Friday');
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(within(steps).getByText('Read opportunity')).toBeDefined();
    expect(within(steps).getByText('Done')).toBeDefined();
    expect(within(steps).getByText('Needs confirmation')).toBeDefined();
  });

  it('cites records as links and says what is missing', () => {
    hoisted.run = RUN_WITH_WRITE;
    renderAt('/dashboard');
    ask('Create a follow-up task for Friday');
    const link = screen.getByRole('link', { name: /OP-2048 DNB Bank/ });
    expect(link.getAttribute('href')).toBe(`/opportunities/${OPP}`);
    expect(screen.getByText('No owner email on record')).toBeDefined();
  });

  it('shows the exact change and only confirms on click', () => {
    hoisted.run = RUN_WITH_WRITE;
    renderAt('/dashboard');
    ask('Create a follow-up task for Friday');
    const card = screen.getByRole('group', { name: 'Create task' });
    expect(within(card).getByText('Due date')).toBeDefined();
    expect(within(card).getByText('2026-11-13')).toBeDefined();
    expect(hoisted.decide).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
    expect(hoisted.decide).toHaveBeenCalledWith(
      { actionId: 'act-1', decision: 'confirm' },
      expect.anything(),
    );
  });

  it('cancel sends a cancel decision', () => {
    hoisted.run = RUN_WITH_WRITE;
    renderAt('/dashboard');
    ask('Create a follow-up task for Friday');
    const card = screen.getByRole('group', { name: 'Create task' });
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(hoisted.decide).toHaveBeenCalledWith(
      { actionId: 'act-1', decision: 'cancel' },
      expect.anything(),
    );
  });

  it('hides the mic when the browser cannot listen', () => {
    renderAt('/dashboard');
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Ask Jarvis' })).toBeDefined();
  });

  it('shows the mic when speech recognition exists', () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = class {};
    renderAt('/dashboard');
    expect(screen.getByRole('button', { name: 'Speak' })).toBeDefined();
  });

  it('persists the mute toggle', () => {
    renderAt('/dashboard');
    const mute = screen.getByRole('button', { name: 'Mute voice' });
    fireEvent.click(mute);
    expect(localStorage.getItem(JARVIS_MUTE_KEY)).toBe('1');
    expect(screen.getByRole('button', { name: 'Unmute voice' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
