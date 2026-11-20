import type { InitiativeTheme } from '../schemas/account-signals.js';

interface SkillRule {
  skill: string;
  re: RegExp;
  theme: InitiativeTheme | null;
}

/** Canonical skill name, the pattern that signals it in job text, and the theme it points to. */
const SKILL_RULES: SkillRule[] = [
  { skill: 'SAP S/4HANA', re: /\bs\/?4 ?hana\b|\bhana\b/i, theme: 'erp_finance' },
  { skill: 'SAP', re: /\bsap\b/i, theme: 'erp_finance' },
  { skill: 'Oracle', re: /\boracle\b/i, theme: 'erp_finance' },
  { skill: 'Workday', re: /\bworkday\b/i, theme: 'erp_finance' },
  { skill: 'Dynamics 365', re: /\bdynamics 365\b|\bd365\b/i, theme: 'erp_finance' },
  { skill: 'NetSuite', re: /\bnetsuite\b/i, theme: 'erp_finance' },
  { skill: 'Core banking', re: /\bcore banking\b/i, theme: 'erp_finance' },
  { skill: 'Salesforce', re: /\bsalesforce\b|\bsfdc\b/i, theme: 'digital_cx' },
  { skill: 'ServiceNow', re: /\bservicenow\b/i, theme: 'digital_cx' },
  { skill: 'Snowflake', re: /\bsnowflake\b/i, theme: 'data_ai' },
  { skill: 'Databricks', re: /\bdatabricks\b/i, theme: 'data_ai' },
  { skill: 'Data platform', re: /\bdata platforms?\b/i, theme: 'data_ai' },
  { skill: 'dbt', re: /\bdbt\b/i, theme: 'data_ai' },
  { skill: 'Spark', re: /\b(py)?spark\b/i, theme: 'data_ai' },
  { skill: 'Kafka', re: /\bkafka\b/i, theme: 'data_ai' },
  { skill: 'Power BI', re: /\bpower ?bi\b/i, theme: 'data_ai' },
  { skill: 'Generative AI', re: /\bgenerative ai\b|\bgen ?ai\b|\bllms?\b/i, theme: 'data_ai' },
  { skill: 'Machine learning', re: /\bmachine learning\b|\bmlops\b/i, theme: 'data_ai' },
  { skill: 'AWS', re: /\baws\b|amazon web services/i, theme: 'cloud' },
  { skill: 'Azure', re: /\bazure\b/i, theme: 'cloud' },
  { skill: 'GCP', re: /\bgcp\b|google cloud/i, theme: 'cloud' },
  { skill: 'Kubernetes', re: /\bkubernetes\b|\bk8s\b/i, theme: 'cloud' },
  { skill: 'Terraform', re: /\bterraform\b/i, theme: 'cloud' },
  { skill: 'SIEM', re: /\bsiem\b|\bsplunk\b/i, theme: 'cyber' },
  { skill: 'Zero Trust', re: /\bzero trust\b/i, theme: 'cyber' },
  { skill: 'Identity and access', re: /\biam\b|identity and access/i, theme: 'cyber' },
  { skill: 'Embedded', re: /\bembedded\b/i, theme: 'engineering' },
  { skill: 'AUTOSAR', re: /\bautosar\b/i, theme: 'engineering' },
  { skill: 'Electrification', re: /\belectrification\b|\be-?mobility\b/i, theme: 'engineering' },
  { skill: 'Python', re: /\bpython\b/i, theme: null },
  { skill: 'Java', re: /\bjava\b/i, theme: null },
  { skill: 'React', re: /\breact\b/i, theme: null },
];

const THEME_BY_SKILL = new Map(SKILL_RULES.map((r) => [r.skill.toLowerCase(), r.theme]));

/** Skills keywords named in a job title or description. Generic words never count. */
export function extractSkills(text: string): string[] {
  const out = SKILL_RULES.filter((r) => r.re.test(text)).map((r) => r.skill);
  return out.includes('SAP S/4HANA') ? out.filter((s) => s !== 'SAP') : out;
}

/** Theme a skill points to, or null when it says nothing about a project. */
export function themeForSkill(skill: string): InitiativeTheme | null {
  const hit = THEME_BY_SKILL.get(skill.toLowerCase());
  if (hit !== undefined) return hit;
  const found = extractSkills(skill)[0];
  return found ? (THEME_BY_SKILL.get(found.toLowerCase()) ?? null) : null;
}
