export type AkedlyWidgetMessage = {
  type: 'AUTH_SUCCESS' | 'AUTH_FAILED';
  attemptId?: string;
  transactionId?: string;
  verificationMethod?: 'passkey';
};

export const AKEDLY_WIDGET_ORIGIN = 'https://auth.akedly.io';

export const AKEDLY_PASSKEY_ALLOW =
  `publickey-credentials-get ${AKEDLY_WIDGET_ORIGIN}; `
  + `publickey-credentials-create ${AKEDLY_WIDGET_ORIGIN}`;

/**
 * Mirrors the AuthOwl server's `PHONE_OTP_POLICY.hostedConfirmationWindowMs`
 * (20 s) and `hostedCompletePollIntervalMs` (1 s); change this with them.
 */
export const HOSTED_PHONE_OTP_POLLING = {
  intervalMs: 1_000,
  maxAttempts: 20,
} as const;

export function trustedAkedlyIframeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === AKEDLY_WIDGET_ORIGIN ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isAkedlyWidgetMessage(
  event: MessageEvent,
  frame: HTMLIFrameElement | null,
): event is MessageEvent<AkedlyWidgetMessage> {
  const data: unknown = event.data;
  if (
    frame === null
    || event.origin !== AKEDLY_WIDGET_ORIGIN
    || event.source !== frame.contentWindow
    || typeof data !== 'object'
    || data === null
  ) return false;

  const message = data as Record<string, unknown>;
  return (message.type === 'AUTH_SUCCESS' || message.type === 'AUTH_FAILED')
    && (message.attemptId === undefined || typeof message.attemptId === 'string')
    && (message.transactionId === undefined || typeof message.transactionId === 'string')
    && (message.verificationMethod === undefined || message.verificationMethod === 'passkey');
}
