# i18n Contributing Guide

BidStack 360° ships EN (English), FR (French), and ES (Spanish) as of Wave 7.
This guide explains how to keep translations healthy as the product grows.

---

## Table of Contents

1. [Architecture overview](#architecture-overview)
2. [Adding a new locale](#adding-a-new-locale)
3. [Adding translation keys for a new feature](#adding-translation-keys-for-a-new-feature)
4. [Translation review process](#translation-review-process)
5. [Plurals conventions (CLDR)](#plurals-conventions-cldr)
6. [RTL preparation](#rtl-preparation)
7. [Testing translations](#testing-translations)
8. [Common mistakes](#common-mistakes)

---

## Architecture overview

```
apps/web/
├── src/
│   ├── i18n/
│   │   ├── index.ts          # i18next singleton + exports
│   │   └── i18n.test.ts      # Vitest: language switch, fallback, plurals
│   └── main.tsx              # import './i18n' bootstraps before React mounts
└── public/
    └── locales/
        ├── en/               # Source of truth (EN is authoritative)
        │   ├── common.json
        │   ├── auth.json
        │   ├── crm.json
        │   ├── settings.json
        │   ├── onboarding.json
        │   ├── ai.json
        │   ├── reports.json
        │   ├── signatures.json
        │   └── integrations.json
        ├── fr/               # French translations (mirror of en/)
        └── es/               # Spanish translations (mirror of en/)

apps/api/
└── locales/
    ├── en.json               # API-side: errors, validation messages, audit strings
    ├── fr.json
    └── es.json
```

**Library stack:** `i18next` + `react-i18next` + `i18next-http-backend` + `i18next-browser-languagedetector`

Translation files are loaded at runtime via `i18next-http-backend` from `/public/locales/{lng}/{ns}.json`.
The HTTP backend loads JSON lazily per namespace — only namespaces that a mounted component actually uses
are fetched. This keeps initial bundle size unaffected by translation volume.

**Detection order (priority):** cookie → localStorage → browser navigator → `<html lang>` attribute

**Persistence:** `persistLocale()` in `LanguageSwitcher.tsx` writes both:
- `localStorage['bidstack-locale']` — read by the detector on the next boot
- `document.cookie = 'bidstack-locale=...; SameSite=Lax; max-age=31536000'` — read by the API's
  Accept-Language middleware to localise server-side error messages

---

## Adding a new locale

### Checklist

1. **Add to `SUPPORTED_LOCALES`** in `apps/web/src/i18n/index.ts`:
   ```ts
   export const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de'] as const; // example: adding German
   ```

2. **Add to `RTL_LOCALES`** only if the language is right-to-left:
   ```ts
   export const RTL_LOCALES: ReadonlyArray<SupportedLocale> = ['ar', 'he'] as const;
   ```

3. **Create translation files** under `apps/web/public/locales/{lng}/`.
   Copy the entire `en/` directory as a starting point, then translate every value.
   Keys must stay identical to `en/`. Missing keys fall back to English automatically, but 100%
   coverage is expected before shipping.

4. **Add to `DISPLAY_LOCALES`** in `LanguageSwitcher.tsx` to expose it in the UI:
   ```ts
   const DISPLAY_LOCALES: ReadonlyArray<SupportedLocale> = ['en', 'fr', 'es', 'de'] as const;
   ```
   Add its label to both `LOCALE_NATIVE_LABEL` and `LOCALE_FULL_LABEL`.

5. **Create API locale file** `apps/api/locales/{lng}.json` covering `errors`, `validation`, and `audit` keys.
   See `apps/api/locales/en.json` for the required structure.

6. **Add to the API i18n service** (`apps/api/src/lib/i18n.ts`) so the API Accept-Language middleware
   recognises the new locale code.

7. **Update tests** in `apps/web/src/i18n/i18n.test.ts`:
   - Seed resource bundles for the new locale in `beforeAll`.
   - Add a `changeLanguage` test.
   - Add a pluralization test if the language has rules that differ from English.

8. **Update this guide** — add the locale to the table in "Plurals conventions" below.

---

## Adding translation keys for a new feature

### Namespace selection

| What the component does                   | Namespace       |
|-------------------------------------------|-----------------|
| Navigation, layout, common UI chrome      | `common`        |
| Authentication flows (sign-in, sign-out)  | `auth`          |
| CRM entities (leads, contacts, companies) | `crm`           |
| Settings & preferences                    | `settings`      |
| Onboarding tour & quick-start             | `onboarding`    |
| AI agents, Dust, meeting prep             | `ai`            |
| Reports, charts, metrics                  | `reports`       |
| eSignature flows                          | `signatures`    |
| Third-party integrations                  | `integrations`  |

If your feature doesn't fit cleanly, prefer the closest existing namespace over creating a new one.
Adding a namespace requires updating `NAMESPACES` in `src/i18n/index.ts` and adding a `NAMESPACES`
test assertion in `i18n.test.ts`.

### Key naming conventions

- Use `camelCase` for leaf keys: `"submitButton"`, `"emptyState"`.
- Group by semantic role, not by component: `"actions.save"`, `"states.empty"`.
- Suffix pluralizable keys with **nothing** — the `count` interpolation variable triggers the
  correct plural suffix automatically (see Plurals section below).
- Interpolation variables use double-braces: `"Hello, {{name}}!"`.
- Keep key paths short but unambiguous. Three levels deep is the practical limit.

### Workflow

1. **EN first.** Add the key + English value to `en/{namespace}.json`. This is the source of truth.
2. **FR and ES next.** Add the same key + translation to `fr/{namespace}.json` and `es/{namespace}.json`
   before opening the PR. Stubs that haven't been translated yet should still be added as empty strings `""`
   rather than copied English text — empty strings fall back to English; copied English text silently hides
   a missing translation.
3. **Use `useTranslation`** in the component:
   ```tsx
   import { useTranslation } from 'react-i18next';

   function MyComponent() {
     const { t } = useTranslation('crm'); // use the right namespace
     return <button>{t('actions.save')}</button>;
   }
   ```
4. **Never hardcode English strings** in JSX that a user will read. UI labels, error messages, button text,
   and help copy all belong in translation files. Code-internal values (enum values, log messages, test
   fixture data) do not.

---

## Translation review process

All FR/ES translations go through a two-step process before merging:

### Step 1 — Author pass

The engineer who adds the English keys provides the initial FR/ES translation. Professional-quality
translations are required — do not rely solely on machine translation. MT output is a useful draft,
but must be reviewed and corrected by a native or near-native speaker before the PR is opened.

### Step 2 — Native-speaker review

A reviewer who is native or near-native in the target language must approve translation changes before
merge. For PRs that only touch EN keys, the translation step can be deferred to a follow-up PR, but
the FR/ES namespace files must receive stub entries (empty strings, not English copies) so the fallback
chain is activated.

### Review checklist

- [ ] All interpolation placeholders (`{{name}}`, `{{count}}`) are preserved and in the right position.
- [ ] Plural forms have the right suffixes (see below).
- [ ] Accented characters are correct UTF-8 (no `Ã©` double-encoding — the repo has had this problem before).
- [ ] Tone is consistent with the rest of the namespace (formal "vous" vs. informal "tu" in French — we use `vous`).
- [ ] CRM terminology is consistent (e.g., "lead" = "prospect" in FR, not "piste"; "opportunity" = "opportunité").

### CRM term glossary

| English        | French           | Spanish          |
|----------------|------------------|------------------|
| Lead           | Prospect         | Prospecto        |
| Opportunity    | Opportunité      | Oportunidad      |
| Contact        | Contact          | Contacto         |
| Company        | Entreprise       | Empresa          |
| Pipeline       | Pipeline         | Pipeline         |
| Stage          | Étape            | Etapa            |
| Forecast       | Prévision        | Pronóstico       |
| Dashboard      | Tableau de bord  | Panel            |
| Activity       | Activité         | Actividad        |
| Integration    | Intégration      | Integración      |
| Workspace      | Espace de travail| Espacio de trabajo |

---

## Plurals conventions (CLDR)

i18next uses CLDR plural categories. The pluralization key suffix is computed automatically from the
`count` interpolation variable — you never call `_one` or `_other` directly.

### How to write plural keys

```json
{
  "notifications": {
    "unread_one":   "{{count}} unread mention",
    "unread_other": "{{count}} unread mentions"
  }
}
```

In the component:
```tsx
t('notifications.unread', { count: n })
// count=1 → "1 unread mention"
// count=5 → "5 unread mentions"
```

### Plural category rules per locale

| Locale | Categories used | Edge case |
|--------|-----------------|-----------|
| EN     | `one`, `other`  | 0 → `other` (plural) |
| FR     | `one`, `other`  | **0 → `one` (singular)** — CLDR French rule |
| ES     | `one`, `other`  | 0 → `other` (plural) |
| AR     | `zero`, `one`, `two`, `few`, `many`, `other` | Complex — see below |

**French 0 rule** (important and counterintuitive): In French, 0 falls into the "one" (singular) CLDR
category. So `t('notifications.unread', { count: 0 })` returns `"0 mention non lue"` (singular), not the
plural. This matches native French usage ("0 résultat" not "0 résultats" in many contexts). The test suite
verifies this at `i18n.test.ts` → "uses singular for count=0 (French CLDR rule: 0 → 'one')".

**Arabic** (if/when added): Arabic has 6 plural forms. Every pluralizable key needs 6 suffixes:
`_zero`, `_one`, `_two`, `_few`, `_many`, `_other`. Do not add Arabic until a native Arabic reviewer
is available to validate all plural forms.

---

## RTL preparation

Arabic (`ar`) and Hebrew (`he`) are right-to-left languages. The locale system supports them
(`RTL_LOCALES` in `src/i18n/index.ts`), but the RTL UI layout is **not yet fully QA'd** and
`ar`/`he` are excluded from `DISPLAY_LOCALES` in `LanguageSwitcher.tsx` this wave.

### What to keep in mind while writing LTR components

1. **Never hardcode `text-left`, `ml-*`, `mr-*`, `pl-*`, `pr-*`.** Use logical properties instead
   (`text-start`, `ms-*`, `me-*`, `ps-*`, `pe-*`) wherever Tailwind supports them. Logical properties
   flip automatically in RTL without extra CSS.

2. **`dir` attribute propagates from `<html>`.** The `isRtl()` helper (`src/i18n/index.ts`) returns
   true for RTL locales. When RTL is enabled, set `document.documentElement.dir = 'rtl'`
   alongside `document.documentElement.lang`. The `LanguageSwitcher` already has a placeholder comment
   for this.

3. **Icons that convey direction must be mirrored.** Arrow icons (back, forward, send) must be
   `transform: scaleX(-1)` in RTL. Decorative icons (stars, checkmarks) must not be flipped.

4. **Flex row order and absolute positioning.** Any component that uses `flex-row` with `gap` is safe
   (direction flips automatically). Any component that uses `absolute left-0` or `absolute right-0`
   will need `absolute start-0` / `absolute end-0` equivalents before RTL ships.

5. **Test in Storybook before enabling.** When RTL layout QA is scheduled, add `dir="rtl"` to the
   Storybook HTML element and walk every component in the design system.

---

## Testing translations

### Unit tests (Vitest)

`apps/web/src/i18n/i18n.test.ts` covers:

- `isSupportedLocale` — accepts shipped locales, rejects unknown strings/null/undefined
- `isRtl` — AR is RTL; EN/FR/ES are not
- `NAMESPACES` shape — all 9 namespaces declared
- `changeLanguage` — FR, ES, back to EN all resolve without rejection
- Missing key fallback — result must not equal the raw `namespace:key.path` string
- Pluralization — EN, FR, ES plural rules verified with real `count` values

When adding a new locale, seed its resource bundle in `beforeAll`:

```ts
i18n.addResourceBundle('de', 'common', {
  notifications: {
    unread_one:   '{{count}} ungelesene Erwähnung',
    unread_other: '{{count}} ungelesene Erwähnungen',
  },
  states: { error: 'Etwas ist schiefgelaufen' },
}, true, true);
```

Then add tests for `changeLanguage('de')` and German plural rules.

### Why the http-backend doesn't work in Vitest

The `i18next-http-backend` plugin fetches `/public/locales/{lng}/{ns}.json` via `fetch()`. In the
Vitest environment (happy-dom, no HTTP server), `fetch` to a relative URL fails silently — i18next
logs a warning and marks the namespace as loaded-but-empty. This is why every test that asserts on
translated text must seed bundles via `addResourceBundle()` in `beforeAll`. The alternative
(mocking `fetch`) is more brittle and harder to maintain.

### E2E tests (Playwright)

The language switcher is exercised in `apps/web/e2e/`. If adding locale-dependent E2E tests:

```ts
await page.goto('/settings');
await page.getByRole('button', { name: /Language/i }).click();
await page.getByRole('button', { name: 'FR' }).click();
// Now assert translated text is visible
await expect(page.getByText('Tableau de bord')).toBeVisible();
```

---

## Common mistakes

| Mistake | What goes wrong | Fix |
|---------|-----------------|-----|
| Copying English text into FR/ES as a placeholder | FR/ES users silently see English — no fallback triggers because the key exists | Use an empty string `""` as a stub; empty values trigger the fallback chain |
| Double-encoded UTF-8 in JSON (`Ã©` instead of `é`) | Text renders as garbage characters | Ensure editors and `git` are configured for UTF-8; validate with `python3 -c "import json,sys; json.load(open(sys.argv[1]))"` |
| Hardcoding `_one` / `_other` suffix in `t()` calls | Pluralization breaks for all locales | Let i18next compute the suffix: pass `{ count: n }` and use the base key name |
| Using `i18n.language` without stripping region | `en-US` (browser default) is not in `SUPPORTED_LOCALES` | Use `i18n.resolvedLanguage` or `isSupportedLocale(i18n.language.split('-')[0])` |
| Forgetting to update `NAMESPACES` when adding a namespace | Components that import the new namespace get a console warning in dev; tests fail | Always update `NAMESPACES` in `src/i18n/index.ts` and add a test assertion |
| Adding RTL locale to `DISPLAY_LOCALES` before layout QA | RTL text in an LTR layout looks broken | Keep new RTL locales in `SUPPORTED_LOCALES` + `RTL_LOCALES` but off `DISPLAY_LOCALES` until layout audit |
