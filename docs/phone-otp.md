# Phone OTP, Akedly Shield, and hosted verification

AuthOwl's phone OTP SDK is provider-neutral. The server selects the configured
anti-abuse ceremony for the exact project environment. Browser code must call
`phoneOtp.prepare()` and branch on the returned `kind`; it must not hardcode an
Akedly route or receive provider credentials.

For most React applications, use `<SignIn />` or `<PhoneOTP />`. They implement
the complete prepare, proof, send, verify, retry, legal-consent, and session
flow with localized English and Arabic UI.

```tsx
import { PhoneOTP } from '@authowl/react';

export function PhoneSignIn() {
  return <PhoneOTP redirectTo="/app" />;
}
```

## What the SDK does for Shield

When the server returns `kind: "akedly_shield_v1_2"`, the SDK:

1. validates the challenge shape and refuses proof difficulty outside the
   supported 0 through 12 range;
2. lazy-loads `@akedly/shield` in the browser;
3. solves proof-of-work when required;
4. obtains a Cloudflare Turnstile token when required;
5. returns only the connection ID and proof to AuthOwl.

The Akedly API key and pipeline ID stay on the AuthOwl server. The Shield
package is installed as a direct dependency of `@authowl/core`, so consumer
bundlers can always resolve it, but its browser code remains in an on-demand
chunk until a Shield route is selected.

## Headless flow

The headless client exposes the same provider-neutral contract:

```ts
import {
  AKEDLY_PASSKEY_ALLOW,
  HOSTED_PHONE_OTP_POLLING,
  createAuthOwlClient,
  createIdempotencyKey,
  isAkedlyWidgetMessage,
  resolveConfig,
  solvePhoneOtpChallenge,
  trustedAkedlyIframeUrl,
  type AkedlyWidgetMessage,
} from '@authowl/core';

const authowl = createAuthOwlClient(resolveConfig({
  publishableKey: import.meta.env.VITE_AUTHOWL_PUBLISHABLE_KEY,
  apiUrl: import.meta.env.VITE_AUTHOWL_API_URL,
}));

declare const tokenFromYourAuthOwlTurnstileWidget: string | undefined;
declare const codeEnteredByTheUser: string;

type StartAttempt = {
  phoneNumber: string;
  idempotencyKey: string;
};

async function startPhoneOtp(
  attempt: StartAttempt,
  legacyTurnstileToken?: string,
) {
  const prepared = await authowl.phoneOtp.prepare();
  if (prepared.error || !prepared.data) {
    throw new Error(prepared.error?.message ?? 'Phone verification is unavailable.');
  }

  const started = prepared.data.kind === 'akedly_widget_v2'
    ? await authowl.phoneOtp.start({
        phoneNumber: attempt.phoneNumber,
        idempotencyKey: attempt.idempotencyKey,
        akedlyWidget: { connectionId: prepared.data.connectionId },
      })
    : prepared.data.kind === 'akedly_shield_v1_2'
      ? await authowl.phoneOtp.start({
        phoneNumber: attempt.phoneNumber,
        idempotencyKey: attempt.idempotencyKey,
        akedlyShield: await solvePhoneOtpChallenge(prepared.data),
      })
      : legacyTurnstileToken
        ? await authowl.phoneOtp.start({
          phoneNumber: attempt.phoneNumber,
          idempotencyKey: attempt.idempotencyKey,
          turnstileToken: legacyTurnstileToken,
        })
        : null;

  if (!started || started.error || !started.data) {
    throw new Error(started?.error?.message ?? 'Complete human verification and try again.');
  }
  return started.data;
}

const attempt = {
  phoneNumber: '+201001112222',
  idempotencyKey: createIdempotencyKey(),
};

const started = await startPhoneOtp(
  attempt,
  tokenFromYourAuthOwlTurnstileWidget,
);

if (started.status === 'hosted') {
  const frame = document.createElement('iframe');
  const iframeUrl = trustedAkedlyIframeUrl(started.iframeUrl);
  if (iframeUrl === null) {
    throw new Error('Hosted phone verification returned an untrusted URL.');
  }
  frame.src = iframeUrl;
  frame.title = 'Secure phone verification';
  if (started.passkeys) {
    frame.allow = AKEDLY_PASSKEY_ALLOW;
  }
  document.querySelector('#phone-verification')!.replaceChildren(frame);

  await new Promise<void>((resolve, reject) => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isAkedlyWidgetMessage(event, frame)) return;
      const message: AkedlyWidgetMessage = event.data;
      if (message.type === 'AUTH_FAILED') {
        window.removeEventListener('message', onMessage);
        reject(new Error('Hosted phone verification failed.'));
      }
      if (message.type === 'AUTH_SUCCESS') {
        window.removeEventListener('message', onMessage);
        resolve();
      }
    };
    window.addEventListener('message', onMessage);
  });

  for (let poll = 0; poll < HOSTED_PHONE_OTP_POLLING.maxAttempts; poll += 1) {
    await new Promise((resolve) => window.setTimeout(
      resolve,
      HOSTED_PHONE_OTP_POLLING.intervalMs,
    ));
    const completed = await authowl.phoneOtp.complete({
      phoneNumber: attempt.phoneNumber,
      attemptId: started.attemptId,
      attemptToken: started.attemptToken,
    });
    const completionStatus = completed.error?.status;
    if (
      completionStatus !== undefined
      && completionStatus >= 400
      && completionStatus < 500
      && completionStatus !== 429
    ) {
      throw new Error(completed.error?.message);
    }
    if (completed.data?.status === true) break;
    if (poll === HOSTED_PHONE_OTP_POLLING.maxAttempts - 1) {
      throw new Error('Verification was not confirmed. Start a new attempt.');
    }
  }
} else {
  const verified = await authowl.phoneOtp.verify({
    phoneNumber: attempt.phoneNumber,
    code: codeEnteredByTheUser,
  });
  if (verified.error || !verified.data?.sessionCreated) {
    throw new Error(verified.error?.message ?? 'The code is invalid or expired.');
  }
}
```

`legacyTurnstileToken` is needed only when `prepare()` selects the AuthOwl
Turnstile route. A custom UI must render that project-configured Turnstile
ceremony itself. `<PhoneOTP />` is recommended if the application can encounter
both route kinds.

## Hosted widget (Akedly V2)

The hosted branch moves phone entry, OTP entry, provider passkeys, and delivery
controls into an Akedly iframe. The SDK accepts only iframe URLs whose origin is
exactly `https://auth.akedly.io`. A custom UI must apply the same origin check
to `iframeUrl`, and it must accept `postMessage` signals only when both
`event.origin` matches that origin and `event.source` is the rendered iframe's
`contentWindow`. `AUTH_SUCCESS` is only a prompt to ask AuthOwl for completion.
It is not proof that verification succeeded.

Set this attribute only when the start response has `passkeys: true`:

```html
allow="publickey-credentials-get https://auth.akedly.io; publickey-credentials-create https://auth.akedly.io"
```

It grants the cross-origin frame permission to request and create WebAuthn
credentials. Omitting it blocks WebAuthn in the frame and leaves the provider's
OTP fallback. The host page's Content Security Policy must also include
`frame-src https://auth.akedly.io`.

After `AUTH_SUCCESS`, call `phoneOtp.complete()` once per second for no more
than 20 seconds. AuthOwl creates a session only after its server receives and
validates Akedly's signed webhook. Akedly delivers that provider webhook once
and does not retry it, so the confirmation window is deliberately bounded and
fails closed if delivery is lost. An `AUTH_FAILED` message, an expired attempt,
or 20 pending or retryable error responses should offer retry. A completion
429 is retryable because its per-IP bucket is shared by users behind the same
address, as are 5xx and network errors. Other completion 4xx responses end
polling immediately. Retry must call `phoneOtp.start()` with a new idempotency
key and render the newly returned attempt. Reuse an old key only after an
ambiguous start request where no response was received.

Custom headless UIs can read this same interval and attempt budget from `HOSTED_PHONE_OTP_POLLING` exported by `@authowl/core`.

An Akedly widget passkey is bound to the `akedly.io` relying party. It is not an
AuthOwl passkey, does not register against the tenant's relying party, and is
not an AuthOwl MFA factor.

## Retry rules

- Create one idempotency key for one phone number and one visible send attempt.
- Reuse it only when retrying the same ambiguous attempt.
- Create a new key when the phone number changes or the user deliberately asks
  for another code.
- Request a fresh challenge before each Shield proof. Do not cache challenges.
- Keep send disabled while the challenge is loading.
- If preparation fails, show a retry control. The built-in component does this
  without requiring a page reload.
- Honor rate limits and do not loop on a 429 response outside the bounded
  hosted completion poll described above.

The proof solver is browser-only. Calling `solvePhoneOtpChallenge()` during SSR
or in Node throws before loading the provider package.

## Security boundaries

- Use a publishable AuthOwl key in browser code, never an AuthOwl secret key.
- Never proxy an Akedly API key or pipeline ID through application JavaScript.
- Never trust the browser to choose the provider or connection ID.
- Treat the phone number and OTP as sensitive and do not log them.
- Do not treat an Akedly callback as session proof. The session is created only
  by `phoneOtp.verify()` or `phoneOtp.complete()` through AuthOwl.
- Akedly Shield protects delivery from abuse. It is not an AuthOwl MFA factor
  and does not replace TOTP, passkeys, backup codes, or a recovery path.

Akedly and AuthOwl rate limits are additive. A Shield proof can be valid while a
later provider pipeline limit or circuit breaker refuses the send. Surface the
stable AuthOwl error and let the user use an enabled non-phone sign-in or
recovery method.

## Host requirements

The browser must be able to execute the Shield worker and, when selected by the
provider, load Cloudflare Turnstile. For the V2 widget, allow
`frame-src https://auth.akedly.io`. Keep the rest of the host Content Security
Policy compatible with the current AuthOwl and Akedly integration guidance.
Validate the production CSP in the real deployed origin, not only on localhost.

## Related documentation

- [AuthOwl Akedly integration guide](https://authowl.dev/docs/integrations/akedly)
- [Akedly Shield V1.2](https://docs.akedly.io/authentication/v1-2)
- [Akedly development test pairs](https://docs.akedly.io/authentication/dev-mode)
- [Admin SDK transactional messaging](./admin-api.md)
