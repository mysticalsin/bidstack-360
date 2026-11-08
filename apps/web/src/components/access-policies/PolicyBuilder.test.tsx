import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccessPolicyRule } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars?.[n] ?? '')),
  }),
}));

import { PolicyBuilder } from './PolicyBuilder';

const OPTIONS = { roles: ['Admin', 'Sales Manager'], teams: ['France', 'Spain'] };

function rule(id: string, partial: Partial<AccessPolicyRule> = {}): AccessPolicyRule {
  return {
    id,
    effect: 'deny',
    when: {},
    then: { actions: ['msa:write'], resources: ['msa'] },
    conditions: {},
    except: {},
    ...partial,
  };
}

afterEach(() => {
  cleanup();
});

describe('PolicyBuilder', () => {
  it('adds a narrowing deny rule by default', () => {
    const onChange = vi.fn();
    render(<PolicyBuilder rules={[]} onChange={onChange} options={OPTIONS} />);
    expect(screen.getByText('No rules yet. The RBAC matrix applies as is.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    const next = onChange.mock.calls[0]![0] as AccessPolicyRule[];
    expect(next).toHaveLength(1);
    expect(next[0]!.effect).toBe('deny');
  });

  it('groups each rule into When, Then, Conditions and Except and reads it back as a sentence', () => {
    render(
      <PolicyBuilder
        rules={[rule('r1', { when: { teams: ['France'] }, conditions: { countries: ['DE'] } })]}
        onChange={vi.fn()}
        options={OPTIONS}
      />,
    );
    const group = screen.getByRole('group', { name: 'Rule 1' });
    for (const legend of ['When', 'Then', 'Conditions', 'Except']) {
      expect(within(group).getByRole('group', { name: legend })).toBeTruthy();
    }
    expect(within(group).getByText('Deny msa:write on MSAs for team France, when the record country is DE.')).toBeTruthy();
  });

  it('only offers actions that fit the selected resources', () => {
    render(<PolicyBuilder rules={[rule('r1')]} onChange={vi.fn()} options={OPTIONS} />);
    const then = screen.getByRole('group', { name: 'Then' });
    expect(within(then).getByRole('checkbox', { name: 'msa:admin' })).toBeTruthy();
    expect(within(then).queryByRole('checkbox', { name: 'companies:read' })).toBeNull();
  });

  it('drops actions that no longer fit when a resource is removed', () => {
    const onChange = vi.fn();
    render(
      <PolicyBuilder
        rules={[rule('r1', { then: { actions: ['msa:write', 'companies:read'], resources: ['msa', 'companies'] } })]}
        onChange={onChange}
        options={OPTIONS}
      />,
    );
    fireEvent.click(within(screen.getByRole('group', { name: 'Then' })).getByRole('checkbox', { name: 'MSAs' }));
    const next = onChange.mock.calls[0]![0] as AccessPolicyRule[];
    expect(next[0]!.then).toEqual({ actions: ['companies:read'], resources: ['companies'] });
  });

  it('reorders rules with Move down', () => {
    const onChange = vi.fn();
    render(<PolicyBuilder rules={[rule('a'), rule('b')]} onChange={onChange} options={OPTIONS} />);
    const first = screen.getByRole('group', { name: 'Rule 1' });
    fireEvent.click(within(first).getByRole('button', { name: 'Move rule 1 down' }));
    expect((onChange.mock.calls[0]![0] as AccessPolicyRule[]).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('is read only without the write permission', () => {
    render(<PolicyBuilder rules={[rule('r1')]} onChange={vi.fn()} options={OPTIONS} readOnly />);
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
    expect((screen.getByRole('combobox', { name: 'Effect' }) as HTMLSelectElement).disabled).toBe(true);
  });
});
