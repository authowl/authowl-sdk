# @authowl/core

**[Complete SDK guide](https://authowl.dev/docs/sdks/core)** ·
**[Server Admin guide](https://authowl.dev/docs/sdks/admin-server)** ·
**[Error handling](https://authowl.dev/docs/sdks/errors)**

Framework-agnostic client for [AuthOwl](https://authowl.dev), the multi-tenant
auth service. Validates publishable keys, enforces HTTPS off localhost, and
exposes typed errors. Most apps use [`@authowl/react`](https://www.npmjs.com/package/@authowl/react)
or [`@authowl/next`](https://www.npmjs.com/package/@authowl/next) instead of this
directly.

```bash
pnpm add @authowl/core
```

## Upgrade notes

### 2026-08-22 — organization member email is nullable

`OrganizationMemberUser.email` is `string | null`. It was widened from `string`
in **0.16.0**, a minor release, so servers can withhold internal placeholder
addresses without breaking decoding. Do not assume every organization member's
address is visible to the current caller.

Before using the field as a string, provide a fallback
(`const email = user.email ?? '';`) or guard against `null`.

## Framework-neutral session state

Core has no React dependency. It exposes a standard external store for custom
framework bindings and headless clients:

```ts
const unsubscribe = authowl.sessionStore.subscribe(() => {
  const session = authowl.sessionStore.getSnapshot();
  renderSession(session);
});

const initial = authowl.sessionStore.getSnapshot();
```

React applications should use `useSession()` from `@authowl/react`, which binds
this store with React's external-store API and remains safe during SSR.

## Generated server-only Admin API client

The `@authowl/core/server` entrypoint accepts a **secret key** (`sk_live_…`) for
server-side admin calls. It refuses to run in a browser. Never import it from
client code.

```ts
import { createAdminClient } from '@authowl/core/server';

const admin = createAdminClient({
  secretKey: process.env.AUTHOWL_SECRET_KEY!,
  apiUrl: 'https://auth.yourdomain.com',
});

const users = await admin.listUsers({ query: { limit: 50 } });
const user = await admin.getUser({ path: { userId: 'user_123' } });
await admin.updateUser({
  path: { userId: user.id },
  body: { name: 'Mona' },
});

await admin.updateUserMetadata({
  path: { userId: user.id },
  body: {
    expected_version: user.metadata_version,
    public_metadata: { locale: 'ar' },
    private_metadata: { billingTier: 'pro' },
  },
});
```

Publishable keys (`pk_test_…` in development, `pk_live_…` in production) are
safe to embed in client code; secret keys (`sk_test_…` / `sk_live_…`) are bearer
credentials and must stay server-side.

The operation names, path/query/body inputs, and result types are generated from
AuthOwl's versioned OpenAPI contract. Failed API responses throw
`AuthOwlAdminApiError`, which exposes `status`, `code`, `requestId`, `problem`,
and `retryAfter`. Network and response-contract failures throw
`AuthOwlAdminNetworkError` with a stable `kind` (`aborted`, `timeout`,
`network`, `response_too_large`, or `invalid_response`).

```ts
import { AuthOwlAdminApiError } from '@authowl/core/server';

try {
  await admin.getUser({ path: { userId: 'missing' } });
} catch (error) {
  if (error instanceof AuthOwlAdminApiError && error.code === 'NOT_FOUND') {
    // Cross-project and missing resources both intentionally appear as 404.
  }
}
```

See the full [Admin API reference](https://github.com/authowl/authowl-sdk/blob/main/docs/admin-api.md),
the [phone OTP and Akedly Shield guide](https://github.com/authowl/authowl-sdk/blob/main/docs/phone-otp.md),
and the [webhook signature guide](https://github.com/authowl/authowl-sdk/blob/main/docs/webhooks.md).
Webhook receivers import `verifyWebhook` from `@authowl/core/server`; it works
in Node and worker Web Crypto runtimes.

## Stateless backend token verification

Import verification from the server-only subpath. The derived form validates
the publishable key and API origin, then derives the exact AuthOwl issuer,
audience, and JWKS route:

```ts
import { verifyToken } from '@authowl/core/server';

const identity = await verifyToken(bearerToken, {
  publishableKey: process.env.AUTHOWL_PUBLISHABLE_KEY!,
  apiUrl: process.env.AUTHOWL_API_URL!,
});
```

A fully custom deployment may instead pass all three explicit values:

```ts
const identity = await verifyToken(bearerToken, {
  issuer: 'https://issuer.example.com/custom',
  jwksUri: 'https://keys.example.net/v1/jwks',
  audience: 'my-application',
});
```

Do not mix the two forms or provide only part of one form. URLs must be
canonical absolute HTTPS URLs without credentials, query strings, fragments,
or encoded paths. A `pk_test_` key may use HTTP only on exact loopback
development hosts (`localhost`, `*.localhost`, `127.0.0.1`, or `[::1]`);
`pk_live_` always requires HTTPS.

Verification accepts only app-shaped ES256 public keys. JWKS requests refuse
redirects, abort after five seconds, stream at most 64 KiB, and accept at most
64 unique keys. Failures throw `TokenVerificationError` with a stable typed
`code`; authorization helpers `has()` and `hasPermission()` continue to fail
closed for token failures while surfacing configuration failures.

## Headless account and organization management

Use the AuthOwl-owned `account` and `organization` namespaces when you are
building custom UI. Their public types do not depend on the underlying auth
engine.

```ts
import { createAuthOwlClient, getPublicConfig, resolveConfig } from '@authowl/core';

const config = resolveConfig({ publishableKey, apiUrl });
const authowl = createAuthOwlClient(config);
const capabilities = await getPublicConfig(config);

await authowl.account.updateProfile({ name: 'Mona' });
const sessions = await authowl.account.listSessions();
const otherSession = sessions.data?.[0];
if (otherSession) {
  await authowl.account.revokeSession({ sessionId: otherSession.id });
}
const metadata = await authowl.account.getMetadata();
if (metadata.data) {
  await authowl.account.updateUnsafeMetadata({
    expectedVersion: metadata.data.metadataVersion,
    unsafeMetadata: { onboarding: { step: 2 } },
  });
}

if (capabilities.organizations) {
  const organizations = await authowl.organization.list();
  const firstOrganization = organizations.data?.[0];
  if (firstOrganization) {
    await authowl.organization.setActive({ organizationId: firstOrganization.id });
  }
}

if (capabilities.userModel?.accountDeletion ?? capabilities.accountDeletion) {
  await authowl.account.delete();
}
```

The additive `authentication`, `emailVerification`, `userModel`, and `mfa`
objects distinguish sign-in capability from account or credential creation.
For example, a custom UI may call `authowl.signIn.username(...)` only when
`capabilities.authentication?.username.signIn` is true, and may offer passkey
registration only when `capabilities.authentication?.passkey.add` is true.

Sensitive mutations can return `SESSION_NOT_FRESH` with HTTP 403. Ask the user
to sign in again and retry the action. Organization ownership conflicts return
`ORGANIZATION_LAST_OWNER`. Disabled and cross-project resources return 404.
Public metadata is server-authored. Unsafe metadata is end-user-owned and must
be treated as untrusted. Private metadata has no browser SDK surface.
Durable browser session tokens stay in HttpOnly cookies and never appear in
`@authowl/react`'s `useSession()`, action results, or `listSessions()`. Core
exposes only the framework-neutral `client.sessionStore`. Session management uses
stable session ids. This is distinct from `getToken()`, which intentionally
mints a short-lived backend JWT and caches it in memory only.

## Protected public-auth actions

When broad bot protection is enabled, obtain a fresh Turnstile token with the
endpoint's exact action and pass it through `authChallengeToken`. The SDK sends
the token only in `x-authowl-turnstile-token`; it never adds it to the JSON body.
Tokens are single-use, so mint a new token for every attempt, including retries.

```ts
await authowl.signIn.email(
  { email, password },
  { authChallengeToken: turnstileToken },
);
```

| Client action | Turnstile action |
| --- | --- |
| `signUp.email` | `auth_signup` |
| `signIn.email` | `auth_signin` |
| `signIn.magicLink`, `emailOtp.sendVerificationOtp` | `auth_passwordless` |
| `requestPasswordReset` | `auth_reset` |
| `sendVerificationEmail` | `auth_verify_email` |

Drop-in React components read the public site key and manage this lifecycle
automatically. Headless clients must still render Turnstile and bind the exact
action themselves.

## Named backend JWTs

Create a named template in the AuthOwl dashboard, then mint it from the signed-in
browser session:

```ts
const token = await authowl.getToken({ template: 'supabase' });
const freshToken = await authowl.getToken({
  template: 'supabase',
  forceRefresh: true,
});
```

Template names are normalized to lowercase. Tokens stay memory-only and are
cached separately by environment, user, active organization, template, and
server policy version. A forced refresh bypasses only the selected template.
Plain `getToken()` keeps the original unnamed-token contract.

See the full integration guide in the AuthOwl app repo (`INTEGRATION.md`).

## License

MIT
