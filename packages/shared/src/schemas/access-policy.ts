import { z } from 'zod';

import { PERMISSION_KEYS, type PermissionKey } from '../types/permissions.js';

/**
 * Attribute-based access policies layered on the RBAC matrix (When / Then /
 * Except rules). Shared by the API (validation, simulation, enforcement) and
 * the web builder, so the preview runs the same evaluator the API enforces.
 *
 * Policies only narrow: the matrix is the ceiling and a rule can never grant
 * a permission the matrix withholds.
 */

export const ACCESS_POLICY_RESOURCES = ['companies', 'msa', 'opportunities', 'exports'] as const;
export type AccessPolicyResource = (typeof ACCESS_POLICY_RESOURCES)[number];

export const ACCESS_POLICY_SENSITIVITIES = ['public', 'internal', 'confidential', 'restricted'] as const;
export type AccessPolicySensitivity = (typeof ACCESS_POLICY_SENSITIVITIES)[number];

/** Matrix permissions a rule may name for each resource. Exports are gated by
 *  the opportunity export, report and tenant export (settings:write) routes. */
export const ACCESS_POLICY_RESOURCE_ACTIONS: Record<AccessPolicyResource, readonly PermissionKey[]> = {
  companies: ['companies:read', 'companies:write'],
  msa: ['msa:read', 'msa:write', 'msa:admin'],
  opportunities: ['opportunities:read', 'opportunities:write'],
  exports: ['opportunities:read', 'reports:read', 'settings:write'],
};

/** No record carries a sensitivity label yet, so each resource has a fixed one. */
export const ACCESS_POLICY_DEFAULT_SENSITIVITY: Record<AccessPolicyResource, AccessPolicySensitivity> = {
  companies: 'internal',
  opportunities: 'internal',
  msa: 'confidential',
  exports: 'restricted',
};

export const ACCESS_POLICY_LIMITS = { rules: 50, listItems: 50, nameLength: 120, noteLength: 500 } as const;

const Iso2 = z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter ISO country code');
const Label = z.string().trim().min(1).max(80);

const SubjectMatchSchema = z
  .object({
    roles: z.array(Label).max(ACCESS_POLICY_LIMITS.listItems).optional(),
    teams: z.array(Label).max(ACCESS_POLICY_LIMITS.listItems).optional(),
    countries: z.array(Iso2).max(ACCESS_POLICY_LIMITS.listItems).optional(),
  })
  .strict();
export type AccessPolicySubjectMatch = z.infer<typeof SubjectMatchSchema>;

const ConditionsSchema = z
  .object({
    countries: z.array(Iso2).max(ACCESS_POLICY_LIMITS.listItems).optional(),
    sensitivities: z.array(z.enum(ACCESS_POLICY_SENSITIVITIES)).optional(),
    /** UTC weekdays, 0 = Sunday. */
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    /** UTC hour window, from inclusive, to exclusive. */
    hours: z
      .object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) })
      .refine((h) => h.from < h.to, { message: 'The window must end after it starts' })
      .optional(),
  })
  .strict();
export type AccessPolicyConditions = z.infer<typeof ConditionsSchema>;

export const AccessPolicyRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    effect: z.enum(['allow', 'deny']),
    when: SubjectMatchSchema.default({}),
    then: z
      .object({
        actions: z.array(z.enum(PERMISSION_KEYS)).min(1).max(20),
        resources: z.array(z.enum(ACCESS_POLICY_RESOURCES)).min(1),
      })
      .strict(),
    conditions: ConditionsSchema.default({}),
    except: SubjectMatchSchema.default({}),
  })
  .strict()
  .superRefine((rule, ctx) => {
    for (const action of rule.then.actions) {
      const fits = rule.then.resources.some((r) => ACCESS_POLICY_RESOURCE_ACTIONS[r].includes(action));
      if (!fits) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['then', 'actions'],
          message: `${action} does not apply to ${rule.then.resources.join(', ')}`,
        });
      }
    }
  });
export type AccessPolicyRule = z.infer<typeof AccessPolicyRuleSchema>;

export const AccessPolicyRulesSchema = z
  .array(AccessPolicyRuleSchema)
  .max(ACCESS_POLICY_LIMITS.rules)
  .superRefine((rules, ctx) => {
    const seen = new Set<string>();
    rules.forEach((rule, i) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, 'id'], message: 'Rule ids must be unique' });
      }
      seen.add(rule.id);
    });
  });

export interface AccessPolicySubject {
  roles: readonly string[];
  teams: readonly string[];
  countries: readonly string[];
}

export interface AccessPolicyResourceRef {
  type: AccessPolicyResource;
  country?: string | null;
  sensitivity?: AccessPolicySensitivity | null;
}

export interface AccessPolicyInput {
  rules: readonly AccessPolicyRule[];
  /** The RBAC matrix decision. A policy can only turn an allow into a deny. */
  matrixAllows: boolean;
  subject: AccessPolicySubject;
  action: PermissionKey;
  resource: AccessPolicyResourceRef;
  at: Date;
  /**
   * 'unknown' when the record is not loaded (route-level enforcement): record
   * conditions then never trigger a deny and never block an allow.
   */
  resourceAttributes?: 'known' | 'unknown';
}

export type AccessPolicyReason = 'matrix-deny' | 'no-policy' | 'rule-allow' | 'rule-deny' | 'default-deny';

export interface AccessPolicyDecision {
  allowed: boolean;
  reason: AccessPolicyReason;
  ruleId: string | null;
}

function overlaps(listed: readonly string[] | undefined, held: readonly string[]): boolean {
  return listed !== undefined && listed.length > 0 && listed.some((v) => held.includes(v));
}

function isEmpty(list: readonly unknown[] | undefined): boolean {
  return list === undefined || list.length === 0;
}

function subjectMatches(rule: AccessPolicyRule, s: AccessPolicySubject): boolean {
  const w = rule.when;
  const when =
    (isEmpty(w.roles) || overlaps(w.roles, s.roles)) &&
    (isEmpty(w.teams) || overlaps(w.teams, s.teams)) &&
    (isEmpty(w.countries) || overlaps(w.countries, s.countries));
  if (!when) return false;
  const e = rule.except;
  return !(overlaps(e.roles, s.roles) || overlaps(e.teams, s.teams) || overlaps(e.countries, s.countries));
}

/** true, false, or null when the record attributes are unknown. */
function conditionsMatch(rule: AccessPolicyRule, input: AccessPolicyInput): boolean | null {
  const c = rule.conditions;
  const at = input.at;
  if (!isEmpty(c.days) && !c.days!.includes(at.getUTCDay())) return false;
  if (c.hours && (at.getUTCHours() < c.hours.from || at.getUTCHours() >= c.hours.to)) return false;
  const sensitivity = input.resource.sensitivity ?? ACCESS_POLICY_DEFAULT_SENSITIVITY[input.resource.type];
  if (!isEmpty(c.sensitivities) && !c.sensitivities!.includes(sensitivity)) return false;
  if (!isEmpty(c.countries)) {
    if (input.resourceAttributes === 'unknown') return null;
    const country = input.resource.country;
    if (!country || !c.countries!.includes(country)) return false;
  }
  return true;
}

export function evaluateAccessPolicy(input: AccessPolicyInput): AccessPolicyDecision {
  if (!input.matrixAllows) return { allowed: false, reason: 'matrix-deny', ruleId: null };
  const relevant = input.rules.filter(
    (r) => r.then.actions.includes(input.action) && r.then.resources.includes(input.resource.type),
  );
  const applies = (r: AccessPolicyRule) => subjectMatches(r, input.subject);

  const deny = relevant.find((r) => r.effect === 'deny' && applies(r) && conditionsMatch(r, input) === true);
  if (deny) return { allowed: false, reason: 'rule-deny', ruleId: deny.id };

  const allows = relevant.filter((r) => r.effect === 'allow');
  if (allows.length === 0) return { allowed: true, reason: 'no-policy', ruleId: null };
  const allow = allows.find((r) => applies(r) && conditionsMatch(r, input) !== false);
  if (allow) return { allowed: true, reason: 'rule-allow', ruleId: allow.id };
  return { allowed: false, reason: 'default-deny', ruleId: null };
}

/**
 * Which policy resource a guarded request touches, from its permission and
 * URL. null means no policy can apply and the matrix decision stands.
 */
export function accessPolicyResourceFor(permission: PermissionKey, url: string): AccessPolicyResource | null {
  const path = url.split('?')[0] ?? '';
  if (/(^|\/)(exports?|[a-z-]+-export)(\/|$)/.test(path) && ACCESS_POLICY_RESOURCE_ACTIONS.exports.includes(permission)) {
    return 'exports';
  }
  if (permission.startsWith('companies:')) return 'companies';
  if (permission.startsWith('msa:')) return 'msa';
  if (permission.startsWith('opportunities:')) return 'opportunities';
  return null;
}
