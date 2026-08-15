# Phone OTP and Akedly Shield

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
  createAuthOwlClient,
  createIdempotencyKey,
  resolveConfig,
  solvePhoneOtpChallenge,
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

  const started = prepared.data.kind === 'akedly_shield_v1_2'
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

await startPhoneOtp(attempt, tokenFromYourAuthOwlTurnstileWidget);

const verified = await authowl.phoneOtp.verify({
  phoneNumber: attempt.phoneNumber,
  code: codeEnteredByTheUser,
});
if (verified.error || !verified.data?.sessionCreated) {
  throw new Error(verified.error?.message ?? 'The code is invalid or expired.');
}
```

`legacyTurnstileToken` is needed only when `prepare()` selects the AuthOwl
Turnstile route. A custom UI must render that project-configured Turnstile
ceremony itself. `<PhoneOTP />` is recommended if the application can encounter
both route kinds.

## Retry rules

- Create one idempotency key for one phone number and one visible send attempt.
- Reuse it only when retrying the same ambiguous attempt.
- Create a new key when the phone number changes or the user deliberately asks
  for another code.
- Request a fresh challenge before each Shield proof. Do not cache challenges.
- Keep send disabled while the challenge is loading.
- If preparation fails, show a retry control. The built-in component does this
  without requiring a page reload.
- Honor rate limits and do not loop on a 429 response.

The proof solver is browser-only. Calling `solvePhoneOtpChallenge()` during SSR
or in Node throws before loading the provider package.

## Security boundaries

- Use a publishable AuthOwl key in browser code, never an AuthOwl secret key.
- Never proxy an Akedly API key or pipeline ID through application JavaScript.
- Never trust the browser to choose the provider or connection ID.
- Treat the phone number and OTP as sensitive and do not log them.
- Do not treat an Akedly callback as session proof. The session is created only
  by `phoneOtp.verify()` through AuthOwl.
- Akedly Shield protects delivery from abuse. It is not an AuthOwl MFA factor
  and does not replace TOTP, passkeys, backup codes, or a recovery path.

Akedly and AuthOwl rate limits are additive. A Shield proof can be valid while a
later provider pipeline limit or circuit breaker refuses the send. Surface the
stable AuthOwl error and let the user use an enabled non-phone sign-in or
recovery method.

## Host requirements

The browser must be able to execute the Shield worker and, when selected by the
provider, load Cloudflare Turnstile. Keep the host Content Security Policy
compatible with the current AuthOwl and Akedly integration guidance. Validate
the production CSP in the real deployed origin, not only on localhost.

## Related documentation

- [AuthOwl Akedly integration guide](https://authowl.dev/docs/integrations/akedly)
- [Akedly Shield V1.2](https://docs.akedly.io/authentication/v1-2)
- [Akedly development test pairs](https://docs.akedly.io/authentication/dev-mode)
- [Admin SDK transactional messaging](./admin-api.md)
