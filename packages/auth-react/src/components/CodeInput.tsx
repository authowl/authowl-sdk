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
  const normalize = (text: string) => text.replace(/[\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit <= '\u0669' ? 0x0660 : digit <= '\u06f9' ? 0x06f0 : 0xff10)));
  const sanitize = (text: string) => normalize(text).replace(/\D/g, '').slice(0, length);
  const digits = sanitize(value);
  const lastComplete = React.useRef<string | null>(state === 'error' ? digits : null);
  React.useEffect(() => { completion.current = onComplete; }, [onComplete]);

  // Notify only after the controlled value commits, using the latest override.
  React.useEffect(() => {
    if (digits.length < length) lastComplete.current = null;
    if (disabled || readOnly || draft !== null || digits.length !== length || lastComplete.current === digits) return;
    lastComplete.current = digits;
    if (completion.current) completion.current(digits);
    else {
      const form = inputRef.current?.form;
      if (form) {
        if (form.requestSubmit) form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }
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
    replaceFailed.current = false;
    if (next !== digits) onChange(next);
  };

  const onSelect = (input: HTMLInputElement) => {
    if (composing.current || replaceFailed.current && input.selectionStart === 0 && input.selectionEnd === digits.length) return;
    moveToEnd(input);
  };

  // Native select covers programmatic selection without a focus event.
  // Native beforeinput also covers touch keyboards when a full value cannot
  // accept another character after the browser collapses its selection.
  React.useEffect(() => {
    const input = inputRef.current;
    const replace = (event: InputEvent) => {
      if (!replaceFailed.current || composing.current || readOnly || disabled || !event.inputType.startsWith('insert') || event.data === null) return;
      event.preventDefault();
      publish(event.data);
    };
    const select = () => { if (input) onSelect(input); };
    input?.addEventListener('select', select);
    input?.addEventListener('beforeinput', replace);
    return () => {
      input?.removeEventListener('select', select);
      input?.removeEventListener('beforeinput', replace);
    };
  });

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
        onClick={(event) => moveToEnd(event.currentTarget)}
        onSelect={(event) => onSelect(event.currentTarget)}
        onKeyDown={(event) => {
          if (composing.current || readOnly || disabled) return;
          if (replaceFailed.current && (event.key.length === 1 && sanitize(event.key).length === 1 || event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            publish(event.key === 'Backspace' || event.key === 'Delete' ? '' : event.key);
            return;
          }
          if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            moveToEnd(event.currentTarget);
          } else if (event.key === 'Delete') event.preventDefault();
        }}
        onChange={(event) => {
          if (composing.current) setDraft(event.target.value);
          else {
            const input = event.nativeEvent as InputEvent;
            publish(replaceFailed.current && input.inputType === 'insertText' && input.data !== null ? input.data : event.target.value);
          }
        }}
        onCompositionStart={(event) => { composing.current = true; setDraft(event.currentTarget.value); }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setDraft(null);
          publish(replaceFailed.current && event.data ? event.data : event.currentTarget.value);
          moveToEnd(event.currentTarget);
        }}
        onPaste={(event) => {
          event.preventDefault();
          if (readOnly) return;
          const pasted = sanitize(event.clipboardData.getData('text'));
          const next = replaceFailed.current || pasted.length >= length ? pasted : digits + pasted;
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
