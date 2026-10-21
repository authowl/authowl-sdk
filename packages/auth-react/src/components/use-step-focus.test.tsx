// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSlot } from '../elements';
import { useStepFocus } from './use-step-focus';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Step({ step }: { step: string }) {
  const slot = useSlot();
  const { stepRef } = useStepFocus(step, true);
  return <div ref={stepRef}>
    <h2 className={slot('ba-title')}>Heading</h2>
    <button>First control</button>
    <input aria-label="Second control" />
  </div>;
}

it('falls back to the first focusable control when a display:none heading cannot take focus', () => {
  const view = render(<Step step="form" />);
  const heading = screen.getByRole('heading');
  heading.style.display = 'none';
  // JSDOM has no layout and allows focus on display:none elements. Model the
  // browser refusing that focus, then exercise the hook's activeElement check.
  const focus = vi.spyOn(heading, 'focus').mockImplementation(() => {});
  view.rerender(<Step step="confirmation" />);
  expect(getComputedStyle(heading).display).toBe('none');
  expect(focus).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First control' }));
});
