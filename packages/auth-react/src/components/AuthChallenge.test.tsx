// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionFetchOptions, AuthActionResult } from '@authowl/core';
import { useAuthChallenge, type AuthChallengeAction } from './AuthChallenge';
import type { CaptchaRenderOptions, CaptchaWidgetId } from './captcha-providers';

const context = {
  config: {
    captcha: {
      provider: 'turnstile',
      siteKey: 'test-site-key',
    } as { provider: string; siteKey: string } | null,
    branding: { theme: 'dark' as const },
    locale: 'en',
  },
  configState: 'ready' as const,
  appearance: { theme: 'dark' as const },
  locale: 'en' as const,
};

const retry = vi.fn();
vi.mock('../hooks', () => ({
  usePublicConfig: () => ({
    config: context.config,
    isLoading: false,
    isError: false,
    retry,
  }),
}));
vi.mock('../i18n', () => ({
  useT: () => (key: string, params?: Record<string, string>) =>
    params?.provider ? `${key}:${params.provider}` : key,
}));

type RenderOptions = CaptchaRenderOptions & {
  callback: (token: string) => void;
  'error-callback': () => void;
};

function Harness({
  action,
  request,
}: {
  action: AuthChallengeAction;
  request: (options?: ActionFetchOptions) => Promise<AuthActionResult<{ ok: true }>>;
}) {
  const challenge = useAuthChallenge();
  const [code, setCode] = React.useState<string>('none');
  return (
    <div>
      {challenge.control}
      <button
        type="button"
        onClick={() =>
          void challenge.run(action, request).then((result) => setCode(result?.error?.code ?? 'ok'))
        }
      >
        run
      </button>
      <output>{code}</output>
    </div>
  );
}

/** A fresh config OBJECT, which is what re-arms the stale-config refetch. */
function freshConfig() {
  context.config = {
    captcha: { provider: 'turnstile', siteKey: 'test-site-key' },
    branding: { theme: 'dark' as const },
    locale: 'en',
  };
}

/** A Turnstile global that mints a token as soon as it is executed. */
function stubWorkingWidget() {
  const rendered: RenderOptions[] = [];
  Object.defineProperty(window, 'turnstile', {
    configurable: true,
    value: {
      render: vi.fn((_c: HTMLElement, options: RenderOptions) => {
        rendered.push(options);
        return `widget-${rendered.length}`;
      }),
      execute: vi.fn(() => rendered.at(-1)!.callback('minted-token')),
      remove: vi.fn(),
    },
  });
  return rendered;
}

afterEach(() => {
  cleanup();
  retry.mockClear();
  freshConfig();
  Reflect.deleteProperty(window, 'turnstile');
  Reflect.deleteProperty(window, 'hcaptcha');
  Reflect.deleteProperty(window, 'grecaptcha');
  vi.unstubAllGlobals();
});

describe('useAuthChallenge', () => {
  it('does not load the provider or add fetch options while broad protection is off', async () => {
    context.config.captcha = null;
    const request = vi.fn(async () => ({
      data: { ok: true as const },
      error: null,
    }));

    render(<Harness action="auth_signin" request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'run' }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith(undefined);
    expect(screen.queryByTestId('auth-challenge')).toBeNull();
  });

  it.each([
    {
      provider: 'turnstile',
      globalName: 'turnstile',
      expected: {
        sitekey: 'test-site-key',
        theme: 'dark',
        action: 'auth_signin',
        language: 'en',
        execution: 'execute',
        appearance: 'interaction-only',
        size: 'flexible',
        'timeout-callback': expect.any(Function),
        'unsupported-callback': expect.any(Function),
      },
    },
    {
      provider: 'hcaptcha',
      globalName: 'hcaptcha',
      expected: {
        sitekey: 'test-site-key',
        theme: 'dark',
        size: 'invisible',
      },
    },
    {
      provider: 'recaptcha-v2',
      globalName: 'grecaptcha',
      expected: {
        sitekey: 'test-site-key',
        theme: 'dark',
        size: 'invisible',
      },
    },
  ])('renders $provider with only its supported option shape', async ({
    provider,
    globalName,
    expected,
  }) => {
    context.config.captcha = { provider, siteKey: 'test-site-key' };
    const rendered: RenderOptions[] = [];
    const remove = vi.fn();
    const reset = vi.fn();
    const api = {
      render: vi.fn((_container: HTMLElement, options: RenderOptions) => {
        rendered.push(options);
        return `widget-${rendered.length}`;
      }),
      execute: vi.fn((id: CaptchaWidgetId) => rendered.at(-1)!.callback(`token-${id}`)),
      ...(provider === 'recaptcha-v2' ? { reset } : { remove }),
    };
    Object.defineProperty(window, globalName, {
      configurable: true,
      value: api,
    });
    const request = vi.fn(async () => ({
      data: { ok: true as const },
      error: null,
    }));

    render(<Harness action="auth_signin" request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    expect(rendered[0]).toEqual({
      ...expected,
      callback: expect.any(Function),
      'expired-callback': expect.any(Function),
      'error-callback': expect.any(Function),
    });
    expect(request).toHaveBeenCalledWith({
      authChallengeToken: 'token-widget-1',
    });
    expect(provider === 'recaptcha-v2' ? reset : remove).toHaveBeenCalledWith('widget-1');
    expect(screen.getByText('ok')).toBeTruthy();

    if (provider === 'turnstile') {
      fireEvent.click(screen.getByRole('button', { name: 'run' }));
      await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
      expect(api.render).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenLastCalledWith({
        authChallengeToken: 'token-widget-2',
      });
    }
  });

  it('surfaces an unknown provider and fails closed without rendering or requesting', async () => {
    context.config.captcha = { provider: 'future-captcha', siteKey: 'future-key' };
    const renderProvider = vi.fn();
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: { render: renderProvider, execute: vi.fn(), remove: vi.fn() },
    });
    const request = vi.fn(async () => ({ data: { ok: true as const }, error: null }));

    render(<Harness action="auth_signin" request={request} />);

    // Visible, not announced-only: an unrenderable provider is permanent for this
    // deployment, so a sighted user must see which one rather than being told to
    // "try again" at a condition no retry can fix.
    expect(screen.getByTestId('auth-challenge-unsupported').textContent).toBe(
      'authChallenge.error.unsupportedProvider:future-captcha',
    );
    expect(screen.getByTestId('auth-challenge-unsupported').getAttribute('role')).toBe('alert');
    fireEvent.click(screen.getByRole('button', { name: 'run' }));

    await waitFor(() => expect(screen.getByText('BOT_CHALLENGE_FAILED')).toBeTruthy());
    expect(renderProvider).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed without invoking the auth request when the provider rejects', async () => {
    const api = {
      render: vi.fn((_container: HTMLElement, options: RenderOptions) => {
        queueMicrotask(options['error-callback']);
        return 'widget-1';
      }),
      execute: vi.fn(),
      remove: vi.fn(),
    };
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: api,
    });
    const request = vi.fn(async () => ({
      data: { ok: true as const },
      error: null,
    }));

    render(<Harness action="auth_signup" request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'run' }));

    await waitFor(() => expect(screen.getByText('BOT_CHALLENGE_FAILED')).toBeTruthy());
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByTestId('auth-challenge').querySelector('[role="status"]')?.textContent).toBe(
      'authChallenge.error.failed',
    );
  });
});

/**
 * A challenge failure is the ONLY signal a browser gets that the project's
 * credential changed under it. The tab holds the config it loaded, so after a
 * provider or key change it keeps minting tokens the server will not accept,
 * and retrying cannot fix it - only refetching can.
 */
describe('recovering from a project credential that changed under an open tab', () => {
  const denied = async () => ({
    data: null,
    error: {
      status: 403,
      statusText: 'FORBIDDEN',
      code: 'BOT_CHALLENGE_FAILED',
      message: 'Human verification failed.',
    },
  });

  it('refetches the config when the server rejects a token it just minted', async () => {
    stubWorkingWidget();
    const request = vi.fn(denied);

    render(<Harness action="auth_signin" request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'run' }));

    // The failure is still surfaced. Refetching repairs the NEXT attempt; it
    // must never re-run the request, because a replayed sign-up is worse than
    // a stranded tab.
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByText('BOT_CHALLENGE_FAILED')).toBeTruthy();
  });

  it('refetches when the widget itself rejects the site key, not only the server', async () => {
    const rendered: RenderOptions[] = [];
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: {
        render: vi.fn((_c: HTMLElement, options: RenderOptions) => {
          rendered.push(options);
          return 'widget-1';
        }),
        // A site key the provider does not recognise never reaches the server.
        execute: vi.fn(() => rendered.at(-1)!['error-callback']()),
        remove: vi.fn(),
      },
    });
    const request = vi.fn(async () => ({ data: { ok: true as const }, error: null }));

    render(<Harness action="auth_signin" request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'run' }));

    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(request).not.toHaveBeenCalled();
  });

  /**
   * The amplification guard. A real bot failing the challenge produces exactly
   * the same signal as a stale credential, so without this every attempt on a
   * hammered sign-in form would drive a config request.
   */
  it('spends exactly one refetch per config, however many times it fails', async () => {
    stubWorkingWidget();
    const request = vi.fn(denied);

    render(<Harness action="auth_signin" request={request} />);
    for (const _ of [0, 1, 2]) {
      fireEvent.click(screen.getByRole('button', { name: 'run' }));
      await waitFor(() => expect(request).toHaveBeenCalled());
    }

    await waitFor(() => expect(request.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('re-arms once the config it was holding is actually replaced', async () => {
    stubWorkingWidget();
    const request = vi.fn(denied);

    const { rerender } = render(<Harness action="auth_signin" request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));

    // The refetch landed and the project really had changed.
    freshConfig();
    rerender(<Harness action="auth_signin" request={request} />);

    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(2));
  });
});
