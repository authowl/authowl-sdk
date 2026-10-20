# @authowl/next

**[Complete SDK guide](https://authowl.dev/docs/sdks/next)** ·
**[Next.js quickstart](https://authowl.dev/docs/getting-started/quickstart-nextjs)**

Next.js (App Router) helpers for [AuthOwl](https://authowl.dev), the multi-tenant
auth service. `auth()` works in Server Components and route handlers.

```bash
pnpm add @authowl/next @authowl/react
```

Zero-config: set the env and call `auth()`.

```
# .env.local
AUTHOWL_PUBLISHABLE_KEY=pk_live_…
AUTHOWL_API_URL=https://auth.yourdomain.com
# Required only for the cross-origin bridge below. Keep it server-only.
AUTHOWL_SECRET_KEY=sk_live_…
```

```ts
import { auth } from '@authowl/next/server';

export default async function Page() {
  const session = await auth(); // null if not signed in
  return <p>{session ? `Hi, ${session.user.email ?? session.user.phoneNumber}` : 'Signed out'}</p>;
}
```

`initAuth({ publishableKey, apiUrl })` is optional (call it to override the env or
surface config errors at boot).

## Cross-origin auth service

When AuthOwl and your Next.js application use different parent domains, add the
session bridge. It preserves AuthOwl's browser bearer fallback for browsers that
block cross-site cookies while giving `auth()` a validated, host-only HttpOnly
session on your application origin. `AUTHOWL_SECRET_KEY` is required and must
belong to the same project and environment with the `sessions:read` scope. It is
used only on the server and must never use a `NEXT_PUBLIC_` prefix. Both the
bridge route and `auth()` present it: configure it where `auth()` runs, through
the env or `initAuth({ secretKey })`, not only through the bridge's own
`secretKey` option. `auth()` throws when it finds a bridge cookie without one.

```ts
// app/api/authowl/session/route.ts
import { createAuthOwlSessionBridge } from '@authowl/next/server';

export const POST = createAuthOwlSessionBridge();
```

Pass the bridge-aware fetch to the same client provider that renders your
AuthOwl components:

```tsx
'use client';

import { createAuthOwlNextFetch } from '@authowl/next/client';
import { AuthOwlProvider } from '@authowl/react';

const publishableKey = process.env.NEXT_PUBLIC_AUTHOWL_PUBLISHABLE_KEY!;
const apiUrl = process.env.NEXT_PUBLIC_AUTHOWL_API_URL!;
const authOwlFetch = createAuthOwlNextFetch({ publishableKey, apiUrl });

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthOwlProvider
      publishableKey={publishableKey}
      apiUrl={apiUrl}
      fetch={authOwlFetch}
    >
      {children}
    </AuthOwlProvider>
  );
}
```

The route accepts only same-origin browser requests and stores a token only
after AuthOwl validates that it belongs to a live session whose MFA enrollment
is complete. Never proxy this route through a different origin.

### Social and SSO callbacks with server-gated pages

Use a public sign-in or callback page on your application origin for the OAuth
return. Mount the bridge-aware `AuthOwlProvider` there. Keep that page and
`/api/authowl/session` reachable without an existing app-session cookie, including
in middleware and parent layouts. A Server Component cannot redeem a code from
the URL fragment, so returning directly to a page gated by `auth()` redirects the
visitor away before the browser can establish the app session.

For the drop-in forms, `redirectTo` is the final destination:

```tsx
'use client';

import { SignIn } from '@authowl/react';

export default function SignInPage() {
  return <SignIn redirectTo="/dashboard" />;
}
```

`<SignUp redirectTo="/dashboard" />` uses the same callback completion. Social
and SSO buttons return to the form page first. The SDK navigates to AuthOwl's
first-party session start endpoint, which sets the OAuth state in the auth
host's cookie context before visiting the provider. After the provider callback,
AuthOwl returns a single-use `#authowl_code` to your public page. Core removes the
fragment and redeems the code with the verifier held on your app origin. It then
awaits the Next bridge projection before completing the handoff. The form runs
its normal sign-in completion and navigates to `redirectTo`, where `auth()` can
validate the app-session cookie. Required MFA enrollment still completes before
that navigation.

For custom social or SSO controls, set `callbackURL` to a public page on the same
origin. On that page, await the client's optional `handoff` promise and finish
navigation only when it resolves `true`. A failed or expired handoff must leave
the visitor able to retry. Configure the callback origin in the project's
allowed origins.

The bridge stores only `{ sessionId, remember }` in localStorage under a
project-specific key so another tab can preserve the cookie lifetime. It uses
sessionStorage to avoid duplicate projections in the current tab. A different
session ID never inherits the previous session's remember choice. When browser
storage is unavailable, the current client retains the choice in memory;
a fresh client defaults to a session-only cookie.

For the remaining client-side components, use
[`@authowl/react`](https://www.npmjs.com/package/@authowl/react).
Those components use AuthOwl gold (`#F5B84C`) by default and automatically
honor project branding or an explicit `appearance.primaryColor` override.

**Optional UX middleware** (`@authowl/next/middleware`,
`createAuthRedirectMiddleware`) redirects unauthenticated users by cookie
presence , it is a UX helper, **not** an authorization boundary. Always authorize
on the server with `auth()`, which re-validates against the auth service.

For bearer-token route handlers, `@authowl/next/server` also re-exports
`requireAuth`, `requirePermission`, `requireGrant`, and `requireOrg`. They throw
a typed `AuthorizationError` with status 401 or 403 and never replace your own
tenant-scope and resource-ownership checks. Cookie-backed pages and route
handlers should continue to use `auth()`.

See the [complete Next.js guide](https://authowl.dev/docs/sdks/next) for provider
setup, server authorization, middleware boundaries, and environment variables.

## License

MIT
