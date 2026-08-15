<p align="center">
  <img src=".github/authowl-banner.png" alt="AuthOwl - Authentication that never sleeps" width="820">
</p>

<p align="center">
  <b>Official AuthOwl SDKs for web, mobile, and backend applications.</b><br>
  One project contract across TypeScript, React, Next.js, React Native, Expo,
  Flutter, Go, Python, PHP, Rust, Convex, and the CLI.
</p>

<p align="center">
  <a href="https://authowl.dev">authowl.dev</a> &nbsp;·&nbsp;
  <a href="https://authowl.dev/docs/sdks">SDK docs</a> &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/org/authowl">npm</a>
</p>

<p align="center">
  <img alt="npm" src="https://img.shields.io/badge/npm-@authowl-CB3837?logo=npm&logoColor=white">
  <img alt="Types" src="https://img.shields.io/badge/types-included-3178C6?logo=typescript&logoColor=white">
  <img alt="ESM + CJS" src="https://img.shields.io/badge/module-ESM%20%2B%20CJS-F5B84C">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

## Packages

| Package | What it's for |
| --- | --- |
| **Web** | [`@authowl/core`](./packages/auth-core), [`@authowl/react`](./packages/auth-react), [`@authowl/next`](./packages/auth-next), and [`@authowl/convex`](./packages/auth-convex). |
| **Mobile** | [`@authowl/react-native`](./packages/auth-react-native), [`@authowl/expo`](./packages/auth-expo), and [`authowl`](./sdks/flutter) for Flutter. |
| **Backend** | [`@authowl/core/server`](./packages/auth-core), [Go](./sdks/go), [Python](./sdks/python), [PHP](./sdks/php), and [Rust](./sdks/rust). |
| **Tooling** | [`authowl`](./packages/cli), the CLI for secure browser login, project detection, transactional setup, and user migration. |

## Install

```bash
pnpm add @authowl/react          # React apps
pnpm add @authowl/next           # Next.js (App Router, server side)
pnpm add @authowl/convex convex  # Convex backends
pnpm add @authowl/core           # anything else / your own UI
npm install @authowl/react-native # bare React Native
npx expo install @authowl/expo expo-secure-store
flutter pub add authowl flutter_secure_storage
```

Backend install commands and complete examples are listed in the
[SDK documentation](https://authowl.dev/docs/sdks).

## Quick start &mdash; React

```tsx
import { AuthOwlProvider, SignIn, SignedIn, SignedOut, UserButton, useUser } from '@authowl/react';

function App() {
  return (
    <AuthOwlProvider
      publishableKey={import.meta.env.VITE_AUTHOWL_PUBLISHABLE_KEY}
      apiUrl="https://auth.yourdomain.com"
    >
      <SignedOut><SignIn /></SignedOut>
      <SignedIn><Dashboard /></SignedIn>
    </AuthOwlProvider>
  );
}

function Dashboard() {
  const { user } = useUser();
  return (
    <header>
      <span>Hi, {user?.email}</span>
      <UserButton />
    </header>
  );
}
```

The provider reads your project's public config and renders exactly the sign-in methods
you enabled &mdash; password, magic links, email OTP, passkeys, social &mdash; with nothing
to wire. RTL and Arabic are handled automatically.

## Quick start &mdash; Next.js (App Router)

`@authowl/next` is zero-config: set the env vars and call `auth()` in any Server Component
or route handler.

```bash
# .env.local
AUTHOWL_PUBLISHABLE_KEY=pk_live_…
AUTHOWL_API_URL=https://auth.yourdomain.com
```

```tsx
import { auth } from '@authowl/next/server';

export default async function Page() {
  const session = await auth(); // null if signed out
  return <p>{session ? `Hi, ${session.user.email ?? session.user.phoneNumber}` : 'Signed out'}</p>;
}
```

## Quick start &mdash; Convex

```tsx
import { ConvexProviderWithAuthOwl } from '@authowl/convex';
import { AuthOwlProvider, useAuth } from '@authowl/react';

<AuthOwlProvider publishableKey={pk} apiUrl={apiUrl}>
  <ConvexProviderWithAuthOwl client={convex} useAuth={useAuth}>
    <App />
  </ConvexProviderWithAuthOwl>
</AuthOwlProvider>
```

Convex verifies the AuthOwl-issued JWT against your project's JWKS &mdash; no shared secret,
no extra round-trip.

## Server-side user management

`@authowl/core/server` provides a typed Admin API client generated from
AuthOwl's versioned OpenAPI contract. Keep its secret key in server-only code.

```ts
import { createAdminClient } from '@authowl/core/server';

const authowl = createAdminClient({
  secretKey: process.env.AUTHOWL_SECRET_KEY!,
  apiUrl: process.env.AUTHOWL_API_URL!,
});

const users = await authowl.listUsers({ query: { limit: 25 } });
const created = await authowl.createUser({
  body: { email: 'mona@example.com', name: 'Mona' },
});
```

See the [Admin API SDK reference](./docs/admin-api.md),
[phone OTP and Akedly Shield guide](./docs/phone-otp.md), and
[webhook signature guide](./docs/webhooks.md). Webhook verification is exported
only from `@authowl/core/server` and works in Node and worker Web Crypto runtimes.

## What's in the box

- **Components:** `SignIn`, `SignUp`, `PhoneOTP`, `UserButton`, `UserProfile`, `SocialButtons`, `MagicLinkForm`,
  `EmailOtpForm`, `PasskeyButton`, `PasskeyManager`, `MFAEnrollment`, `MFAChallenge`,
  `BackupCodesManager`, `ForgotPassword`, `ResetPassword`, `VerifyEmail`, `ConsentGate`,
  `OrganizationSwitcher`, `OrganizationList`, `CreateOrganization`, `OrganizationProfile`,
  `GoogleOneTap`, `AuthOwlBadge`
- **Control flow:** `<SignedIn>`, `<SignedOut>`, `<Protect>`, `<SignOutButton>`
- **Hooks:** `useUser`, `useSession`, `useSignIn` (including phone start/verify), `useSignOut`, `useLocale`
- **Typed errors:** `AuthOwlError`, `RateLimitedError`, `InvalidKeyError`

Every package ships dual **ESM + CJS** builds with bundled TypeScript types, and auto-reads
`AUTHOWL_*` / `VITE_AUTHOWL_*` environment variables.

## Any framework

Not on React, Next, or Convex? `@authowl/core` is a typed, framework-agnostic client, and
every AuthOwl project also exposes a plain **REST API** &mdash; sign-in, sessions, and a JWT you
can verify anywhere against the project's public JWKS.

## Visual development

Storybook documents the account, organization, and conversion components with
English/Arabic and light/dark toolbar controls:

```bash
pnpm storybook
pnpm build:storybook
pnpm test:storybook  # real Chromium smoke, interaction, and axe checks
```

## Security model

- **Publishable keys** (`pk_test_…` in development, `pk_live_…` in production)
  are safe to embed in client code. They are scoped to an environment and to
  specific origins, both enforced server-side.
- **Session tokens** live only in `HttpOnly + Secure + SameSite=None` cookies.
  Browser session state, action responses, and device lists expose stable ids
  and safe metadata, never the durable token.
- `getToken()` is deliberately separate: it mints a short-lived, memory-only
  backend JWT for a configured verifier and never reveals the browser session
  cookie value.
- The SDK **refuses to initialise** a live key with any non-HTTPS `apiUrl`.
  Test keys allow HTTP only for exact loopback development hosts (`localhost`,
  `*.localhost`, `127.0.0.1`, and `[::1]`).
- Server-side JWT verification pins ES256, refuses JWKS redirects, and bounds
  JWKS fetch time, response bytes, key count, and public-key schema.
- Browser-facing exports reject any `secretKey`.
- **Secret keys** (`sk_test_…` in development, `sk_live_…` in production) are
  accepted only by `@authowl/core/server` for Node-only admin calls.

## Links

- Product &amp; dashboard &mdash; **[authowl.dev](https://authowl.dev)**
- Documentation &mdash; **[SDK guides](https://authowl.dev/docs/sdks)**
- Dashboard Connect flow &mdash; **[Create or open a project](https://authowl.dev/projects)**

## License

[MIT](./LICENSE) © AuthOwl
