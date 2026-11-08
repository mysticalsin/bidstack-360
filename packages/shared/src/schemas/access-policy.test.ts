import { describe, expect, it } from 'vitest';

import { PERMISSION_KEYS, type PermissionKey } from '../types/permissions.js';
import {
  ACCESS_POLICY_RESOURCES,
  ACCESS_POLICY_RESOURCE_ACTIONS,
  AccessPolicyRulesSchema,
  evaluateAccessPolicy,
  type AccessPolicyRule,
  type AccessPolicySubject,
} from './access-policy.js';

const SALES: AccessPolicySubject = { roles: ['Sales Manager'], teams: ['France'], countries: ['FR'] };
const ADMIN: AccessPolicySubject = { roles: ['Admin'], teams: [], countries: [] };
const MONDAY_10 = new Date('2026-11-09T10:00:00.000Z');
const SUNDAY_10 = new Date('2026-11-08T10:00:00.000Z');

function rule(partial: Partial<AccessPolicyRule> & Pick<AccessPolicyRule, 'effect'>): AccessPolicyRule {
  return {
    id: partial.id ?? 'r1',
    effect: partial.effect,
    when: partial.when ?? {},
    then: partial.then ?? { actions: ['companies:read'], resources: ['companies'] },
    conditions: partial.conditions ?? {},
    except: partial.except ?? {},
  };
}

const base = {
  matrixAllows: true,
  subject: SALES,
  action: 'companies:read' as PermissionKey,
  resource: { type: 'companies' as const, country: 'FR', sensitivity: 'internal' as const },
  at: MONDAY_10,
};

describe('evaluateAccessPolicy', () => {
  it('follows the matrix when no rule covers the action and resource', () => {
    expect(evaluateAccessPolicy({ ...base, rules: [] })).toEqual({ allowed: true, reason: 'no-policy', ruleId: null });
    const other = rule({ effect: 'deny', then: { actions: ['msa:read'], resources: ['msa'] } });
    expect(evaluateAccessPolicy({ ...base, rules: [other] }).allowed).toBe(true);
  });

  it('never widens access beyond the matrix, whatever the rules say', () => {
    const allowAll: AccessPolicyRule[] = ACCESS_POLICY_RESOURCES.map((r, i) =>
      rule({ id: `a${i}`, effect: 'allow', then: { actions: [...ACCESS_POLICY_RESOURCE_ACTIONS[r]], resources: [r] } }),
    );
    for (const resource of ACCESS_POLICY_RESOURCES) {
      for (const action of PERMISSION_KEYS) {
        const decision = evaluateAccessPolicy({
          ...base,
          rules: allowAll,
          matrixAllows: false,
          action,
          resource: { type: resource },
        });
        expect(decision, `${action} on ${resource}`).toEqual({ allowed: false, reason: 'matrix-deny', ruleId: null });
      }
    }
  });

  it('denies when a matching deny rule exists, even if an allow rule also matches', () => {
    const rules = [
      rule({ id: 'allow-all', effect: 'allow' }),
      rule({ id: 'no-fr', effect: 'deny', when: { countries: ['FR'] } }),
    ];
    expect(evaluateAccessPolicy({ ...base, rules })).toEqual({ allowed: false, reason: 'rule-deny', ruleId: 'no-fr' });
  });

  it('default-denies when allow rules cover the action but none matches the subject', () => {
    const rules = [rule({ id: 'admins', effect: 'allow', when: { roles: ['Admin'] } })];
    expect(evaluateAccessPolicy({ ...base, rules })).toEqual({ allowed: false, reason: 'default-deny', ruleId: null });
    expect(evaluateAccessPolicy({ ...base, rules, subject: ADMIN })).toEqual({
      allowed: true,
      reason: 'rule-allow',
      ruleId: 'admins',
    });
  });

  it('lets an except clause exempt a subject from a deny rule', () => {
    const rules = [rule({ id: 'deny-sales', effect: 'deny', when: { roles: ['Sales Manager'] }, except: { teams: ['France'] } })];
    expect(evaluateAccessPolicy({ ...base, rules }).allowed).toBe(true);
    expect(evaluateAccessPolicy({ ...base, rules, subject: { ...SALES, teams: ['Spain'] } }).allowed).toBe(false);
  });

  it('applies resource country, sensitivity and time conditions', () => {
    const fr = [rule({ id: 'fr-only', effect: 'allow', conditions: { countries: ['FR'] } })];
    expect(evaluateAccessPolicy({ ...base, rules: fr }).allowed).toBe(true);
    expect(evaluateAccessPolicy({ ...base, rules: fr, resource: { type: 'companies', country: 'DE' } }).allowed).toBe(false);

    const secret = [rule({ id: 'no-restricted', effect: 'deny', conditions: { sensitivities: ['restricted'] } })];
    expect(evaluateAccessPolicy({ ...base, rules: secret }).allowed).toBe(true);
    expect(
      evaluateAccessPolicy({ ...base, rules: secret, resource: { type: 'companies', sensitivity: 'restricted' } }).allowed,
    ).toBe(false);

    const weekdays = [rule({ id: 'office-hours', effect: 'allow', conditions: { days: [1, 2, 3, 4, 5], hours: { from: 8, to: 18 } } })];
    expect(evaluateAccessPolicy({ ...base, rules: weekdays }).allowed).toBe(true);
    expect(evaluateAccessPolicy({ ...base, rules: weekdays, at: SUNDAY_10 }).allowed).toBe(false);
    expect(evaluateAccessPolicy({ ...base, rules: weekdays, at: new Date('2026-11-09T19:00:00.000Z') }).allowed).toBe(false);
  });

  it('with unknown record attributes, only denies what is certain and never blocks a possible allow', () => {
    const rules = [
      rule({ id: 'fr-only', effect: 'allow', conditions: { countries: ['FR'] } }),
      rule({ id: 'no-restricted', effect: 'deny', conditions: { sensitivities: ['restricted'] } }),
    ];
    expect(
      evaluateAccessPolicy({ ...base, rules, resource: { type: 'companies' }, resourceAttributes: 'unknown' }).allowed,
    ).toBe(true);
    const subjectDeny = [rule({ id: 'no-sales', effect: 'deny', when: { roles: ['Sales Manager'] } })];
    expect(
      evaluateAccessPolicy({ ...base, rules: subjectDeny, resource: { type: 'companies' }, resourceAttributes: 'unknown' }),
    ).toEqual({ allowed: false, reason: 'rule-deny', ruleId: 'no-sales' });
  });
});

describe('AccessPolicyRulesSchema', () => {
  const valid = {
    id: 'r1',
    effect: 'deny',
    when: { roles: ['Sales Manager'] },
    then: { actions: ['msa:write'], resources: ['msa'] },
  };

  it('accepts a rule and fills empty conditions and except', () => {
    const parsed = AccessPolicyRulesSchema.parse([valid]);
    expect(parsed[0]).toMatchObject({ conditions: {}, except: {} });
  });

  it('rejects an action outside the matrix and an action that does not fit the resource', () => {
    expect(AccessPolicyRulesSchema.safeParse([{ ...valid, then: { actions: ['msa:delete'], resources: ['msa'] } }]).success).toBe(false);
    expect(
      AccessPolicyRulesSchema.safeParse([{ ...valid, then: { actions: ['leads:read'], resources: ['companies'] } }]).success,
    ).toBe(false);
  });

  it('rejects duplicate rule ids, bad countries and empty hour windows', () => {
    expect(AccessPolicyRulesSchema.safeParse([valid, valid]).success).toBe(false);
    expect(AccessPolicyRulesSchema.safeParse([{ ...valid, when: { countries: ['France'] } }]).success).toBe(false);
    expect(
      AccessPolicyRulesSchema.safeParse([{ ...valid, conditions: { hours: { from: 18, to: 8 } } }]).success,
    ).toBe(false);
  });
});
