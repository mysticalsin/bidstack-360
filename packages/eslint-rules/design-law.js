// packages/eslint-rules/design-law.js
//
// Design-law lint for BidStack — the CI teeth for docs/adr/0002-design-tokens.md.
// Built on the same chassis as ./no-raw-button-strings.js (salvaged from
// BIDCRM-design per fusion-validation Amendment 3/4: adopt the existing lint
// chassis, don't build cold).
//
// Four rules, exported as one plugin object:
//
//   no-theme-variant-geometry  (error) — bans `dark:rounded-*`, `dark:shadow-*`,
//     `dark:backdrop-*` (any variant chain ending in those utilities). The law:
//     theme changes COLOUR, never shape/elevation/material. Geometry morphs
//     between themes were the root defect fixed in Card/Button/Toast/Input/
//     Dialog (ADR 0002, decision "theme-invariant geometry").
//
//   no-foreign-token-vocabulary  (error) — bans the shadcn semantic classnames
//     BidStack's @theme does not define (fusion-validation Amendment 6 / S2:
//     the 18-file graft rewrites shadcn names to BidStack names so "card
//     background" never gets two legal spellings). Zero of these names exist
//     in BidStack's token bridge — any use silently renders unstyled.
//
//   no-arbitrary-geometry  (error) — bans LITERAL arbitrary geometry in class
//     strings: `rounded-[28px]`, `p-[13px]`, `shadow-[0_8px_40px_rgba(...)]`.
//     Shape, elevation and spacing come off the scale (--radius-*, --shadow-*,
//     Tailwind's 4px spacing rhythm) so the 18-file graft cannot smuggle the
//     CRM's 5px-radius / bespoke-shadow rhythm in one class at a time. An
//     arbitrary value that REFERENCES a token — `shadow-[var(--shadow-md)]`,
//     `rounded-[var(--radius-lg)]` — is the sanctioned form and is allowed:
//     Tailwind has no `shadow-md` bound to our token, so 74 of the 89
//     arbitrary-geometry sites in apps/web are already written that way.
//     Positioning (`top-[calc(100%+6px)]`), sizing (`min-h-[44px]`,
//     `w-[280px]`) and type (`text-[11px]`) are deliberately OUT of scope —
//     they have no scale to fall back to and are conventional here.
//
//   no-raw-hex-in-classname  (warn) — flags hex colours inside Tailwind
//     arbitrary values (`bg-[#123456]`). Warn, not error: pre-existing debt
//     exists (login Hero/DemoSignIn, TerritoryPanels). Upgrade to 'error'
//     once those are migrated to tokens.
//
// SCANNING STRATEGY — why every string literal, not just className attributes:
// class strings in this codebase frequently live in module-level constants
// (`CARD_BASE` in Card.tsx) and cva/cn() helper arguments, then flow into
// className indirectly. Attribute-only scanning would miss exactly the files
// the law exists to police. So both rules scan every string Literal and
// TemplateElement (skipping import/export sources). The patterns are
// Tailwind-specific enough (`dark:` prefix chains, `[#hex]` bracket syntax,
// exact shadcn token names at token boundaries) that false positives outside
// class strings are implausible in practice.
//
// USAGE (wired in the root eslint.config.js):
//
//   import designLaw from './packages/eslint-rules/design-law.js';
//   // …
//   {
//     files: ['apps/web/src/**/*.{ts,tsx}'],
//     plugins: { 'bidstack-design': designLaw },
//     rules: {
//       'bidstack-design/no-theme-variant-geometry': 'error',
//       'bidstack-design/no-foreign-token-vocabulary': 'error',
//       'bidstack-design/no-arbitrary-geometry': 'error',
//       'bidstack-design/no-raw-hex-in-classname': 'warn',
//     },
//   },
//
// ESCAPE HATCH: per the fusion plan's risk register (#6), disabling a
// design-law rule requires a named ADR reference in the eslint-disable
// comment. There is no config option to widen the allowlist — the law is
// deliberately not configurable.

// `dark:` (optionally chained with more variants, e.g. `dark:hover:shadow-sm`)
// ending in a geometry/material utility. Matches through the end of the
// utility token so the report shows the full offending class.
const THEME_GEOMETRY_RE = /dark:(?:[\w-]+:)*(?:rounded|shadow|backdrop)(?![a-zA-Z])[^\s"'`]*/g;

// shadcn semantic classnames BidStack's @theme does NOT define (Amendment 6).
const FOREIGN_TOKENS = [
  'bg-card',
  'text-card-foreground',
  'text-muted-foreground',
  'bg-popover',
  'border-input',
  'bg-accent',
  'text-accent-foreground',
  'bg-secondary',
];

// Token must sit at a class boundary: start-of-string / whitespace / a variant
// colon before it; end-of-string / whitespace / an opacity slash after it.
// The lookahead keeps `bg-accent` from matching inside `bg-accent-foreground`.
const FOREIGN_TOKEN_RE = new RegExp(
  `(?:^|[\\s:])(${FOREIGN_TOKENS.join('|')})(?=$|[\\s/])`,
  'g',
);

// Tailwind arbitrary values on the GEOMETRY utilities only — radius, shadow,
// and the padding/margin/gap rhythm. Anchored on a class boundary
// (start-of-string, whitespace, quote, or a variant colon) with an optional
// leading `-` for negative spacing, so `top-[15vh]` and `backdrop-blur-[2px]`
// never match on their trailing `p-[`/`r-[` fragment.
//
// Group 1 = the full offending class (for the message), group 2 = the value
// inside the brackets (checked against TOKEN_REFERENCE_RE below).
const ARBITRARY_GEOMETRY_RE =
  /(?:^|[\s:'"`])(-?(?:rounded(?:-[a-z]{1,2})?|shadow|p[xytrbles]?|m[xytrbles]?|gap(?:-[xy])?|space-[xy])-\[([^\]]*)\])/g;

// The sanctioned escape: an arbitrary value that resolves to a token. This is
// how BidStack spells elevation everywhere (`shadow-[var(--shadow-md)]`) —
// Tailwind's own shadow scale is not bound to our tokens.
const TOKEN_REFERENCE_RE = /var\(\s*--/;

// Tailwind arbitrary-value hex: `bg-[#2c4bff]`, `border-[#fff]`, etc. The
// surrounding brackets keep plain data strings like '#2c4bff' (chart configs,
// tests) out of scope — only class syntax matches.
const RAW_HEX_RE = /\[#[0-9a-fA-F]{3,8}\]/g;

/** Parents whose string child is a module specifier, never a class string. */
const MODULE_SOURCE_PARENTS = new Set([
  'ImportDeclaration',
  'ImportExpression',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
]);

/**
 * Build a rule visitor that runs `check(node, text)` over every string
 * Literal and TemplateElement in the file.
 */
function stringScanner(check) {
  return {
    Literal(node) {
      if (typeof node.value !== 'string') return;
      if (node.parent && MODULE_SOURCE_PARENTS.has(node.parent.type)) return;
      check(node, node.value);
    },
    TemplateElement(node) {
      check(node, node.value?.raw ?? '');
    },
  };
}

/**
 * Report every regex match in `text` against `node` with the match as data.
 * `skip` (optional) receives the whole match array so a rule can whitelist
 * specific shapes (e.g. arbitrary values that reference a token).
 */
function reportMatches(context, node, text, regex, messageId, group = 0, skip) {
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (skip && skip(m)) continue;
    context.report({ node, messageId, data: { match: m[group] } });
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const noThemeVariantGeometry = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow dark:rounded-* / dark:shadow-* / dark:backdrop-* — theme changes colour, never geometry or material (ADR 0002).',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [],
    messages: {
      themeGeometry:
        'Theme-variant geometry "{{ match }}". Theme changes colour only — set one radius/shadow/backdrop and let token VALUES differ per theme (ADR 0002).',
    },
  },
  create(context) {
    return stringScanner((node, text) => {
      reportMatches(context, node, text, THEME_GEOMETRY_RE, 'themeGeometry');
    });
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const noForeignTokenVocabulary = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow shadcn semantic classnames BidStack does not define (bg-card, text-muted-foreground, …) — one token vocabulary only (Amendment 6).',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [],
    messages: {
      foreignToken:
        'Foreign token vocabulary "{{ match }}" — BidStack\'s @theme does not define it, so it renders unstyled. Use the BidStack token (e.g. bg-[var(--surface-card)], text-[var(--fg-muted)]) instead.',
    },
  },
  create(context) {
    return stringScanner((node, text) => {
      reportMatches(context, node, text, FOREIGN_TOKEN_RE, 'foreignToken', 1);
    });
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const noArbitraryGeometry = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow literal arbitrary geometry (rounded-[28px], p-[13px], shadow-[0_8px_40px_…]) — radius, elevation and spacing come off the scale. Token references (shadow-[var(--shadow-md)]) are allowed.',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [],
    messages: {
      arbitraryGeometry:
        'Literal arbitrary geometry "{{ match }}". Radius, elevation and spacing come off the scale — use rounded-md/lg/xl, the p-/m-/gap- 4px rhythm, or reference a token (shadow-[var(--shadow-md)]). Off-scale geometry is how a foreign design system arrives one class at a time (ADR 0002).',
    },
  },
  create(context) {
    return stringScanner((node, text) => {
      reportMatches(context, node, text, ARBITRARY_GEOMETRY_RE, 'arbitraryGeometry', 1, (m) =>
        TOKEN_REFERENCE_RE.test(m[2]),
      );
    });
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const noRawHexInClassname = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn on hex colours in Tailwind arbitrary values (bg-[#123456]) — colour flows through tokens, not literals.',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [],
    messages: {
      rawHex:
        'Raw hex in class arbitrary value "{{ match }}". Route colour through a token: bg-[var(--…)] — hex literals bypass theming and the contrast audit.',
    },
  },
  create(context) {
    return stringScanner((node, text) => {
      reportMatches(context, node, text, RAW_HEX_RE, 'rawHex');
    });
  },
};

export default {
  rules: {
    'no-theme-variant-geometry': noThemeVariantGeometry,
    'no-foreign-token-vocabulary': noForeignTokenVocabulary,
    'no-arbitrary-geometry': noArbitraryGeometry,
    'no-raw-hex-in-classname': noRawHexInClassname,
  },
};
