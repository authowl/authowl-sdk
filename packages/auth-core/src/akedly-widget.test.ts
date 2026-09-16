import { describe, expect, it } from 'vitest';
import {
  AKEDLY_PASSKEY_ALLOW,
  AKEDLY_WIDGET_ORIGIN,
  HOSTED_PHONE_OTP_POLLING,
  isAkedlyWidgetMessage,
  trustedAkedlyIframeUrl,
} from './akedly-widget';

describe('Akedly hosted widget browser contract', () => {
  it('exports the shared iframe permissions and polling budget', () => {
    expect(AKEDLY_PASSKEY_ALLOW).toBe(
      `publickey-credentials-get ${AKEDLY_WIDGET_ORIGIN}; `
      + `publickey-credentials-create ${AKEDLY_WIDGET_ORIGIN}`,
    );
    expect(HOSTED_PHONE_OTP_POLLING).toEqual({ intervalMs: 1_000, maxAttempts: 20 });
    expect(HOSTED_PHONE_OTP_POLLING.intervalMs * HOSTED_PHONE_OTP_POLLING.maxAttempts).toBe(20_000);
  });

  it('accepts iframe URLs only from the exact Akedly widget origin', () => {
    const trusted = `${AKEDLY_WIDGET_ORIGIN}/auth?attemptId=attempt-1`;
    expect(trustedAkedlyIframeUrl(trusted)).toBe(trusted);
    expect(trustedAkedlyIframeUrl(AKEDLY_WIDGET_ORIGIN)).toBe(`${AKEDLY_WIDGET_ORIGIN}/`);
    expect(trustedAkedlyIframeUrl('https://auth.akedly.io.evil.test/auth')).toBeNull();
    expect(trustedAkedlyIframeUrl('not a url')).toBeNull();
  });

  it('accepts widget messages only from the trusted origin and iframe window', () => {
    const source = {} as Window;
    const frame = { contentWindow: source } as HTMLIFrameElement;
    const event = {
      origin: AKEDLY_WIDGET_ORIGIN,
      source,
      data: { type: 'AUTH_SUCCESS', extra: 'tolerated' },
    } as MessageEvent;

    expect(isAkedlyWidgetMessage(event, frame)).toBe(true);
    expect(isAkedlyWidgetMessage({ ...event, origin: 'https://evil.test' }, frame)).toBe(false);
    expect(isAkedlyWidgetMessage({ ...event, source: {} as Window }, frame)).toBe(false);
    expect(isAkedlyWidgetMessage({ ...event, data: { type: 'OTHER' } }, frame)).toBe(false);
    expect(isAkedlyWidgetMessage({ ...event, source: null }, null)).toBe(false);
  });
});
