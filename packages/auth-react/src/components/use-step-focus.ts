'use client';
import * as React from 'react';
import { FOCUSABLE } from './focusable';

/** Focus changed, settled steps only after an earlier settled render. */
export function useStepFocus(step: string, settled: boolean) {
  const state = React.useRef({
    step,
    settled: false,
    root: null as HTMLElement | null,
    opener: null as string | null,
    returning: false,
  }).current;

  React.useEffect(() => {
    const shouldFocus = state.step !== step && settled && state.settled;
    state.step = step;
    state.settled ||= settled;
    if (!shouldFocus) return;
    const root = state.root;
    if (!root) return;
    let target: HTMLElement | null = null;
    if (state.returning) {
      target = state.opener ? document.getElementById(state.opener) : null;
      target ??= root.querySelector<HTMLInputElement>('input[type="email"]');
      state.returning = false;
      state.opener = null;
    }
    target ??= root.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6');
    target ??= root.querySelector<HTMLElement>(FOCUSABLE);
    if (target) {
      if (/^H[1-6]$/.test(target.tagName)) target.tabIndex = -1;
      target.focus();
    }
  }, [step, settled, state]);

  return {
    stepRef: (node: HTMLElement | null) => { state.root = node; },
    rememberOpener: (control: HTMLElement) => { state.opener = control.id || null; },
    restoreFocus: () => { state.returning = true; },
  };
}
