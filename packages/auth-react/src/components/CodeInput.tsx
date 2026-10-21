'use client';
import * as React from 'react';
import { useSlot } from '../elements';
import { codeIconAttributes } from './factor-icons';

type CodeInputProps = Pick<React.InputHTMLAttributes<HTMLInputElement>,
  'id' | 'name' | 'aria-label' | 'aria-labelledby' | 'aria-describedby'> & {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  onComplete?: (value: string) => void;
  state?: 'idle' | 'error' | 'success';
  readOnly?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
};

/** One autofill target over decorative cells. Internal, never a package export. */
export function CodeInput({ value, onChange, length = 6, onComplete, state = 'idle', readOnly, disabled, autoFocus, ...label }: CodeInputProps) {
  const slot = useSlot();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const completion = React.useRef(onComplete);
  const composing = React.useRef(false);
  const replaceFailed = React.useRef(false);
  const [draft, setDraft] = React.useState<string | null>(null);
  const sanitize = (text: string) => text.replace(/\D/g, '').slice(0, length);
  const digits = sanitize(value);
  const lastComplete = React.useRef<string | null>(state === 'error' ? digits : null);
  React.useEffect(() => { completion.current = onComplete; }, [onComplete]);

  // Notify only after the controlled value commits, using the latest override.
  React.useEffect(() => {
    if (digits.length < length) lastComplete.current = null;
    if (disabled || readOnly || draft !== null || digits.length !== length || lastComplete.current === digits) return;
    lastComplete.current = digits;
    if (completion.current) completion.current(digits);
    else inputRef.current?.form?.requestSubmit();
  }, [digits, length, disabled, readOnly, draft]);

  React.useEffect(() => {
    if (state === 'error') {
      replaceFailed.current = true;
      inputRef.current?.select();
    }
  }, [state]);

  const moveToEnd = (input: HTMLInputElement) => {
    const end = input.value.length;
    if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
  };
  const publish = (text: string) => {
    const next = sanitize(text);
    if (next !== digits) {
      replaceFailed.current = false;
      onChange(next);
    }
  };

  return (
    <span className={slot('ba-code-input')} dir="ltr" data-state={state}
      style={{ '--ao-code-length': length } as React.CSSProperties}>
      <span key={state} className={slot('ba-code-cells')} aria-hidden="true">
        {Array.from({ length }, (_, index) => (
          <span key={index} className={slot('ba-code-cell')} aria-hidden="true"
            data-current={!disabled && index === Math.min(digits.length, length - 1) || undefined}>{digits[index]}</span>
        ))}
      </span>
      <input {...label} ref={inputRef} className={slot('ba-code-control')} type="text" inputMode="numeric"
        autoComplete="one-time-code" pattern="[0-9]*" maxLength={length} minLength={length} required
        value={draft ?? digits} readOnly={readOnly} disabled={disabled} autoFocus={autoFocus} aria-invalid={state === 'error' || undefined}
        onFocus={(event) => moveToEnd(event.currentTarget)}
        onClick={(event) => { replaceFailed.current = false; moveToEnd(event.currentTarget); }}
        onSelect={(event) => {
          const input = event.currentTarget;
          if (composing.current || replaceFailed.current && input.selectionStart === 0 && input.selectionEnd === digits.length) return;
          moveToEnd(input);
        }}
        onKeyDown={(event) => {
          if (composing.current) return;
          if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            replaceFailed.current = false;
            moveToEnd(event.currentTarget);
          } else if (event.key === 'Delete') event.preventDefault();
        }}
        onChange={(event) => {
          if (composing.current) setDraft(event.target.value);
          else publish(event.target.value);
        }}
        onCompositionStart={(event) => { composing.current = true; setDraft(event.currentTarget.value); }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setDraft(null);
          publish(event.currentTarget.value);
          moveToEnd(event.currentTarget);
        }}
        onPaste={(event) => {
          event.preventDefault();
          if (readOnly) return;
          const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
          const next = pasted.length >= length ? pasted : digits + pasted;
          if (composing.current) setDraft(sanitize(next));
          else publish(next);
        }} />
    </span>
  );
}

export function CodeSuccess() {
  const slot = useSlot();
  return <svg {...codeIconAttributes} className={slot('ba-code-check')} width="16" height="16">
    <path className={slot('ba-code-check-path')} d="m5 12 4 4L19 6" pathLength="1" />
  </svg>;
}
