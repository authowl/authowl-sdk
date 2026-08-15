// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// useSubmitAction pulls the localized server-error mapper from the i18n module;
// stub it to the fallback so the hook can run without provider context.
vi.mock('../i18n', () => ({
  useServerError: () => (_error: unknown, fallback: string) => fallback,
}));

import { useSubmitAction } from './use-submit-action';

describe('useSubmitAction keepPendingOnSuccess', () => {
  it('keeps pending true after a successful action when the flag is set', async () => {
    const { result } = renderHook(() => useSubmitAction());
    await act(async () => {
      await result.current.run(async () => ({ data: { ok: true }, error: null }), {
        failure: 'failed',
        keepPendingOnSuccess: true,
      });
    });
    // The redirect-out action succeeded; the spinner persists through navigation.
    expect(result.current.pending).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('resets pending after a successful action by default', async () => {
    const { result } = renderHook(() => useSubmitAction());
    await act(async () => {
      await result.current.run(async () => ({ data: { ok: true }, error: null }), {
        failure: 'failed',
      });
    });
    expect(result.current.pending).toBe(false);
  });

  it('resets pending on an error result even with keepPendingOnSuccess', async () => {
    const { result } = renderHook(() => useSubmitAction());
    await act(async () => {
      await result.current.run(async () => ({ data: null, error: { code: 'NOPE' } }), {
        failure: 'failed',
        keepPendingOnSuccess: true,
      });
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe('failed');
  });

  it('resets pending when the action throws even with keepPendingOnSuccess', async () => {
    const { result } = renderHook(() => useSubmitAction());
    await act(async () => {
      await result.current.run(
        async () => {
          throw new Error('boom');
        },
        { failure: 'failed', keepPendingOnSuccess: true },
      );
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe('failed');
  });
});
