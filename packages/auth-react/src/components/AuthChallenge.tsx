'use client';
import * as React from 'react';
import type { ActionFetchOptions, AuthActionResult, AuthClientError } from '@authowl/core';
import { usePublicConfig } from '../hooks';
import { useT } from '../i18n';
import { loadTurnstile, type TurnstileApi } from './Turnstile';

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
  api: TurnstileApi;
  id: string;
  reject: (reason: Error) => void;
};

const challengeError: AuthClientError = {
  status: 403,
  statusText: 'FORBIDDEN',
  code: 'BOT_CHALLENGE_FAILED',
  message: 'Human verification failed.',
};

function turnstileTheme(
  root: HTMLElement | null,
  fallback: 'light' | 'dark' | 'system' | undefined,
): 'light' | 'dark' | 'auto' {
  const rendered = root?.dataset.authowlTheme;
  if (rendered === 'light' || rendered === 'dark') return rendered;
  if (fallback === 'light' || fallback === 'dark') return fallback;
  return 'auto';
}

/**
 * One action-bound Turnstile executor shared by a complete auth surface. Each
 * invocation creates a fresh widget, obtains exactly one token, removes that
 * widget before the network action starts, and transports the token only via
 * the typed fetch option. Multi-action forms can therefore never reuse a token
 * minted for another server action.
 */
export function useAuthChallenge() {
  const { config, isLoading } = usePublicConfig();
  const t = useT();
  const container = React.useRef<HTMLDivElement>(null);
  const active = React.useRef<ActiveWidget | null>(null);
  const [status, setStatus] = React.useState<'idle' | 'checking' | 'failed'>('idle');
  const siteKey = config?.authTurnstileSiteKey ?? null;

  const removeActive = React.useCallback((reason?: Error) => {
    const current = active.current;
    active.current = null;
    if (!current) return;
    current.api.remove(current.id);
    if (reason) current.reject(reason);
  }, []);

  React.useEffect(
    () => () => removeActive(new Error('Turnstile challenge was cancelled')),
    [removeActive],
  );

  const tokenFor = React.useCallback(
    async (action: AuthChallengeAction): Promise<string | null> => {
      if (!siteKey) return null;
      setStatus('checking');
      removeActive(new Error('Turnstile challenge was replaced'));
      try {
        const api = await loadTurnstile();
        if (!container.current) throw new Error('Turnstile container unavailable');
        return await new Promise<string>((resolve, reject) => {
          let settled = false;
          const finish = (outcome: { token: string } | { error: Error }) => {
            if (settled) return;
            settled = true;
            const current = active.current;
            active.current = null;
            if (current) current.api.remove(current.id);
            if ('token' in outcome) resolve(outcome.token);
            else reject(outcome.error);
          };
          const fail = () => finish({ error: new Error('Turnstile challenge failed') });
          const root = container.current!.closest<HTMLElement>('.authowl-root');
          const id = api.render(container.current!, {
            sitekey: siteKey,
            theme: turnstileTheme(root, config?.branding?.theme),
            action,
            execution: 'execute',
            appearance: 'interaction-only',
            size: 'flexible',
            language: root?.dataset.authowlLocale ?? config?.locale,
            callback: (token) => finish({ token }),
            'expired-callback': fail,
            'error-callback': fail,
            'timeout-callback': fail,
            'unsupported-callback': fail,
          });
          active.current = { api, id, reject };
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
    [config?.branding?.theme, config?.locale, removeActive, siteKey],
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
        return await request(token ? { authChallengeToken: token } : undefined);
      } catch {
        setStatus('failed');
        return {
          data: null,
          error: challengeError,
        } satisfies AuthActionResult<T>;
      }
    },
    [isLoading, tokenFor],
  );

  const control = siteKey ? (
    <div className="ba-auth-challenge" data-testid="auth-challenge">
      <div className="ba-turnstile" ref={container} />
      <p className="ba-sr-only" role="status" aria-live="polite">
        {status === 'checking'
          ? t('authChallenge.checking')
          : status === 'failed'
            ? t('authChallenge.error.failed')
            : ''}
      </p>
    </div>
  ) : null;

  return { run, control, configPending: isLoading };
}
