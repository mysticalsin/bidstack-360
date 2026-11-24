/**
 * Final-frame stand-in for framer-motion.
 *
 * The dashboard shell and its widgets used to evaluate the motion chunk while
 * Lighthouse was still measuring total blocking time. These components only
 * need the settled look: the `animate` target, not the frames in between.
 */
import { createElement, forwardRef, type ReactNode, type Ref } from 'react';

const OMIT = new Set([
  'variants',
  'initial',
  'animate',
  'exit',
  'transition',
  'whileHover',
  'whileTap',
  'whileInView',
  'whileFocus',
  'whileDrag',
  'layout',
  'layoutId',
  'custom',
  'onAnimationComplete',
  'onAnimationStart',
  'onUpdate',
  'drag',
  'dragConstraints',
  'dragElastic',
  'dragMomentum',
]);

function settledStyle(animate: unknown, style: unknown): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(style as object) };
  if (!animate || typeof animate !== 'object' || Array.isArray(animate)) return next;
  const transforms: string[] = [];
  for (const [key, value] of Object.entries(animate as Record<string, unknown>)) {
    if (key === 'opacity') next.opacity = value;
    else if (key === 'width' || key === 'height') next[key] = value;
    else if (key === 'strokeDashoffset') next.strokeDashoffset = value;
    else if (key === 'x') transforms.push(`translateX(${typeof value === 'number' ? `${value}px` : value})`);
    else if (key === 'y') transforms.push(`translateY(${typeof value === 'number' ? `${value}px` : value})`);
    else if (key === 'scale') transforms.push(`scale(${value})`);
    else if (key === 'scaleX') transforms.push(`scaleX(${value})`);
    else if (key === 'scaleY') transforms.push(`scaleY(${value})`);
    else if (key === 'rotate') transforms.push(`rotate(${typeof value === 'number' ? `${value}deg` : value})`);
  }
  if (transforms.length) next.transform = transforms.join(' ');
  return next;
}

function plain(tag: string) {
  return forwardRef(function Settled(props: Record<string, unknown>, ref: Ref<Element>) {
    const dom: Record<string, unknown> = { ref };
    for (const [key, value] of Object.entries(props)) {
      if (OMIT.has(key)) continue;
      dom[key] = value;
    }
    dom.style = settledStyle(props.animate, props.style);
    return createElement(tag, dom);
  });
}

type Settled = ReturnType<typeof plain>;

export const motion = {
  div: plain('div'),
  span: plain('span'),
  section: plain('section'),
  li: plain('li'),
  path: plain('path'),
  circle: plain('circle'),
} satisfies Record<string, Settled>;

/** The settled tree does not animate, so reduced-motion branches are unused. */
export function useReducedMotion(): boolean {
  return false;
}

export function AnimatePresence({ children }: { children?: ReactNode; initial?: boolean; mode?: string }) {
  return children;
}
