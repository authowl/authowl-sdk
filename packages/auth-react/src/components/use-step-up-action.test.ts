// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The hook reaches the localized server-error mapper through useSubmitAction;
// stub it to the fallback so it can run without provider context.
vi.mock('../i18n', () => ({
  useServerError: () => (_error: unknown, fallback: string) => fallback,
}));

import { SECOND_FACTOR_REQUIRED, useStepUpAction } from './use-step-up-action';

const gated = { data: null, error: { code: SECOND_FACTOR_REQUIRED, status: 403 } };

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
    let answerLate: (result: unknown) => void = () => {};
    const action = vi.fn(() => new Promise((resolve) => {
      answerLate = resolve;
    }));
    const { result } = renderHook(() => useStepUpAction());

    let inFlight: Promise<void>;
    act(() => {
      inFlight = result.current.run(action as never, { failure: 'failed' });
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
});
