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

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({
    config: context.config,
    isLoading: false,
    isError: false,
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

afterEach(() => {
  cleanup();
  context.config.captcha = { provider: 'turnstile', siteKey: 'test-site-key' };
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

    expect(screen.getByTestId('auth-challenge').querySelector('[role="status"]')?.textContent).toBe(
      'authChallenge.error.unsupportedProvider:future-captcha',
    );
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
