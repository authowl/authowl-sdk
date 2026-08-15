'use client';
import * as React from 'react';
import { useConsent } from '../hooks';
import { useT, richMessage } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { ConsentDocLinks } from './ConsentDocLinks';
import { AuthOwlBadge } from './AuthOwlBadge';
import { FormError } from './FormError';

export type ConsentGateProps = {
  /** The protected app content shown once consent is satisfied. */
  children: React.ReactNode;
  /** Optional heading for the re-consent screen. */
  title?: string;
};

/**
 * Re-consent gate for signed-in users: when the operator bumps the project's
 * legal terms version, this interposes an "accept the updated terms" screen
 * until the user accepts, then renders {@link children}.
 *
 * Non-blocking by design — until the status resolves (and whenever consent isn't
 * needed, the overwhelmingly common case) it renders children immediately, so it
 * costs nothing to wrap your app with. It's a UX affordance; the authoritative
 * enforcement and recording happen server-side. Signed-out users and projects
 * without an active consent gate always pass through.
 */
export function ConsentGate({ children, title }: ConsentGateProps) {
  const t = useT();
  const { needsConsent, status, accept } = useConsent();
  const { pending, error, run } = useSubmitAction();

  if (!needsConsent) return <>{children}</>;

  return (
    <div className="ba-form" data-testid="consent-gate">
      <h2 className="ba-title">{title ?? t('consent.gateTitle')}</h2>
      <p className="ba-muted">
        {richMessage(t('consent.gateBody'), {
          links: <ConsentDocLinks termsUrl={status?.termsUrl} privacyUrl={status?.privacyUrl} />,
        })}
      </p>
      <FormError>{error}</FormError>
      <button
        className="ba-button"
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          void run(
            async () => {
              await accept();
              return null;
            },
            { failure: t('consent.error.acceptFailed') },
          )
        }
      >
        <Busy busy={pending} label={t('consent.acceptPending')}>{t('consent.acceptSubmit')}</Busy>
      </button>
      <AuthOwlBadge />
    </div>
  );
}
