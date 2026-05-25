// Generic debounce hook for mutations and other callbacks.
// Returns a debounced wrapper and a flush function for imperative save.

import { useCallback, useRef } from 'react';

export function useDebouncedCallback<T extends unknown[]>(
  callback: (...args: T) => void,
  delay: number,
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = useCallback(
    (...args: T) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay],
  );

  const flush = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return { debounced, flush };
}
