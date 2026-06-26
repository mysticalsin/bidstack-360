# Opt-in product tour

## Symptom

Fresh browser state can make primary actions feel broken when an onboarding tour opens automatically and places a backdrop over the page.

## Cause

Persisted onboarding hydration is not just passive state. Starting a tour during hydration can capture focus, pointer events, and keyboard flow before the user asks for help.

## Fix

- Hydrate only durable flags such as dismissed cards and completion state.
- Start tours only from explicit actions such as Quick Start or a help/topbar trigger.
- Keep tour launch code separate from route rendering and cache hydration.
- Add a store regression test proving `hydrate()` does not set `tourActive`.

## Verification

- Fresh-state browser smoke can click the page primary CTA without dismissing a tour.
- The explicit `startTour()` path still enables the tour.
- Keyboard `Escape` and dialog focus behavior work after the first CTA opens.
