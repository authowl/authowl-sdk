'use client';
import * as React from 'react';
import {
  AKEDLY_PASSKEY_ALLOW,
  HOSTED_PHONE_OTP_POLLING,
  createIdempotencyKey,
  isAkedlyWidgetMessage,
  trustedAkedlyIframeUrl,
  type PhoneOtpStartData,
} from '@authowl/core';
import { useAuthClient, useSignIn } from '../hooks';
import { useT } from '../i18n';
import { finishSignIn } from './finish-sign-in';
import { FormError } from './FormError';
import { Busy } from './Spinner';
import { useSubmitAction } from './use-submit-action';

type HostedAttempt = Extract<PhoneOtpStartData, { status: 'hosted' }>;

export function HostedPhoneOtp({
  attempt,
  connectionId,
  phoneNumber,
  consentVersion,
  redirectTo,
  onSignedIn,
  onMfaPasswordRequired,
  onStarted,
  onChangePhone,
}: {
  attempt: HostedAttempt;
  connectionId: string;
  phoneNumber: string;
  consentVersion?: number;
  redirectTo?: string;
  onSignedIn?: () => void;
  onMfaPasswordRequired?: () => void;
  onStarted: (data: PhoneOtpStartData | null) => void;
  onChangePhone: () => void;
}) {
  const t = useT();
  const { sessionStore } = useAuthClient();
  const { completePhoneOtp: complete, startPhoneOtp: start } = useSignIn();
  const { pending, error, setError, run } = useSubmitAction();
  const [failed, setFailed] = React.useState(false);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const effectValues = React.useRef({
    complete,
    sessionStore,
    onSignedIn,
    onMfaPasswordRequired,
  });
  effectValues.current = {
    complete,
    sessionStore,
    onSignedIn,
    onMfaPasswordRequired,
  };
  const failedMessage = t('phoneOtp.error.hostedFailed');
  const unconfirmedMessage = t('phoneOtp.error.hostedUnconfirmed');
  const iframeUrl = React.useMemo(
    () => trustedAkedlyIframeUrl(attempt.iframeUrl),
    [attempt.iframeUrl],
  );

  React.useEffect(() => {
    if (iframeUrl === null) return undefined;
    let stopped = false;
    let polling = false;
    let polls = 0;
    let pollTimer: number | undefined;
    let expiryTimer: number | undefined;

    const clear = () => {
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
      window.removeEventListener('message', onMessage);
    };
    const fail = (message: string) => {
      if (stopped) return;
      stopped = true;
      clear();
      setFailed(true);
      setError(message);
    };
    // The completion bucket is shared per IP, including users behind carrier NAT.
    // A 429 mid-poll is therefore retryable like 5xx and network errors.
    const isTerminalCompletionFailure = (status: number | undefined) =>
      status !== undefined && status >= 400 && status < 500 && status !== 429;
    const poll = async () => {
      if (stopped) return;
      polls += 1;
      const result = await effectValues.current.complete({
        phoneNumber,
        attemptId: attempt.attemptId,
        attemptToken: attempt.attemptToken,
        consentVersion,
      });
      if (stopped) return;
      const errorStatus = result.error?.status;
      if (isTerminalCompletionFailure(errorStatus)) {
        if (result.error?.code === 'TWO_FACTOR_REQUIRED') {
          effectValues.current.onMfaPasswordRequired?.();
        }
        fail(failedMessage);
      } else if (!result.error && result.data?.status === true) {
        stopped = true;
        clear();
        await finishSignIn({
          sessionStore: effectValues.current.sessionStore,
          redirectTo,
          onSignedIn: effectValues.current.onSignedIn,
        });
      } else if (polls >= HOSTED_PHONE_OTP_POLLING.maxAttempts) {
        fail(unconfirmedMessage);
      } else {
        pollTimer = window.setTimeout(
          () => { void poll(); },
          HOSTED_PHONE_OTP_POLLING.intervalMs,
        );
      }
    };
    function onMessage(event: MessageEvent) {
      if (stopped || !isAkedlyWidgetMessage(event, iframeRef.current)) return;
      if (event.data.type === 'AUTH_FAILED') {
        fail(failedMessage);
      } else if (!polling) {
        polling = true;
        pollTimer = window.setTimeout(
          () => { void poll(); },
          HOSTED_PHONE_OTP_POLLING.intervalMs,
        );
      }
    }

    window.addEventListener('message', onMessage);
    const expiresIn = attempt.expiresAt.getTime() - Date.now();
    if (expiresIn <= 0) fail(failedMessage);
    else expiryTimer = window.setTimeout(() => fail(failedMessage), expiresIn);
    return () => {
      stopped = true;
      clear();
    };
  }, [
    attempt,
    consentVersion,
    failedMessage,
    phoneNumber,
    redirectTo,
    setError,
    iframeUrl,
    unconfirmedMessage,
  ]);

  if (iframeUrl === null) {
    return (
      <div className="ba-fields" data-testid="phoneotp-hosted">
        <FormError>{failedMessage}</FormError>
        <button type="button" className="ba-link-button" onClick={onChangePhone}>
          {t('phoneOtp.changePhone')}
        </button>
      </div>
    );
  }

  return (
    <div className="ba-fields" data-testid="phoneotp-hosted">
      <h2 className="ba-title">{t('phoneOtp.title')}</h2>
      <div className="ba-hosted-frame">
        <iframe
          ref={iframeRef}
          data-testid="phoneotp-hosted-frame"
          src={iframeUrl}
          title={t('phoneOtp.title')}
          {...(attempt.passkeys ? { allow: AKEDLY_PASSKEY_ALLOW } : {})}
        />
      </div>
      <FormError>{error}</FormError>
      {failed && (
        <button
          type="button"
          className="ba-button"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() => {
            const idempotencyKey = createIdempotencyKey();
            void run(
              () => start({
                phoneNumber,
                akedlyWidget: { connectionId },
                idempotencyKey,
              }),
              {
                failure: failedMessage,
                onSuccess: (result) => onStarted(result.data),
              },
            );
          }}
        >
          <Busy busy={pending} label={t('common.sending')}>
            {t('phoneOtp.retryHosted')}
          </Busy>
        </button>
      )}
      <button type="button" className="ba-link-button" onClick={onChangePhone}>
        {t('phoneOtp.changePhone')}
      </button>
    </div>
  );
}
