'use client';
import * as React from 'react';
import { useMFA, usePublicConfig, useSession, useUser } from '../../hooks';
import { useT } from '../../i18n';
import { MFAEnrollment } from '../MFAEnrollment';
import { MFAChallenge } from '../MFAChallenge';
import { useStepUpAction } from '../use-step-up-action';
import { Busy } from '../Spinner';
import { FormError } from '../FormError';
import { resolveProjectCapabilities } from '../../project-capabilities';

export function MfaSection() {
  const t = useT();
  const { user } = useUser();
  const session = useSession();
  const { config } = usePublicConfig();
  const { disable } = useMFA();
  const { pending, error, stepUpRequired, run, resume, cancel } = useStepUpAction();
  const [password, setPassword] = React.useState('');
  const [showDisable, setShowDisable] = React.useState(false);
  const titleId = React.useId();
  const required = resolveProjectCapabilities(config).mfaRequired;

  if (!user?.twoFactorEnabled) {
    return (
      <section className="ba-profile-section" aria-labelledby={titleId}>
        <header className="ba-profile-section-header">
          <h2 id={titleId} className="ba-title">{t('userProfile.mfa.title')}</h2>
          <p className="ba-muted">
            {required
              ? t('userProfile.mfa.requiredDescription')
              : t('userProfile.mfa.description')}
          </p>
        </header>
        <MFAEnrollment
          title={null}
          onEnrolled={() => session.refetch({ query: { disableCookieCache: true } })}
        />
      </section>
    );
  }

  // The password is held across a step-up on purpose: the server gates this
  // endpoint on a code AND the password, and making the user retype one after
  // proving the other would be friction with nothing behind it.
  const submitDisable = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(
      () => disable({ password }),
      {
        failure: t('userProfile.mfa.disableError'),
        onSuccess: () => {
          setPassword('');
          setShowDisable(false);
          session.refetch({ query: { disableCookieCache: true } });
        },
      },
    );
  };

  const cancelDisable = () => {
    cancel();
    setShowDisable(false);
    setPassword('');
  };

  return (
    <section className="ba-profile-section" aria-labelledby={titleId}>
      <header className="ba-profile-section-header">
        <h2 id={titleId} className="ba-title">{t('userProfile.mfa.title')}</h2>
        <p className="ba-muted">
          {required ? t('userProfile.mfa.requiredActive') : t('userProfile.mfa.active')}
        </p>
      </header>
      <div className="ba-profile-status" role="status">
        <strong>{t('userProfile.mfa.enabled')}</strong>
        <span>{t('userProfile.mfa.authenticator')}</span>
      </div>
      {/* Ordered so each arm stands on its own: step-up can only follow an
          opened form, and stating that as nesting made the reader derive it. */}
      {stepUpRequired ? (
        // Turning the factor off requires PROVING it, not just knowing the
        // password - see `useStepUpAction`. The parked attempt replays with the
        // password already entered, so accepting a code finishes the removal.
        <MFAChallenge variant="step-up" onVerified={resume} onCancel={cancelDisable} />
      ) : !showDisable ? (
        <button
          className="ba-button ba-button-secondary ba-profile-submit"
          type="button"
          onClick={() => setShowDisable(true)}
        >
          {required ? t('userProfile.mfa.replace') : t('userProfile.mfa.disable')}
        </button>
      ) : (
        <form method="post" className="ba-fields ba-profile-security-form" onSubmit={submitDisable}>
          <p className="ba-muted">
            {required ? t('userProfile.mfa.replaceWarning') : t('userProfile.mfa.disableWarning')}
          </p>
          <label className="ba-label">
            {t('common.passwordLabel')}
            <input
              className="ba-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <FormError>{error}</FormError>
          <span className="ba-profile-action-row">
            <button
              className="ba-button ba-danger-button"
              type="submit"
              disabled={pending || !password}
              aria-busy={pending || undefined}
            >
              <Busy busy={pending} label={t('common.working')}>
                {required ? t('userProfile.mfa.replaceConfirm') : t('userProfile.mfa.disableConfirm')}
              </Busy>
            </button>
            <button
              className="ba-button ba-button-secondary"
              type="button"
              disabled={pending}
              onClick={cancelDisable}
            >
              {t('common.cancel')}
            </button>
          </span>
        </form>
      )}
    </section>
  );
}
