// Returns a copy of `value` that only updates after it has stopped changing
// for `delay` ms. Use to throttle query-key churn so a server search fires
// once the user pauses typing, not on every keystroke.

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
