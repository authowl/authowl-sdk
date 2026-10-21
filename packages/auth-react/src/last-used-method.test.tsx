// @vitest-environment jsdom
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const read = vi.hoisted(() => vi.fn(() => 'social:google'));
vi.mock('@authowl/core', () => ({ readLastUsedSignInMethod: read }));
vi.mock('./hooks', () => ({ usePublicConfig: () => ({ config: { environmentId: 'project' } }) }));
import { useLastUsedSignInMethod } from './last-used-method';
function Hint() { return <span data-testid="hint">{useLastUsedSignInMethod() ?? 'none'}</span>; }
afterEach(cleanup);
it('keeps storage out of SSR and the first paint, then loads the hint after mount', () => {
  expect(renderToString(<Hint />)).toContain('none');
  expect(read).not.toHaveBeenCalled();
  render(<Hint />);
  expect(read).toHaveBeenCalledWith('project');
  expect(screen.getByTestId('hint').textContent).toBe('social:google');
});
