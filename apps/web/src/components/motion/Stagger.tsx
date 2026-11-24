// List wrapper. The cascade used to come from framer-motion; the dashboard
// paints the settled list instead so that chunk is not on the critical path.

import { createElement, type HTMLAttributes, type ReactNode } from 'react';

type As = 'div' | 'li' | 'tr' | 'section' | 'article';

export function StaggerList({
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div {...strip(rest)}>{children}</div>;
}

export function StaggerItem({
  children,
  as = 'div',
  ...rest
}: HTMLAttributes<HTMLElement> & { children: ReactNode; as?: As }) {
  return createElement(as, strip(rest), children);
}

function strip(props: Record<string, unknown>) {
  const dom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (
      key === 'variants' ||
      key === 'initial' ||
      key === 'animate' ||
      key === 'exit' ||
      key === 'transition' ||
      key === 'whileHover' ||
      key === 'whileTap'
    ) {
      continue;
    }
    dom[key] = value;
  }
  return dom;
}
