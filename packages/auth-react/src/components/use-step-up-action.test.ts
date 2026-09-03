// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthActionResult } from '@authowl/core';

// The hook reaches the localized server-error mapper through useSubmitAction;
// stub it to the fallback so it can run without provider context.
vi.mock('../i18n', () => ({
  useServerError: () => (_error: unknown, fallback: string) => fallback,
}));

import { SECOND_FACTOR_REQUIRED, useStepUpAction } from './use-step-up-action';

const gated: AuthActionResult<null> = {
  data: null,
  error: { code: SECOND_FACTOR_REQUIRED, status: 403 },
};

describe('useStepUpAction', () => {
  it('parks a gated attempt and replays it verbatim on resume', async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce(gated)
      .mockResolvedValueOnce({ data: { status: true }, error: null });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useStepUpAction());

    await act(async () => {
      await result.current.run(action, { failure: 'failed', onSuccess });
    });

    // The gate is answered with a prompt, not an error message.
    expect(result.current.stepUpRequired).toBe(true);
    expect(result.current.error).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      result.current.resume();
    });

    expect(action).toHaveBeenCalledTimes(2);
    expect(result.current.stepUpRequired).toBe(false);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('surfaces every other failure as an ordinary message', async () => {
    const { result } = renderHook(() => useStepUpAction());

    await act(async () => {
      await result.current.run(
        async () => ({ data: null, error: { code: 'INVALID_PASSWORD', status: 401 } }),
        { failure: 'failed' },
      );
    });

    expect(result.current.stepUpRequired).toBe(false);
    expect(result.current.error).toBe('failed');
  });

  it("lets a caller's own interceptor handle the codes this hook does not", async () => {
    const intercept = vi.fn(() => true);
    const { result } = renderHook(() => useStepUpAction());

    await act(async () => {
      await result.current.run(
        async () => ({ data: null, error: { code: 'SOMETHING_ELSE', status: 400 } }),
        { failure: 'failed', intercept },
      );
    });

    expect(intercept).toHaveBeenCalledOnce();
    // Claimed by the caller, so no message and no prompt.
    expect(result.current.error).toBeNull();
    expect(result.current.stepUpRequired).toBe(false);
  });

  it('does not prompt for an attempt the caller abandoned mid-flight', async () => {
    // MfaSection disables its own cancel while a request is open, so this race
    // is unreachable there - but the hook is public API and a consumer whose
    // cancel stays enabled would otherwise be dropped into a code prompt for an
    // action they already backed out of.
    let answerLate: (result: AuthActionResult<null>) => void = () => {};
    const action = vi.fn(() => new Promise<AuthActionResult<null>>((resolve) => {
      answerLate = resolve;
    }));
    const { result } = renderHook(() => useStepUpAction());

    let inFlight: Promise<void>;
    act(() => {
      inFlight = result.current.run(action, { failure: 'failed' });
    });
    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      answerLate(gated);
      await inFlight;
    });

    expect(result.current.stepUpRequired).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('replays once even if resume is called twice in the same tick', async () => {
    // Not reachable from MfaSection (the prompt unmounts on the first call) but
    // `resume` is public API, and a second send of generateBackupCodes rotates
    // the codes AGAIN - retiring the set the user has just written down.
    const action = vi
      .fn()
      .mockResolvedValueOnce(gated)
      .mockResolvedValue({ data: { status: true }, error: null });
    const { result } = renderHook(() => useStepUpAction());

    await act(async () => {
      await result.current.run(action, { failure: 'failed' });
    });
    await act(async () => {
      result.current.resume();
      result.current.resume();
    });

    // One gated call, one replay. Not two replays.
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('drops the parked attempt on cancel so nothing can replay it', async () => {
    const action = vi.fn().mockResolvedValue(gated);
    const { result } = renderHook(() => useStepUpAction());

    await act(async () => {
      await result.current.run(action, { failure: 'failed' });
    });
    expect(result.current.stepUpRequired).toBe(true);

    await act(async () => {
      result.current.cancel();
    });
    await act(async () => {
      result.current.resume();
    });

    // Still one call: cancel released the attempt, so resume has nothing to send.
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.stepUpRequired).toBe(false);
  });
  it('refuses a second gated attempt instead of losing the first', async () => {
    // One slot. Overwriting it would drop the first action with no error, no
    // prompt and no replay - work the user asked for, gone silently. The second
    // gets the server's own message instead, while the first keeps the prompt.
    const first = vi.fn().mockResolvedValue(gated);
    const second = vi.fn().mockResolvedValue(gated);
    const { result } = renderHook(() => useStepUpAction());

    await act(async () => {
      await result.current.run(first, { failure: 'first failed' });
    });
    await act(async () => {
      await result.current.run(second, { failure: 'second failed' });
    });

    expect(result.current.stepUpRequired).toBe(true);
    // Refused, and said so - not swallowed.
    expect(result.current.error).toBe('second failed');

    const firstSucceeds = vi.fn();
    await act(async () => {
      result.current.resume();
    });

    // The attempt that owns the prompt is the one that replays.
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
    expect(firstSucceeds).not.toHaveBeenCalled();
  });

  it('reopens the prompt when the replay is gated again', async () => {
    // The window can lapse between entering a code and the replay landing.
    const action = vi
      .fn()
      .mockResolvedValueOnce(gated)
      .mockResolvedValueOnce(gated)
      .mockResolvedValue({ data: { status: true }, error: null });
    const { result } = renderHook(() => useStepUpAction());

    await act(async () => {
      await result.current.run(action, { failure: 'failed' });
    });
    await act(async () => {
      result.current.resume();
    });

    // Asked again, cleanly - not left on a stale error with no way forward.
    expect(result.current.stepUpRequired).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      result.current.resume();
    });
    expect(action).toHaveBeenCalledTimes(3);
    expect(result.current.stepUpRequired).toBe(false);
  });
});
