// The Appearance language switcher may mark a language only after the
// preference arrives. A pause has no payload, even when i18next has already
// fallen back to English. Error wins, then undefined data is unread.

export type AppearanceLanguagePhase = 'unread' | 'failed' | 'ready';

export interface AppearanceLanguageSource {
  language?: string | null;
  resolvedLanguage?: string | null;
  isInitialized?: boolean;
  isError?: boolean;
  status?: string;
}

export interface AppearanceLanguageSnapshot {
  data?: string | null;
  isError?: boolean;
  status?: string;
}

export function appearanceLanguageSnapshot(
  source: AppearanceLanguageSource,
): AppearanceLanguageSnapshot {
  if (source.status === 'error' || source.isError === true) {
    const stale = source.resolvedLanguage ?? source.language;
    return {
      data: stale === undefined ? undefined : stale,
      isError: source.isError,
      status: 'error',
    };
  }
  if (source.status === 'pending' || source.isInitialized !== true) {
    return { data: undefined, isError: source.isError, status: 'pending' };
  }
  const value = source.resolvedLanguage ?? source.language;
  return {
    data: value === undefined ? null : value,
    isError: false,
    status: 'success',
  };
}

export function appearanceLanguagePhase(
  snapshot: AppearanceLanguageSnapshot,
): AppearanceLanguagePhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
