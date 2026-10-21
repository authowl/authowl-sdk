'use client';
import * as React from 'react';
import { useSlot } from '../elements';

type CodeInputProps = Pick<React.InputHTMLAttributes<HTMLInputElement>,
  'id' | 'name' | 'aria-label' | 'aria-labelledby' | 'aria-describedby'> & {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  onComplete?: (value: string) => void;
  state?: 'idle' | 'error' | 'success';
  disabled?: boolean;
  autoFocus?: boolean;
};

/** One autofill target over decorative cells. Internal, never a package export. */
export function CodeInput({ value, onChange, length = 6, onComplete, state = 'idle', disabled, autoFocus, ...label }: CodeInputProps) {
  const slot = useSlot();
  const [focused, setFocused] = React.useState(false);
  const digits = value.replace(/\D/g, '').slice(0, length);
  const lastComplete = React.useRef<string | null>(state === 'error' ? digits : null);
  const previous = React.useRef(value);

  // Run after the controlled value commits, so requestSubmit sees the last digit.
  // Keep the notification across pending/error rerenders and StrictMode effects.
  React.useEffect(() => {
    if (previous.current !== value) lastComplete.current = null;
    previous.current = value;
    if (disabled || digits.length !== length || lastComplete.current === digits) return;
    lastComplete.current = digits;
    onComplete?.(digits);
  }, [value, digits, length, disabled, onComplete]);

  return (
    <span className={slot('ba-code-input')} dir="ltr" data-state={state} data-disabled={disabled || undefined}>
      <span key={state} className={slot('ba-code-cells')} aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
        {Array.from({ length }, (_, index) => (
          <span key={index} className={slot('ba-code-cell')} aria-hidden="true"
            data-current={focused && !disabled && index === Math.min(digits.length, length - 1) || undefined}
            style={{ animationDelay: `calc(var(--ao-duration-fast) / 3 * ${index})` }}>{digits[index]}</span>
        ))}
      </span>
      <input {...label} className={slot('ba-code-control')} type="text" inputMode="numeric"
        autoComplete="one-time-code" pattern="[0-9]*" maxLength={length} minLength={length} required
        value={digits} disabled={disabled} autoFocus={autoFocus} aria-invalid={state === 'error' || undefined}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(event) => { if (!disabled) onChange(event.target.value.replace(/\D/g, '').slice(0, length)); }}
        onPaste={(event) => {
          event.preventDefault();
          if (disabled) return;
          const input = event.currentTarget;
          const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
          onChange((digits.slice(0, input.selectionStart ?? 0) + pasted + digits.slice(input.selectionEnd ?? digits.length)).slice(0, length));
        }} />
    </span>
  );
}

export function CodeSuccess() {
  const slot = useSlot();
  return <svg className={slot('ba-code-check')} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path className={slot('ba-code-check-path')} d="m5 12 4 4L19 6" pathLength="1" />
  </svg>;
}
