import { useReducedMotion } from 'framer-motion';
import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: 'blue' | 'jade' | 'amber' | 'purple';
}

export function SpotlightSurface({ children, className, tone = 'blue', ...rest }: Props) {
  const reduced = useReducedMotion();
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const classes = [
    'spotlight-surface',
    `spotlight-${tone}`,
    active && !reduced ? 'is-spotlit' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const style = {
    '--spotlight-x': `${position.x}px`,
    '--spotlight-y': `${position.y}px`,
  } as CSSProperties;

  return (
    <div
      className={classes}
      style={style}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      onPointerMove={(event) => {
        if (reduced) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
