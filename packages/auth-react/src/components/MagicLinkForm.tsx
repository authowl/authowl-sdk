'use client';
import * as React from 'react';
import { useSignIn } from '../hooks';
import { useT } from '../i18n';
import { emailAutocomplete } from '../signin-methods';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { FormError } from './FormError';

export type MagicLinkFormProps = {
  /** Where to land after the emailed link is followed. */
  callbackURL?: string;
  /** Append the `webauthn` autofill token to the email input (passkey host). */
  webauthnAutofill?: boolean;
};

/**
 * Passwordless magic-link request: collects an email and asks the server to send
 * a one-time sign-in link. No session is issued here - the session is created
 * when the user follows the emailed link, so there is no redirect on submit.
 */
export function MagicLinkForm({ callbackURL, webauthnAutofill }: MagicLinkFormProps) {
  const t = useT();
  const { signInMagicLink } = useSignIn();
  const { pending, error, run } = useSubmitAction();
  const authChallenge = useAuthChallenge();
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);

  if (sent) {
    return (
      <p className="ba-muted" data-testid="magiclink-sent">
        {t('magicLink.sent')}
      </p>
    );
  }

  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.passwordless, (options) => signInMagicLink({ email, callbackURL }, options)), {
          failure: t('magicLink.error.sendFailed'),
          onSuccess: () => setSent(true),
        });
      }}
      className="ba-fields"
      data-testid="magiclink-form"
    >
      <label className="ba-label">
        {t('common.emailLabel')}
        <input
          className="ba-input"
          type="email"
          autoComplete={emailAutocomplete(!!webauthnAutofill)}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      {authChallenge.control}
      <FormError>{error}</FormError>
      <button
        className="ba-button"
        type="submit"
        disabled={pending || authChallenge.configPending}
        aria-busy={pending || undefined}
      >
        <Busy busy={pending} label={t('common.sending')}>{t('magicLink.submit')}</Busy>
      </button>
    </form>
  );
}
