// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionFetchOptions, AuthActionResult } from '@authowl/core';
import { useAuthChallenge, type AuthChallengeAction } from './AuthChallenge';

const context = {
  config: {
    authTurnstileSiteKey: 'test-site-key' as string | null,
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
vi.mock('../i18n', () => ({ useT: () => (key: string) => key }));

type RenderOptions = {
  action?: string;
  theme?: string;
  language?: string;
  execution?: string;
  appearance?: string;
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
  context.config.authTurnstileSiteKey = 'test-site-key';
  Reflect.deleteProperty(window, 'turnstile');
  vi.unstubAllGlobals();
});

describe('useAuthChallenge', () => {
  it('does not load the provider or add fetch options while broad protection is off', async () => {
    context.config.authTurnstileSiteKey = null;
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

  it('mints an action-bound token once and passes it through the typed fetch option', async () => {
    const rendered: RenderOptions[] = [];
    const remove = vi.fn();
    const api = {
      render: vi.fn((_container: HTMLElement, options: RenderOptions) => {
        rendered.push(options);
        return `widget-${rendered.length}`;
      }),
      execute: vi.fn((id: string) =>
        rendered[Number(id.split('-')[1]) - 1]!.callback(`token-${id}`),
      ),
      remove,
    };
    Object.defineProperty(window, 'turnstile', {
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

    expect(rendered[0]?.action).toBe('auth_signin');
    expect(rendered[0]).toMatchObject({
      theme: 'dark',
      language: 'en',
      execution: 'execute',
      appearance: 'interaction-only',
    });
    expect(request).toHaveBeenCalledWith({
      authChallengeToken: 'token-widget-1',
    });
    expect(remove).toHaveBeenCalledWith('widget-1');
    expect(screen.getByText('ok')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(api.render).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({
      authChallengeToken: 'token-widget-2',
    });
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
