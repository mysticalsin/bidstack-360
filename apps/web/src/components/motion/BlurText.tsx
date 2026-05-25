import { useRef, useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

interface BlurTextProps {
  text: string;
  className?: string;
  delay?: number;
  animateBy?: 'words' | 'characters';
  direction?: 'top' | 'bottom' | 'left' | 'right';
  style?: React.CSSProperties;
}

export function BlurText({
  text,
  className = '',
  delay = 0,
  animateBy = 'words',
  direction = 'bottom',
  style,
}: BlurTextProps) {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const items = animateBy === 'words' ? text.split(' ') : text.split('');

  const getOffset = () => {
    switch (direction) {
      case 'top':
        return { x: 0, y: -50 };
      case 'bottom':
        return { x: 0, y: 50 };
      case 'left':
        return { x: -50, y: 0 };
      case 'right':
        return { x: 50, y: 0 };
      default:
        return { x: 0, y: 50 };
    }
  };

  if (reducedMotion) {
    return (
      <span className={className} style={style}>
        {text}
      </span>
    );
  }

  return (
    <div ref={ref} className={className} style={style}>
      {items.map((item, index) => (
        <span
          key={`${animateBy}-${item}-${index}`}
          style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
        >
          <motion.span
            initial={{
              filter: 'blur(10px)',
              opacity: 0,
              ...getOffset(),
            }}
            animate={
              inView
                ? {
                    filter: 'blur(0px)',
                    opacity: 1,
                    x: 0,
                    y: 0,
                  }
                : {
                    filter: 'blur(10px)',
                    opacity: 0,
                    ...getOffset(),
                  }
            }
            transition={{ duration: 0.35, delay: index * (delay / 1000) }}
            style={{ display: 'inline-block' }}
          >
            {item}
          </motion.span>
          {animateBy === 'words' && index < items.length - 1 ? (
            <span style={{ display: 'inline-block' }}>&nbsp;</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
