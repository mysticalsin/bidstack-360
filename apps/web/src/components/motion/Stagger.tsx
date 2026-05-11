// Stagger container + child wrapper. Used for lists where rows should
// cascade in sequence on mount (contacts table, accounts grid, etc.).
//
// Usage:
//   <StaggerList>
//     {items.map(item => (
//       <StaggerItem key={item.id}>…</StaggerItem>
//     ))}
//   </StaggerList>
//
// The parent animates `initial → animate` with staggerChildren; each child
// participates in that orchestration via its own variants entry.

import { motion, useReducedMotion } from 'framer-motion';
import type { ComponentProps, ReactNode } from 'react';

import { staggerChild, staggerParent } from '@/lib/motion';

interface ContainerProps extends ComponentProps<typeof motion.div> {
  children: ReactNode;
}

export function StaggerList({ children, ...rest }: ContainerProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      variants={reduced ? undefined : staggerParent}
      initial="initial"
      animate="animate"
      {...rest}
    >
      {children}
    </motion.div>
  );
}

interface ItemProps extends ComponentProps<typeof motion.div> {
  children: ReactNode;
  /** Override the element used (defaults to div). Pass `'li'`, `'tr'`, etc.
   *  for semantic correctness inside tables/lists. */
  as?: 'div' | 'li' | 'tr' | 'section' | 'article';
}

export function StaggerItem({ children, as = 'div', ...rest }: ItemProps) {
  const reduced = useReducedMotion();
  const Component = motion[as] as typeof motion.div;
  return (
    <Component variants={reduced ? undefined : staggerChild} {...rest}>
      {children}
    </Component>
  );
}
