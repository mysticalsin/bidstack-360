import { useEffect, useState } from 'react';

/**
 * Wires a `.tab-scroll` tab strip: sets `data-fade-start` / `data-fade-end`
 * while tabs are hidden past either edge (the CSS draws the fade), and keeps
 * the selected tab in view when the selection changes. Returns a callback
 * ref, so a strip that mounts after a loading state is still picked up.
 */
export function useScrollableTabs<T extends HTMLElement = HTMLDivElement>(selectedKey: string) {
  const [el, setEl] = useState<T | null>(null);

  useEffect(() => {
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.toggleAttribute('data-fade-start', el.scrollLeft > 1);
      el.toggleAttribute('data-fade-end', max > 1 && el.scrollLeft < max - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [el]);

  useEffect(() => {
    const tab = el?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!el || !tab || el.scrollWidth <= el.clientWidth) return;
    const left = tab.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    if (left < el.scrollLeft || left + tab.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: Math.max(0, left - 16) });
    }
  }, [el, selectedKey]);

  return setEl;
}
