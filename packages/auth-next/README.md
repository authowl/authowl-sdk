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
used only by the server route and must never use a `NEXT_PUBLIC_` prefix.

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

For the remaining client-side components, use
[`@authowl/react`](https://www.npmjs.com/package/@authowl/react).
Those components use AuthOwl gold (`#F5B84C`) by default and automatically
honor project branding or an explicit `appearance.primaryColor` override.

**Optional UX middleware** (`@authowl/next/middleware`,
`createAuthRedirectMiddleware`) redirects unauthenticated users by cookie
presence — it is a UX helper, **not** an authorization boundary. Always authorize
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
