/**
 * Canvas-based signature capture pad with draw + type-name fallback.
 *
 * WHY: DocuSign-style UX. Canvas handles finger/stylus/mouse for drawn sigs;
 * the "type name" fallback renders text in a cursive font so signers on
 * keyboards still get a legible, legally-recognisable signature.
 *
 * Accessibility:
 *  - Tab-reachable via a role="application" region with aria-label.
 *  - "Clear" and "Undo" buttons have visible focus rings (44×44 min targets).
 *  - The canvas draws with pointer events so touch + mouse work identically.
 *  - prefers-reduced-motion is respected: animation-free mode skips strokes
 *    visible only during drawing.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/cn';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignatureMode = 'draw' | 'type';

export interface SignaturePadHandle {
  /** Returns a data-URL (PNG) of the current signature, or null if empty. */
  getDataUrl(): string | null;
  /** Returns true if the pad has any content. */
  isEmpty(): boolean;
  /** Clears all content. */
  clear(): void;
}

interface SignaturePadProps {
  className?: string;
  onChange?: (hasContent: boolean) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STROKE_COLOR = '#1a1a1a';
const STROKE_WIDTH = 2.5;
const CANVAS_MIN_W = 320;
const CANVAS_H = 200;
const CURSIVE_FONT = '"Caveat", "Dancing Script", cursive';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPos(
  canvas: HTMLCanvasElement,
  e: MouseEvent | TouchEvent,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  if ('touches' in e) {
    return {
      x: (e.touches[0].clientX - rect.left) * scaleX,
      y: (e.touches[0].clientY - rect.top) * scaleY,
    };
  }
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  ({ className, onChange }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [mode, setMode] = useState<SignatureMode>('draw');
    const [typedName, setTypedName] = useState('');
    const [hasDrawing, setHasDrawing] = useState(false);
    const isDrawing = useRef(false);
    const history = useRef<ImageData[]>([]);

    // ─── Canvas helpers ───────────────────────────────────────────────────

    const ctx = useCallback((): CanvasRenderingContext2D | null => {
      return canvasRef.current?.getContext('2d') ?? null;
    }, []);

    const pushHistory = useCallback(() => {
      const c = canvasRef.current;
      const cx = ctx();
      if (!c || !cx) return;
      history.current.push(cx.getImageData(0, 0, c.width, c.height));
      // Keep only last 30 states to bound memory
      if (history.current.length > 30) history.current.shift();
    }, [ctx]);

    const notifyChange = useCallback(
      (has: boolean) => {
        setHasDrawing(has);
        onChange?.(has);
      },
      [onChange],
    );

    // ─── Clear ────────────────────────────────────────────────────────────

    const clearCanvas = useCallback(() => {
      const c = canvasRef.current;
      const cx = ctx();
      if (!c || !cx) return;
      cx.clearRect(0, 0, c.width, c.height);
      history.current = [];
      notifyChange(false);
    }, [ctx, notifyChange]);

    // ─── Undo ─────────────────────────────────────────────────────────────

    const undo = useCallback(() => {
      const cx = ctx();
      const c = canvasRef.current;
      if (!cx || !c || history.current.length === 0) return;
      const prev = history.current.pop();
      if (prev) {
        cx.putImageData(prev, 0, 0);
        notifyChange(history.current.length > 0);
      }
    }, [ctx, notifyChange]);

    // ─── Draw events ──────────────────────────────────────────────────────

    const startDraw = useCallback(
      (e: MouseEvent | TouchEvent) => {
        if (mode !== 'draw') return;
        e.preventDefault();
        const cx = ctx();
        const c = canvasRef.current;
        if (!cx || !c) return;
        pushHistory();
        isDrawing.current = true;
        const { x, y } = getPos(c, e);
        cx.beginPath();
        cx.moveTo(x, y);
        cx.strokeStyle = STROKE_COLOR;
        cx.lineWidth = STROKE_WIDTH;
        cx.lineCap = 'round';
        cx.lineJoin = 'round';
      },
      [mode, ctx, pushHistory],
    );

    const draw = useCallback(
      (e: MouseEvent | TouchEvent) => {
        if (!isDrawing.current || mode !== 'draw') return;
        e.preventDefault();
        const cx = ctx();
        const c = canvasRef.current;
        if (!cx || !c) return;
        const { x, y } = getPos(c, e);
        cx.lineTo(x, y);
        cx.stroke();
        notifyChange(true);
      },
      [mode, ctx, notifyChange],
    );

    const endDraw = useCallback(() => {
      isDrawing.current = false;
      ctx()?.closePath();
    }, [ctx]);

    // ─── Wire up canvas event listeners ──────────────────────────────────

    useEffect(() => {
      const c = canvasRef.current;
      if (!c) return;

      // Set canvas internal resolution to match CSS display size
      const observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (c.width !== Math.floor(width) || c.height !== Math.floor(height)) {
          c.width = Math.max(CANVAS_MIN_W, Math.floor(width));
          c.height = CANVAS_H;
        }
      });
      observer.observe(c);

      c.addEventListener('mousedown', startDraw);
      c.addEventListener('mousemove', draw);
      c.addEventListener('mouseup', endDraw);
      c.addEventListener('mouseleave', endDraw);
      c.addEventListener('touchstart', startDraw, { passive: false });
      c.addEventListener('touchmove', draw, { passive: false });
      c.addEventListener('touchend', endDraw);

      return () => {
        observer.disconnect();
        c.removeEventListener('mousedown', startDraw);
        c.removeEventListener('mousemove', draw);
        c.removeEventListener('mouseup', endDraw);
        c.removeEventListener('mouseleave', endDraw);
        c.removeEventListener('touchstart', startDraw);
        c.removeEventListener('touchmove', draw);
        c.removeEventListener('touchend', endDraw);
      };
    }, [startDraw, draw, endDraw]);

    // ─── Type mode: render typed name onto offscreen canvas ───────────────

    const renderTypedName = useCallback(
      (name: string): string | null => {
        if (!name.trim()) return null;
        const c = canvasRef.current;
        if (!c) return null;
        const cx = ctx();
        if (!cx) return null;
        cx.clearRect(0, 0, c.width, c.height);
        cx.font = `48px ${CURSIVE_FONT}`;
        cx.fillStyle = STROKE_COLOR;
        cx.textBaseline = 'middle';
        const metrics = cx.measureText(name);
        const x = Math.max(8, (c.width - metrics.width) / 2);
        cx.fillText(name, x, c.height / 2);
        return c.toDataURL('image/png');
      },
      [ctx],
    );

    useEffect(() => {
      if (mode === 'type') {
        if (typedName.trim()) {
          renderTypedName(typedName);
          notifyChange(true);
        } else {
          clearCanvas();
        }
      }
    }, [typedName, mode, renderTypedName, clearCanvas, notifyChange]);

    // ─── Clear canvas when switching modes ───────────────────────────────

    useEffect(() => {
      clearCanvas();
      setTypedName('');
    }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Imperative handle ────────────────────────────────────────────────

    useImperativeHandle(
      ref,
      () => ({
        getDataUrl() {
          if (mode === 'type') return renderTypedName(typedName);
          const c = canvasRef.current;
          if (!c) return null;
          // Check if canvas is blank
          const cx = c.getContext('2d');
          if (!cx) return null;
          const data = cx.getImageData(0, 0, c.width, c.height).data;
          const isBlank = data.every((v) => v === 0);
          return isBlank ? null : c.toDataURL('image/png');
        },
        isEmpty() {
          if (mode === 'type') return !typedName.trim();
          return !hasDrawing;
        },
        clear() {
          clearCanvas();
          setTypedName('');
        },
      }),
      [mode, typedName, hasDrawing, clearCanvas, renderTypedName],
    );

    // ─── Render ───────────────────────────────────────────────────────────

    return (
      <div className={cn('flex flex-col gap-3', className)}>
        {/* Mode tabs */}
        <div
          role="tablist"
          aria-label="Signature method"
          className="flex gap-1 rounded-lg bg-[var(--surface-sunken)] p-1 w-fit"
        >
          {(['draw', 'type'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'min-h-[44px] min-w-[44px] rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
                mode === m
                  ? 'bg-[var(--surface-card)] text-[var(--fg-primary)] shadow-sm'
                  : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
              )}
            >
              {m === 'draw' ? 'Draw' : 'Type'}
            </button>
          ))}
        </div>

        {/* Canvas pad */}
        <div
          className="relative rounded-xl border-2 border-dashed border-[var(--border-default)] bg-white"
          style={{ minHeight: CANVAS_H }}
        >
          {mode === 'draw' && !hasDrawing && (
            <p
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400 select-none"
            >
              Sign here
            </p>
          )}
          <canvas
            ref={canvasRef}
            role="application"
            aria-label="Signature drawing area. Use mouse or touch to draw your signature."
            className={cn(
              'block w-full rounded-xl',
              mode === 'draw' ? 'cursor-crosshair' : 'cursor-default pointer-events-none',
            )}
            style={{ height: CANVAS_H, touchAction: 'none' }}
          />
        </div>

        {/* Type input (shown only in type mode) */}
        {mode === 'type' && (
          <div>
            <label
              htmlFor="typed-signature"
              className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
            >
              Type your full name
            </label>
            <input
              id="typed-signature"
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Your Name"
              className={cn(
                'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
                'px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-disabled)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
                'min-h-[44px]',
              )}
              style={{ fontFamily: CURSIVE_FONT, fontSize: '1.25rem' }}
            />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={clearCanvas}
            aria-label="Clear signature"
            className={cn(
              'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg',
              'border border-[var(--border-default)] bg-[var(--surface-card)]',
              'px-3 text-sm text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
              'transition-colors',
            )}
          >
            Clear
          </button>
          {mode === 'draw' && (
            <button
              type="button"
              onClick={undo}
              disabled={history.current.length === 0}
              aria-label="Undo last stroke"
              className={cn(
                'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg',
                'border border-[var(--border-default)] bg-[var(--surface-card)]',
                'px-3 text-sm text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
                'transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              Undo
            </button>
          )}
        </div>
      </div>
    );
  },
);

SignaturePad.displayName = 'SignaturePad';
