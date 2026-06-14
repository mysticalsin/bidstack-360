// Unified select primitive with built-in accessibility and state support.

import {
  forwardRef,
  useId,
  type SelectHTMLAttributes,
  type ReactNode,
  useState,
  useEffect,
  useRef,
  useMemo,
  useImperativeHandle,
  Children,
  isValidElement,
  Fragment,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Rendered above the select. */
  label?: ReactNode;
  /** Rendered below the select as helper text. */
  helper?: ReactNode;
  /** Rendered below the select as an error message. Sets aria-invalid. */
  error?: ReactNode;
  /** Shows a loading indicator and sets aria-busy. */
  isLoading?: boolean;
  /** Options when not using children. */
  options?: SelectOption[];
  /** Visual size variant. */
  size?: 'sm' | 'md';
  className?: string;
}

const getOptionsFromChildren = (children: ReactNode): SelectOption[] => {
  const list: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      list.push({
        value: String(child.props.value ?? ''),
        label: String(child.props.children ?? ''),
        disabled: child.props.disabled,
      });
    } else if (child.type === Fragment) {
      list.push(...getOptionsFromChildren(child.props.children));
    }
  });
  return list;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      helper,
      error,
      isLoading,
      options,
      size = 'md',
      className,
      disabled,
      children,
      onChange,
      value,
      defaultValue,
      name,
      ...rest
    },
    ref,
  ) => {
    const { t } = useTranslation('common');
    const generatedId = useId();
    const hasError = Boolean(error);
    const selectId = rest.id ?? generatedId;
    const listboxId = `${selectId}-listbox`;
    const errorId = hasError ? `${selectId}-error` : undefined;
    const helperId = helper ? `${selectId}-helper` : undefined;
    const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;
    const shouldReduceMotion = useReducedMotion();

    const parsedOptions = useMemo(() => {
      if (options) return options;
      return getOptionsFromChildren(children);
    }, [options, children]);

    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(() => {
      if (isControlled) return value;
      if (defaultValue !== undefined) return defaultValue;
      return parsedOptions[0]?.value ?? '';
    });

    // WHY: selectedValue drives all rendering; when controlled, `value` prop is
    // authoritative. `internalValue` is only updated by handleSelect in
    // uncontrolled mode, so no effect-based sync is needed.
    const selectedValue = isControlled ? value : internalValue;

    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);

    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const selectRef = useRef<HTMLSelectElement>(null);

    // Forward ref to hidden native select
    useImperativeHandle(ref, () => selectRef.current!);

    const selectedOption = useMemo(() => {
      return parsedOptions.find((o) => o.value === selectedValue) || parsedOptions[0];
    }, [parsedOptions, selectedValue]);

    // Outside click detection
    useEffect(() => {
      if (!isOpen) return;
      const handleOutsideClick = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setIsOpen(false);
        }
      };
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isOpen]);

    // Handle selection and trigger native change event so React listener catches it
    const handleSelect = (val: string) => {
      if (disabled || isLoading) return;
      if (!isControlled) {
        setInternalValue(val);
      }
      setIsOpen(false);

      if (selectRef.current) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          'value',
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(selectRef.current, val);
          const event = new Event('change', { bubbles: true });
          selectRef.current.dispatchEvent(event);
        }
      }
    };

    const getNextEnabledIndex = (index: number, direction: 'up' | 'down') => {
      const len = parsedOptions.length;
      if (len === 0) return -1;
      let next = index;
      for (let i = 0; i < len; i++) {
        next = direction === 'down' ? (next + 1) % len : (next - 1 + len) % len;
        if (!parsedOptions[next]?.disabled) {
          return next;
        }
      }
      return index;
    };

    // Keyboard handlers
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (disabled || isLoading) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setHighlightedIndex(getNextEnabledIndex(-1, 'down'));
          } else {
            setHighlightedIndex((prev) => getNextEnabledIndex(prev, 'down'));
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setHighlightedIndex(getNextEnabledIndex(parsedOptions.length, 'up'));
          } else {
            setHighlightedIndex((prev) => getNextEnabledIndex(prev, 'up'));
          }
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setHighlightedIndex(getNextEnabledIndex(-1, 'down'));
          } else if (highlightedIndex >= 0 && highlightedIndex < parsedOptions.length) {
            const opt = parsedOptions[highlightedIndex];
            if (opt) {
              handleSelect(opt.value);
            }
            triggerRef.current?.focus();
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          triggerRef.current?.focus();
          break;
        case 'Tab':
          setIsOpen(false);
          break;
        default:
          break;
      }
    };

    return (
      <div ref={containerRef} className={cn('flex flex-col gap-1 w-full relative', className)}>
        {label && (
          <label
            id={`${selectId}-label`}
            htmlFor={selectId}
            className="text-xs font-medium text-[var(--fg-secondary)]"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {/* Custom trigger button styled exactly like a premium input */}
          <button
            ref={triggerRef}
            type="button"
            role="combobox"
            id={selectId}
            onClick={() => !disabled && !isLoading && setIsOpen(!isOpen)}
            onKeyDown={handleKeyDown}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-invalid={hasError}
            aria-busy={isLoading}
            aria-describedby={describedBy}
            aria-activedescendant={
              isOpen && highlightedIndex >= 0 ? `${selectId}-opt-${highlightedIndex}` : undefined
            }
            aria-label={rest['aria-label']}
            aria-labelledby={rest['aria-labelledby'] || (label ? `${selectId}-label` : undefined)}
            disabled={disabled || isLoading}
            className={cn(
              'w-full flex items-center justify-between rounded-lg border bg-[var(--surface-card)] text-[var(--fg-primary)] transition-all text-left cursor-pointer',
              'hover:border-[var(--border-strong)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-page)]',
              'disabled:cursor-not-allowed disabled:opacity-60',
              'pointer-coarse:min-h-[44px]',
              size === 'sm' ? 'px-3 py-1 pr-8 text-xs h-8' : 'px-3 py-2 pr-8 text-sm h-10',
              hasError
                ? 'border-[var(--danger)] focus-visible:border-[var(--danger)]'
                : isOpen
                  ? 'border-[var(--brand-primary)] ring-2 ring-[var(--brand-primary)] ring-offset-1 ring-offset-[var(--surface-page)]'
                  : 'border-[var(--border-subtle)] focus-visible:border-[var(--brand-primary)]',
            )}
          >
            <span className="truncate">{selectedOption?.label ?? t('select.placeholder', '—')}</span>
            {/* Chevron indicator */}
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] pointer-events-none">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path
                  d="M2.5 4.5L6 8L9.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>

          {/* Loading spinner */}
          {isLoading && (
            <span className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--brand-primary)]" />
            </span>
          )}

          {/* Hidden native select for standard HTML form & FormData compatibility */}
          <select
            ref={selectRef}
            name={name}
            value={selectedValue}
            onChange={onChange}
            tabIndex={-1}
            aria-hidden="true"
            style={{
              position: 'absolute',
              width: '1px',
              height: '1px',
              padding: '0',
              margin: '-1px',
              overflow: 'hidden',
              clip: 'rect(0, 0, 0, 0)',
              whiteSpace: 'nowrap',
              border: '0',
            }}
            {...rest}
          >
            {parsedOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>

          {/* Custom glassmorphic dropdown list with Framer Motion transitions */}
          <AnimatePresence>
            {isOpen && (
              <motion.ul
                id={listboxId}
                role="listbox"
                aria-label={label ? String(label) : undefined}
                initial={shouldReduceMotion ? false : { opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                transition={
                  shouldReduceMotion ? { duration: 0 } : { duration: 0.15, ease: [0.16, 1, 0.3, 1] }
                }
                className="absolute left-0 mt-1.5 w-full z-50 rounded-lg glass-menu max-h-60 overflow-y-auto p-1.5 focus:outline-none"
              >
                {parsedOptions.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-[var(--fg-muted)] italic">
                    {t('select.noOptions', 'No options')}
                  </li>
                ) : (
                  parsedOptions.map((option, index) => {
                    const isSelected = option.value === selectedValue;
                    const isHighlighted = index === highlightedIndex;

                    return (
                      <li
                        key={option.value}
                        id={`${selectId}-opt-${index}`}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => !option.disabled && handleSelect(option.value)}
                        onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
                        className={cn(
                          'relative flex items-center px-3 py-2 text-sm rounded-md select-none cursor-pointer z-10 bg-transparent transition-colors',
                          option.disabled
                            ? 'opacity-40 cursor-not-allowed'
                            : 'text-[var(--fg-primary)]',
                          isSelected && 'font-medium',
                        )}
                      >
                        {/* Sliding background highlight */}
                        {isHighlighted && (
                          <motion.div
                            layoutId={`${selectId}-highlight`}
                            className="absolute inset-0 bg-[var(--surface-hover)] rounded-md -z-10"
                            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                          />
                        )}

                        <span className="truncate pr-6">{option.label}</span>

                        {isSelected && (
                          <span className="absolute right-3 flex items-center justify-center text-[var(--brand-primary)]">
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        )}
                      </li>
                    );
                  })
                )}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        {hasError && (
          <p id={errorId} className="text-xs text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}
        {helper && !hasError && (
          <p id={helperId} className="text-xs text-[var(--fg-tertiary)]">
            {helper}
          </p>
        )}
      </div>
    );
  },
);

Select.displayName = 'Select';
