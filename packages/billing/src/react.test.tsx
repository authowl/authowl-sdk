// @vitest-environment jsdom
import type { AuthOwlClient } from '@authowl/core';
import { act } from 'react';
import * as React from 'react';
import { cleanup, render } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBillingClient } from './index';
import {
  Protect,
  useBillingClient,
  useEntitlements,
  type UseEntitlementsResult,
} from './react';
import {
  ALLOWED_LIST,
  deferred,
  makeCore,
  NOW,
  ok,
  sessionState,
  setVisibility,
  settle,
  USER_ID,
  type WireReply,
} from './test-fixtures';

let currentCore: AuthOwlClient;
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000004';

vi.mock('@authowl/react', () => ({
  useAuthClient: () => currentCore,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setVisibility('visible');
});

afterEach(async () => {
  cleanup();
  await settle();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Gate({ feature = 'reports' }: { feature?: string }) {
  return (
    <Protect feature={feature} fallback={<p>fallback</p>}>
      <p>children</p>
    </Protect>
  );
}

async function settleReact(): Promise<void> {
  await act(async () => settle());
}

describe('billing React entry', () => {
  it('renders children for a ready, fresh, granted snapshot', async () => {
    const fixture = makeCore();
    currentCore = fixture.core;
    const view = render(<Gate />);
    await settleReact();
    expect(view.container.textContent).toContain('children');
    expect(view.queryByText('fallback')).toBeNull();
  });

  it('reports loading on the server and first client frame until ready after mount', async () => {
    const fixture = makeCore();
    currentCore = fixture.core;
    const frames: Array<{ isLoading: boolean; has: boolean }> = [];
    function Probe() {
      const value = useEntitlements();
      const frame = { isLoading: value.isLoading, has: value.has({ feature: 'reports' }) };
      frames.push(frame);
      return <output>{`${frame.isLoading}:${frame.has}`}</output>;
    }

    expect(renderToString(<Probe />)).toContain('true:false');
    frames.length = 0;
    render(<Probe />);
    expect(frames[0]).toEqual({ isLoading: true, has: false });
    await settleReact();
    expect(frames.at(-1)).toEqual({ isLoading: false, has: true });
  });

  it.each([
    ['session pending', () => makeCore({ state: sessionState(null, null, { pending: true }) }), 'reports'],
    ['identity request pending', () => makeCore({ handler: () => deferred<WireReply>().promise }), 'reports'],
    ['request error', () => makeCore({ replies: [{ status: 500 }] }), 'reports'],
    ['signed out', () => makeCore({ state: sessionState(null, null) }), 'reports'],
    ['pending MFA enrollment', () => makeCore({
      state: sessionState(USER_ID, null, { pendingMfa: true }),
    }), 'reports'],
    ...(['not_connected', 'no_customer', 'erased', 'no_organization'] as const).map((status) => [
      `${status} reason`,
      () => makeCore({ replies: [ok({ ...ALLOWED_LIST, status })] }),
      'reports',
    ] as const),
    ['denied row', () => makeCore({ replies: [ok({
      ...ALLOWED_LIST,
      entitlements: [{ ...ALLOWED_LIST.entitlements[0], allowed: false }],
    })] }), 'reports'],
    ['unknown feature', () => makeCore(), 'exports'],
  ] as const)('renders fallback when only %s changes', async (_name, build, feature) => {
    const fixture = build();
    currentCore = fixture.core;
    const view = render(<Gate feature={feature} />);
    await settleReact();
    expect(view.queryByText('fallback')).not.toBeNull();
    expect(view.queryByText('children')).toBeNull();
  });

  it('renders fallback when a refresh stays pending past the stale boundary', async () => {
    const pending = deferred<WireReply>();
    const fixture = makeCore({
      handler: vi.fn()
        .mockResolvedValueOnce(ok(ALLOWED_LIST))
        .mockImplementationOnce(() => pending.promise),
    });
    currentCore = fixture.core;
    const view = render(<Gate />);
    await settleReact();
    expect(view.queryByText('children')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(view.queryByText('fallback')).not.toBeNull();
    expect(view.queryByText('children')).toBeNull();
    pending.resolve({ status: 500 });
    await settleReact();
  });

  it('server-renders fallback and hydrates to children without a mismatch', async () => {
    const fixture = makeCore();
    currentCore = fixture.core;
    const tree = <Gate />;
    const markup = renderToString(tree);
    expect(markup).toContain('fallback');
    expect(markup).not.toContain('children');

    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    expect(billing.has({ feature: 'reports' })).toBe(true);

    const container = document.createElement('div');
    container.innerHTML = markup;
    document.body.append(container);
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError });
      await settle();
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.textContent).toContain('children');
    expect(container.textContent).not.toContain('fallback');
    await act(async () => root?.unmount());
    unsubscribe();
    await settle();
    container.remove();
  });

  it('exposes the client snapshot and keeps the result stable without a store change', async () => {
    const fixture = makeCore();
    currentCore = fixture.core;
    const results: UseEntitlementsResult[] = [];
    const clients: ReturnType<typeof useBillingClient>[] = [];
    function Probe() {
      clients.push(useBillingClient());
      results.push(useEntitlements());
      return null;
    }
    const view = render(<Probe />);
    expect(results.at(-1)).toMatchObject({
      entitlements: [], isLoading: true, isStale: false, reason: null, error: null,
    });
    await settleReact();

    const client = createBillingClient(fixture.core);
    const ready = results.at(-1)!;
    expect(clients.at(-1)).toBe(client);
    expect(ready.entitlements).toBe(client.getSnapshot().entitlements);
    expect(ready).toMatchObject({ isLoading: false, isStale: false, reason: 'ok', error: null });
    expect(ready.has({ feature: 'reports' })).toBe(true);
    expect(ready.refresh).toBe(client.refresh);
    expect(ready.check).toBe(client.check);
    view.rerender(<Probe />);
    expect(results.at(-1)).toBe(ready);
  });

  it('exposes an error snapshot', async () => {
    const fixture = makeCore({ replies: [{ status: 500 }] });
    currentCore = fixture.core;
    let result: UseEntitlementsResult | undefined;
    function Probe() {
      result = useEntitlements();
      return null;
    }
    render(<Probe />);
    await settleReact();
    expect(result).toMatchObject({
      entitlements: [], isLoading: false, isStale: false, reason: null,
    });
    expect(result?.error).not.toBeNull();
  });

  it('turns has false and isStale true in the same stale-boundary render', async () => {
    const fixture = makeCore();
    currentCore = fixture.core;
    const renders: Array<{ has: boolean; isStale: boolean }> = [];
    function Probe() {
      const value = useEntitlements();
      renders.push({ has: value.has({ feature: 'reports' }), isStale: value.isStale });
      return null;
    }
    render(<Probe />);
    await settleReact();
    setVisibility('hidden');
    expect(renders.at(-1)).toEqual({ has: true, isStale: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(renders.at(-1)).toEqual({ has: true, isStale: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(renders.at(-1)).toEqual({ has: false, isStale: true });
  });

  it('recomputes has and isStale together when the clock jumps without timers', async () => {
    const fixture = makeCore();
    currentCore = fixture.core;
    let result: UseEntitlementsResult | undefined;
    function Probe() {
      result = useEntitlements();
      return null;
    }
    const view = render(<Probe />);
    await settleReact();
    setVisibility('hidden');
    expect(result?.has({ feature: 'reports' })).toBe(true);
    expect(result?.isStale).toBe(false);

    vi.setSystemTime(NOW + 60_000);
    view.rerender(<Probe />);
    expect(result?.has({ feature: 'reports' })).toBe(false);
    expect(result?.isStale).toBe(true);
  });

  it('never renders the previous user children after a React-level identity switch', async () => {
    const next = deferred<WireReply>();
    const fixture = makeCore({
      handler: vi.fn()
        .mockResolvedValueOnce(ok(ALLOWED_LIST))
        .mockImplementationOnce(() => next.promise),
    });
    currentCore = fixture.core;
    const childFrames = vi.fn();
    function Children() {
      childFrames();
      return <p>children</p>;
    }
    const view = render(
      <Protect feature="reports" fallback={<p>fallback</p>}>
        <Children />
      </Protect>,
    );
    await settleReact();
    expect(view.queryByText('children')).not.toBeNull();
    childFrames.mockClear();

    act(() => fixture.setSession(OTHER_USER_ID, null));
    expect(childFrames).not.toHaveBeenCalled();
    expect(view.queryByText('fallback')).not.toBeNull();
    next.resolve(ok({ ...ALLOWED_LIST, entitlements: [] }));
    await settleReact();
    expect(childFrames).not.toHaveBeenCalled();
    expect(view.queryByText('fallback')).not.toBeNull();
  });

  it('keeps one store and request through a StrictMode double mount without leaking', async () => {
    const fixture = makeCore();
    currentCore = fixture.core;
    const view = render(<React.StrictMode><Gate /></React.StrictMode>);
    await settleReact();
    expect(fixture.sessionSubscribe).toHaveBeenCalledOnce();
    expect(fixture.request).toHaveBeenCalledOnce();
    expect(view.queryByText('children')).not.toBeNull();

    view.unmount();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    fixture.setSession(OTHER_USER_ID, null);
    expect(fixture.request).toHaveBeenCalledOnce();
  });

  it('swaps Protect subscribers without a request or fallback flash', async () => {
    const fixture = makeCore();
    currentCore = fixture.core;
    const fallbackRender = vi.fn();
    function Fallback() {
      fallbackRender();
      return <p>fallback</p>;
    }
    function Tree({ gateKey }: { gateKey: string }) {
      return (
        <Protect key={gateKey} feature="reports" fallback={<Fallback />}>
          <p>children</p>
        </Protect>
      );
    }
    const view = render(<Tree gateKey="a" />);
    await settleReact();
    fallbackRender.mockClear();
    view.rerender(<Tree gateKey="b" />);
    await settleReact();
    expect(fixture.request).toHaveBeenCalledOnce();
    expect(fallbackRender).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('children');
  });

  it('requires a feature at the type boundary', () => {
    // @ts-expect-error feature is required.
    const node = <Protect fallback={null}>children</Protect>;
    expect(node).toBeTruthy();
  });
});
