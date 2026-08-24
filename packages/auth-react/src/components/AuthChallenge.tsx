'use client';
import * as React from 'react';
import type { ActionFetchOptions, AuthActionResult, AuthClientError } from '@authowl/core';
import { usePublicConfig } from '../hooks';
import { useT } from '../i18n';
import { FormError } from './FormError';
import { isSupportedCaptchaProvider } from './captcha-provider-ids';
import type { CaptchaAdapter, CaptchaApi, CaptchaWidgetId } from './captcha-providers';

export const AUTH_CHALLENGE_ACTIONS = {
  signUp: 'auth_signup',
  signIn: 'auth_signin',
  passwordless: 'auth_passwordless',
  reset: 'auth_reset',
  verifyEmail: 'auth_verify_email',
  waitlist: 'waitlist_join',
} as const;
export type AuthChallengeAction =
  (typeof AUTH_CHALLENGE_ACTIONS)[keyof typeof AUTH_CHALLENGE_ACTIONS];

type ChallengeRequest<T> = (
  fetchOptions?: ActionFetchOptions,
) => Promise<AuthActionResult<T> | null | undefined>;

type ActiveWidget = {
  adapter: CaptchaAdapter;
  api: CaptchaApi;
  id: CaptchaWidgetId;
  reject: (reason: Error) => void;
};

const challengeError: AuthClientError = {
  status: 403,
  statusText: 'FORBIDDEN',
  code: 'BOT_CHALLENGE_FAILED',
  message: 'Human verification failed.',
};

function captchaTheme(
  root: HTMLElement | null,
  fallback: 'light' | 'dark' | 'system' | undefined,
): 'light' | 'dark' | 'auto' {
  const rendered = root?.dataset.authowlTheme;
  if (rendered === 'light' || rendered === 'dark') return rendered;
  if (fallback === 'light' || fallback === 'dark') return fallback;
  return 'auto';
}

/**
 * One action-bound challenge executor shared by a complete auth surface. Each
 * invocation creates a fresh widget, obtains exactly one token, removes that
 * widget before the network action starts, and transports the token only via
 * the typed fetch option. Multi-action forms can therefore never reuse a token
 * minted for another server action.
 */
export function useAuthChallenge() {
  const { config, isLoading, retry } = usePublicConfig();
  const t = useT();
  const container = React.useRef<HTMLDivElement>(null);
  const active = React.useRef<ActiveWidget | null>(null);
  const [status, setStatus] = React.useState<'idle' | 'checking' | 'failed'>('idle');
  const captcha = config?.captcha ?? null;
  const providerSupported = captcha ? isSupportedCaptchaProvider(captcha.provider) : false;
  const unavailableProvider = captcha && !providerSupported ? captcha.provider : null;

  /**
   * Whether a stale-config refetch has already been spent for THIS config.
   *
   * A challenge failure is the only signal a browser gets that the project's
   * credential changed under it: a tab holds the config it loaded, so after a
   * provider or key change it keeps minting tokens the server will not accept,
   * and no amount of retrying fixes it. Refetching repairs that - but a real bot
   * failing the challenge produces the same signal, so an unguarded refetch
   * would let anyone hammering a sign-in form drive a request per attempt.
   *
   * Keyed on the config OBJECT so one incident costs exactly one refetch, and a
   * genuinely new config re-arms it for the next one.
   */
  const refetched = React.useRef<object | null>(null);

  const refetchIfConfigMayBeStale = React.useCallback(() => {
    if (!config || refetched.current === config) return;
    refetched.current = config;
    retry();
  }, [config, retry]);

  const removeActive = React.useCallback((reason?: Error) => {
    const current = active.current;
    active.current = null;
    if (!current) return;
    current.adapter.teardown(current.api, current.id);
    if (reason) current.reject(reason);
  }, []);

  React.useEffect(
    () => () => removeActive(new Error('Captcha challenge was cancelled')),
    [removeActive],
  );

  const tokenFor = React.useCallback(
    async (action: AuthChallengeAction): Promise<string | null> => {
      if (!captcha) return null;
      if (!providerSupported) throw new Error(`Unsupported captcha provider: ${captcha.provider}`);
      setStatus('checking');
      removeActive(new Error('Captcha challenge was replaced'));
      try {
        // The adapter and loader are needed only when an action is submitted.
        // Keeping them in an on-demand chunk avoids charging every AuthOwl
        // surface for three provider integrations it may never execute.
        const [{ loadCaptcha }, { captchaAdapterFor }] = await Promise.all([
          import('./captcha-loader'),
          import('./captcha-providers'),
        ]);
        const adapter = captchaAdapterFor(captcha.provider);
        if (!adapter) throw new Error(`Unsupported captcha provider: ${captcha.provider}`);
        const api = await loadCaptcha(adapter);
        if (!container.current) throw new Error('Captcha container unavailable');
        return await new Promise<string>((resolve, reject) => {
          let settled = false;
          const finish = (outcome: { token: string } | { error: Error }) => {
            if (settled) return;
            settled = true;
            const current = active.current;
            active.current = null;
            if (current) current.adapter.teardown(current.api, current.id);
            if ('token' in outcome) resolve(outcome.token);
            else reject(outcome.error);
          };
          const fail = () => finish({ error: new Error('Captcha challenge failed') });
          const root = container.current!.closest<HTMLElement>('.authowl-root');
          const optionalFailureCallbacks = captcha.provider === 'turnstile'
            ? {
                'timeout-callback': fail,
                'unsupported-callback': fail,
              }
            : {};
          const id = api.render(container.current!, {
            ...adapter.invisibleRenderOptions({
              siteKey: captcha.siteKey,
              theme: captchaTheme(root, config?.branding?.theme),
              action,
              language: root?.dataset.authowlLocale ?? config?.locale,
            }),
            callback: (token) => finish({ token }),
            'expired-callback': fail,
            'error-callback': fail,
            ...optionalFailureCallbacks,
          });
          active.current = { adapter, api, id, reject };
          try {
            api.execute(id);
          } catch {
            fail();
          }
        });
      } finally {
        setStatus('idle');
      }
    },
    [captcha, config?.branding?.theme, config?.locale, providerSupported, removeActive],
  );

  const run = React.useCallback(
    async <T,>(action: AuthChallengeAction, request: ChallengeRequest<T>) => {
      if (isLoading) {
        return {
          data: null,
          error: challengeError,
        } satisfies AuthActionResult<T>;
      }
      try {
        const token = await tokenFor(action);
        const result = await request(token ? { authChallengeToken: token } : undefined);
        // The server rejecting a token this widget just minted means the
        // credential it was minted against is no longer the one being verified.
        if (result?.error?.code === challengeError.code) refetchIfConfigMayBeStale();
        return result;
      } catch {
        // The widget itself failing - a site key the provider does not
        // recognise reaches the error callback rather than the server - carries
        // the same meaning, so it takes the same repair.
        setStatus('failed');
        refetchIfConfigMayBeStale();
        return {
          data: null,
          error: challengeError,
        } satisfies AuthActionResult<T>;
      }
    },
    [isLoading, refetchIfConfigMayBeStale, tokenFor],
  );

  const control = captcha ? (
    <div className="ba-auth-challenge" data-testid="auth-challenge">
      {providerSupported ? <div className="ba-turnstile" ref={container} /> : null}
      {/*
        A provider this build cannot render is PERMANENT for this deployment, so
        it is shown rather than announced only to assistive technology. The
        generic failure below stays visually hidden because it accompanies a
        retryable submit error the form already displays - telling a sighted user
        to "try again" for a condition no retry can fix would be worse than
        saying nothing.
      */}
      {unavailableProvider ? (
        <FormError data-testid="auth-challenge-unsupported">
          {t('authChallenge.error.unsupportedProvider', { provider: unavailableProvider })}
        </FormError>
      ) : (
        <p className="ba-sr-only" role="status" aria-live="polite">
          {status === 'checking'
            ? t('authChallenge.checking')
            : status === 'failed'
              ? t('authChallenge.error.failed')
              : ''}
        </p>
      )}
    </div>
  ) : null;

  return { run, control, configPending: isLoading };
}
