import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeStore {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const initial: Theme =
  (typeof document !== 'undefined' && (document.documentElement.dataset.theme as Theme)) || 'light';

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: initial,
  setTheme: (theme) => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem('bidstack-theme', theme);
      } catch {
        /* ignore */
      }
    }
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'light' ? 'dark' : 'light'),
}));
