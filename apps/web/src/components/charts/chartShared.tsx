/**
 * chartShared — private React components shared across all chart variants.
 * Types, constants, and utilities live in chartTypes.ts (plain .ts) so this
 * file stays component-only and satisfies react-refresh/only-export-components.
 */
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import type { DataPoint } from './chartTypes';

// ── DataTable — sr-only accessible fallback for Recharts visualisations ───────

export function DataTable({
  data,
  xKey,
  yKeys,
}: {
  data: DataPoint[];
  xKey: string;
  yKeys: string[];
}) {
  if (data.length === 0) return null;
  return (
    <div className="sr-only">
      <table>
        <thead>
          <tr>
            <th scope="col">{xKey}</th>
            {yKeys.map((k) => (
              <th key={k} scope="col">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <td>{String(row[xKey] ?? '')}</td>
              {yKeys.map((k) => (
                <td key={k}>{String(row[k] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── ChartEnter — framer-motion entrance animation wrapper ─────────────────────

export function ChartEnter({ children, height }: { children: ReactNode; height: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      style={{ height }}
    >
      {children}
    </motion.div>
  );
}
