// eslint-rules/no-raw-button-strings.js
//
// Custom ESLint rule — warns when `<Button>` (or `<MagneticButton>`) wraps a
// raw string literal that doesn't come from `design-system/voice/copy/buttons.json`.
// Encourages every button label to flow through the canonical registry so M10
// i18n + voice consistency are enforced at lint time, not in code review.
//
// Severity: 'warn' in M8/M9 — intentional soft-launch to surface the work
// without blocking development. Upgrade to 'error' in M10 once the migration
// of existing strings to copy keys is complete.
//
// USAGE — once the project's flat eslint config can load local rule files:
//
//   // eslint.config.js
//   import noRawButtonStrings from './eslint-rules/no-raw-button-strings.js';
//
//   export default tseslint.config(
//     // …existing config
//     {
//       files: ['apps/web/src/**/*.{ts,tsx}'],
//       plugins: {
//         'bidstack-a11y': { rules: { 'no-raw-button-strings': noRawButtonStrings } },
//       },
//       rules: {
//         'bidstack-a11y/no-raw-button-strings': 'warn',
//       },
//     },
//   );
//
// FLAT-CONFIG NOTE: eslint v9 flat config supports local rules via a plugin
// object exactly like the snippet above. The `plugins` key takes a record of
// `<namespace>: { rules: { … } }` instead of the legacy string-name lookup,
// so we don't need to publish a package. See:
// https://eslint.org/docs/latest/extend/plugins#configs-in-plugins-1
//
// ALLOWLIST: a small set of labels that are conventional and don't need to
// route through the registry (e.g. icon-only buttons that use aria-label).
// We allow `<Button aria-label="…"><Icon /></Button>` by exempting `<Icon>`
// children. Strings that are clearly dynamic — `{label}`, ${foo}` — are not
// flagged because they're not raw literals.

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn on raw text children of <Button>; suggest sourcing from design-system/voice/copy/buttons.json.',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Component names that the rule should police. Defaults to Button +
          // common variants used in BidStack — extend per-project as needed.
          components: { type: 'array', items: { type: 'string' } },
          // Strings to silently allow (e.g. fallback labels in development).
          // Keep this tiny — every entry is a paper-cut for the i18n pass.
          allowedLiterals: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawLiteral:
        'Raw button label {{ literal }}. Source from design-system/voice/copy/buttons.json instead: <Button>{copy.buttons.<category>.<key>}</Button>.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const components = new Set(options.components ?? ['Button', 'MagneticButton', 'IconButton']);
    const allowed = new Set(options.allowedLiterals ?? ['+', '×', '…']);

    /** True if the JSX element name matches one of our policed components. */
    function isPolicedButton(node) {
      const opening = node.openingElement;
      if (!opening) return false;
      const name = opening.name;
      if (name.type === 'JSXIdentifier') {
        return components.has(name.name);
      }
      // <Foo.Bar> — namespace identifier; we only police the rightmost name.
      if (name.type === 'JSXMemberExpression' && name.property?.type === 'JSXIdentifier') {
        return components.has(name.property.name);
      }
      return false;
    }

    /** True if the element already has aria-label / aria-labelledby. */
    function hasAriaLabel(node) {
      const attrs = node.openingElement?.attributes ?? [];
      return attrs.some(
        (a) =>
          a.type === 'JSXAttribute' &&
          a.name?.type === 'JSXIdentifier' &&
          (a.name.name === 'aria-label' || a.name.name === 'aria-labelledby'),
      );
    }

    /** True if the literal is a single-character icon-like glyph or in allowed. */
    function isAllowedLiteral(value) {
      const trimmed = value.trim();
      if (trimmed.length === 0) return true; // whitespace-only; ignore
      if (allowed.has(trimmed)) return true;
      // One-character symbols (e.g. arrows, mathematical glyphs) are usually
      // decorative and paired with aria-label.
      if (/^[^\w\s]$/.test(trimmed)) return true;
      return false;
    }

    return {
      JSXElement(node) {
        if (!isPolicedButton(node)) return;

        for (const child of node.children) {
          if (child.type !== 'JSXText') continue;
          const value = child.value;
          if (isAllowedLiteral(value)) continue;
          // If aria-label is present, the visible text is the label; allow
          // (the registry pattern still applies, but icon buttons with
          // aria-label predate the registry — don't warn on those).
          if (hasAriaLabel(node)) continue;

          context.report({
            node: child,
            messageId: 'rawLiteral',
            data: { literal: JSON.stringify(value.trim()) },
          });
        }
      },
    };
  },
};
