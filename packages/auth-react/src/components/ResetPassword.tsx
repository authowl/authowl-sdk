'use client';
import * as React from 'react';
import { usePasswordReset, usePublicConfig } from '../hooks';
import { resolveProjectCapabilities } from '../project-capabilities';
import { useT } from '../i18n';
import { safeRedirect } from './redirect';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { FormError } from './FormError';

export type ResetPasswordProps = {
  /** The reset token; if omitted, read from the `?token=` query param on mount. */
  token?: string;
  /** Where to send the user after a successful reset (e.g. your sign-in page). */
  redirectTo?: string;
  /** Called after the password is reset. */
  onReset?: () => void;
};

/**
 * Set a new password from a reset link. Mount this on the page your
 * `resetPasswordUrl` points at: the link redirects here with `?token=`, which
 * this reads (unless a `token` prop is passed). On success it redirects to
 * `redirectTo` (same-origin/relative only).
 */
export function ResetPassword({ token: tokenProp, redirectTo, onReset }: ResetPasswordProps) {
  const t = useT();
  const { resetPassword } = usePasswordReset();
  const { config } = usePublicConfig();
  const capabilities = resolveProjectCapabilities(config);
  const { passwordMinLength, passwordMaxLength } = capabilities;
  const { pending, error, setError, run } = useSubmitAction();
  const [token, setToken] = React.useState<string | null>(tokenProp ?? null);
  const [ready, setReady] = React.useState(tokenProp != null);
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [done, setDone] = React.useState(false);

  // Read the token from the URL once on mount when not passed explicitly. A
  // bad/expired token redirects here with `?error=INVALID_TOKEN` and no `?token=`,
  // so the missing-token branch below covers that case too.
  React.useEffect(() => {
    if (tokenProp != null) return;
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
    setReady(true);
  }, [tokenProp]);

  if (!ready) {
    return <div className="ba-form" aria-busy="true"><div className="ba-skeleton" /></div>;
  }

  if (!token) {
    return (
      <FormError data-testid="reset-invalid">{t('resetPassword.invalidLink')}</FormError>
    );
  }

  if (done) {
    return (
      <p className="ba-muted" data-testid="reset-done">
        {t('resetPassword.done')}
      </p>
    );
  }

  return (
    <form
      method="post"
      className="ba-fields"
      data-testid="reset-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (password.length < passwordMinLength) {
          setError(t('common.error.passwordTooShort', { min: passwordMinLength }));
          return;
        }
        if (password !== confirm) {
          setError(t('resetPassword.error.mismatch'));
          return;
        }
        void run(() => resetPassword({ newPassword: password, token }), {
          failure: t('resetPassword.error.failed'),
          onSuccess: () => {
            // Reset does not create a session; send the user to sign in.
            onReset?.();
            if (redirectTo) safeRedirect(redirectTo);
            else setDone(true);
          },
        });
      }}
    >
      <label className="ba-label">
        {t('resetPassword.newPasswordLabel')}
        <input
          className="ba-input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          minLength={passwordMinLength}
          maxLength={passwordMaxLength}
          required
        />
      </label>
      <label className="ba-label">
        {t('resetPassword.confirmPasswordLabel')}
        <input
          className="ba-input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setError(null);
          }}
          minLength={passwordMinLength}
          maxLength={passwordMaxLength}
          required
        />
      </label>
      <FormError>{error}</FormError>
      <button className="ba-button" type="submit" disabled={pending} aria-busy={pending || undefined}>
        <Busy busy={pending} label={t('resetPassword.submitPending')}>{t('resetPassword.submit')}</Busy>
      </button>
    </form>
  );
}
