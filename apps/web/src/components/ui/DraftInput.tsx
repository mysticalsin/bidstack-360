// Server-backed text input/textarea that won't eat keystrokes.
//
// Wraps useDraftField so a field bound to a debounced server mutation keeps a
// local draft while focused and commits on blur — see useDraftField for the
// failure mode this prevents. Each instance owns its own hook, so these are
// safe to render conditionally (after a parent's loading/empty early returns).

import type { TextareaHTMLAttributes, InputHTMLAttributes } from 'react';

import { useDraftField } from '@/hooks/useDraftField';

type CommonProps = {
  serverValue: string;
  /** Called on blur with the final value when it differs from the server. */
  commit: (next: string) => void;
};

type DraftInputProps = CommonProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onFocus'>;

export function DraftInput({ serverValue, commit, ...rest }: DraftInputProps) {
  const field = useDraftField(serverValue, commit);
  return (
    <input
      {...rest}
      value={field.value}
      onChange={(e) => field.onChange(e.target.value)}
      onFocus={field.onFocus}
      onBlur={field.onBlur}
    />
  );
}

type DraftTextareaProps = CommonProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onBlur' | 'onFocus'>;

export function DraftTextarea({ serverValue, commit, ...rest }: DraftTextareaProps) {
  const field = useDraftField(serverValue, commit);
  return (
    <textarea
      {...rest}
      value={field.value}
      onChange={(e) => field.onChange(e.target.value)}
      onFocus={field.onFocus}
      onBlur={field.onBlur}
    />
  );
}
