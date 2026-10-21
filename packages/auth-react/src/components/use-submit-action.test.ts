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

it('coalesces a completion and manual submit in the same pending window', async () => {
  const { result } = renderHook(() => useSubmitAction());
  let resolve!: (value: { data: null; error: null }) => void;
  const action = vi.fn(() => new Promise<{ data: null; error: null }>((settle) => { resolve = settle; }));
  await act(async () => {
    const first = result.current.run(action, { failure: 'failed' });
    await result.current.run(action, { failure: 'failed' });
    expect(action).toHaveBeenCalledTimes(1);
    resolve({ data: null, error: null });
    await first;
  });
  expect(result.current.pending).toBe(false);
});

it('commits opted-in success before awaiting the handoff and clears it on the next run', async () => {
  const { result } = renderHook(() => useSubmitAction());
  let finish!: () => void;
  const handoff = new Promise<void>((resolve) => { finish = resolve; });
  let running!: Promise<void>;
  await act(async () => {
    running = result.current.run(async () => ({ data: null, error: null }), {
      failure: 'failed', trackSuccess: true,
      onSuccess: () => {
        expect(result.current.succeeded).toBe(true);
        expect(result.current.pending).toBe(true);
        return handoff;
      },
    });
  });
  expect(result.current.succeeded).toBe(true);
  expect(result.current.pending).toBe(true);
  await act(async () => { finish(); await running; });
  expect(result.current.pending).toBe(false);
  await act(async () => {
    await result.current.run(async () => ({ data: null, error: null }), { failure: 'failed' });
  });
  expect(result.current.succeeded).toBe(false);
});

it.each(['throw', 'reject'] as const)('rolls back success when onSuccess %ss', async (failure) => {
  const { result } = renderHook(() => useSubmitAction());
  let succeededDuringHandoff: boolean | undefined;
  await act(async () => {
    await result.current.run(async () => ({ data: null, error: null }), {
      failure: 'handoff failed', trackSuccess: true,
      onSuccess: () => {
        succeededDuringHandoff = result.current.succeeded;
        if (failure === 'throw') throw new Error('handoff');
        return Promise.reject(new Error('handoff'));
      },
    });
  });
  expect(result.current.succeeded).toBe(false);
  expect(result.current.pending).toBe(false);
  expect(succeededDuringHandoff).toBe(true);
  expect(result.current.error).toBe('handoff failed');
});

it('resets success and pending only for a persisted pageshow', async () => {
  const { result } = renderHook(() => useSubmitAction());
  await act(async () => {
    await result.current.run(async () => ({ data: null, error: null }), {
      failure: 'failed', trackSuccess: true, keepPendingOnSuccess: true,
    });
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
  });
  expect(result.current.succeeded).toBe(true);
  expect(result.current.pending).toBe(true);
  act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  expect(result.current.succeeded).toBe(false);
  expect(result.current.pending).toBe(false);
});
