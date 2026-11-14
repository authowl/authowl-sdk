# @authowl/billing

Feature entitlements for applications that bill through AuthOwl.

## Install

Install the package and the peers used by your application:

```bash
pnpm add @authowl/billing @authowl/core @authowl/react @authowl/next react next
```

The React and Next peers are optional. Install only the integrations you use.

## Client

```ts test="client"
import { createAuthOwlClient, resolveConfig } from '@authowl/core';
import { createBillingClient } from '@authowl/billing';

const core = createAuthOwlClient(resolveConfig({
  publishableKey: process.env.AUTHOWL_PUBLISHABLE_KEY!,
  apiUrl: process.env.AUTHOWL_API_URL!,
}));
const billing = createBillingClient(core);

const unsubscribe = billing.subscribe(() => {
  const reportsAllowed = billing.has({ feature: 'reports' });
});
const live = await billing.check({ feature: 'exports' });
await billing.refresh();
unsubscribe();
```

`has()` fails closed. It returns false while loading, after an error, when the
snapshot is stale for 60 seconds, when signed out, for every non `ok` reason,
and for an unknown feature. Until something subscribes, `has()` returns false
and `refresh()` does nothing. `check()` works without a subscription.

## React

```tsx test="react"
import {
  Protect as BillingProtect,
  useEntitlements,
} from '@authowl/billing/react';
import { Protect as RoleProtect } from '@authowl/react';

export function Reports() {
  const {
    entitlements,
    has,
    isLoading,
    isStale,
    reason,
    error,
    refresh,
    check,
  } = useEntitlements();

  return (
    <RoleProtect role="admin">
      <BillingProtect feature="reports" fallback={<p>Upgrade to view reports.</p>}>
        <p>Reports are available.</p>
      </BillingProtect>
    </RoleProtect>
  );
}
```

`Protect` renders its fallback during server rendering, hydration, loading,
errors, stale data, signed out and pending MFA states, every non `ok` reason, a
denied row, and an unknown feature. It is advisory UI only. Enforce access on
the server. Alias one or both `Protect` imports when billing and role or
permission gates appear in the same file.

`useEntitlements()` exposes the current `entitlements`, snapshot based `has`,
`isLoading`, `isStale`, `reason`, `error`, `refresh`, and live `check` fields.
Keep one hook mounted in a layout so route changes can swap gated components
without a refetch or fallback flash.

## Next server

`requireFeature` is the enforcement gate for a route handler. It distinguishes
an unauthenticated request, a subject that has not checked out, and a subject
whose plan lacks the feature. An outage is rethrown for the handler to manage.

```ts test="next-require"
import { isAuthorizationError } from '@authowl/next/server';
import {
  FeatureDeniedError,
  requireFeature,
} from '@authowl/billing/server';

export async function GET() {
  try {
    const check = await requireFeature({ feature: 'reports' });
    return Response.json(check);
  } catch (error) {
    if (isAuthorizationError(error) && error.reason === 'unauthenticated') {
      return new Response('Authentication required', { status: 401 });
    }
    if (error instanceof FeatureDeniedError) {
      if (error.denial === 'no_customer') {
        return Response.json({ destination: 'checkout' }, { status: 403 });
      }
      if (error.denial === 'not_granted') {
        return Response.json({ destination: 'upgrade' }, { status: 403 });
      }
      return new Response('Feature unavailable', { status: 403 });
    }
    throw error;
  }
}
```

`hasFeature` is the fail closed form for a server component.

```tsx test="next-has"
import { hasFeature } from '@authowl/billing/server';

export default async function ReportsLink() {
  const allowed = await hasFeature({ feature: 'reports' });
  return allowed ? <a href="/reports">Reports</a> : null;
}
```

The server entry needs `@authowl/next` and `next`. Its secret key comes from
`AUTHOWL_SECRET_KEY` or the `secretKey` option, never from a key passed to
`initAuth`. For organization billed projects, select an active organization
before checking a feature. Without one, `hasFeature` returns false and
`requireFeature` denies with `no_organization`.
Never set `fetchCache` to `force-cache` on a segment that enforces features.

## Other Node servers

Use `checkFeature` with an explicit subject, or call the Admin API endpoint
`POST /api/v1/billing/check` directly from another server framework.

```ts test="check-feature"
import { checkFeature } from '@authowl/billing/server';

export async function canUseReports(userId: string): Promise<boolean> {
  const check = await checkFeature({ feature: 'reports', userId }, {
    secretKey: process.env.AUTHOWL_SECRET_KEY!,
    apiUrl: process.env.AUTHOWL_API_URL!,
  });
  return check.allowed;
}
```

Keys used by server checks need the `billing:read` scope. Keys created before
that scope existed do not have it. A key's scopes cannot be edited, so create a
new secret key with `billing:read`.

## Decisions and freshness

For metered features, `has()` is only a hint from the last snapshot. `check()`
and the server helpers ask for a live decision.

A subject gets a billing customer after it checks out. Before that, checks use
the reason `no_customer`. This is different from `not_granted`, which means the
customer's plan does not include the feature. Client checks expose `reason` and
server enforcement exposes `FeatureDeniedError.denial`, so applications can
choose checkout or upgrade behavior.

A change to what a plan includes reaches signed in users within about an hour
and can take up to a day in a very large environment. Boolean checks share that
lag. Metered checks are live.

## License

MIT
