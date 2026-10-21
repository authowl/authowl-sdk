'use client';
import * as React from 'react';

/**
 * Focus only after a settled step changes. `null` means still settling (config
 * loading, MFA hold being confirmed): the first settled step is the baseline and
 * never takes focus, so mounting a form does not steal the page's focus. Keyed
 * steps recreate their opener by id.
 */
export function useStepFocus(step: string | null) {
  const stepRef = React.useRef<HTMLDivElement>(null);
  const previous = React.useRef(step);
  const opener = React.useRef<string | null>(null);
  const returning = React.useRef(false);

  React.useEffect(() => {
    if (step === null || previous.current === step) return;
    const settled = previous.current !== null;
    previous.current = step;
    if (!settled) return;
    const root = stepRef.current;
    if (!root) return;
    let target: HTMLElement | null = null;
    if (returning.current) {
      target = opener.current ? document.getElementById(opener.current) : null;
      target ??= root.querySelector<HTMLInputElement>('input[type="email"]');
      returning.current = false;
    }
    target ??= root.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6');
    target ??= root.querySelector<HTMLElement>('input, button, select, textarea, a[href]');
    if (target) {
      if (/^H[1-6]$/.test(target.tagName)) target.tabIndex = -1;
      target.focus();
    }
  }, [step]);

  return {
    stepRef,
    rememberOpener: (control: HTMLElement) => { opener.current = control.id || null; },
    restoreFocus: () => { returning.current = true; },
  };
}
