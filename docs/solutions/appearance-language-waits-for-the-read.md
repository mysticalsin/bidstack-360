# Appearance language waits for the read

The Appearance language switcher marked English before the preference arrived. A paused read has no payload. An in-flight read can already say `en` because that is the i18next fallback. A failed status with `isError` still false kept the previous language.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the preference has not arrived. It does not press English, and it does not say the load failed. Failed says the language could not load. It does not keep a stale language. A settled null payload says no preference is saved. A settled English or French choice stays.
