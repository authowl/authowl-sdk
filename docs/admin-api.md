# AuthOwl Admin API SDK

`@authowl/core/server` is the typed server client for AuthOwl's `/api/v1`
Admin API. Its operation inputs and results are generated from the versioned
OpenAPI document checked into this repository.

## Create a client

```ts
import { createAdminClient } from '@authowl/core/server';

const authowl = createAdminClient({
  secretKey: process.env.AUTHOWL_SECRET_KEY!,
  apiUrl: process.env.AUTHOWL_API_URL!,
});
```

`apiUrl` can be the deployment origin, such as `https://auth.example.com`, or
the same URL ending in `/api/v1`. HTTP is accepted only for localhost. The
client refuses to run in a browser and never derives project identity from the
key text. AuthOwl verifies the key and applies its project scope on the server.

## Call operations

Generated calls use three explicit input sections:

- `path` for path parameters
- `query` for query parameters
- `body` for JSON request bodies

```ts
const created = await authowl.createUser({
  body: { email: 'mona@example.com', name: 'Mona' },
});

const users = await authowl.listUsers({
  query: { limit: 25, query: 'mona' },
});

await authowl.revokeUserSessions({
  path: { userId: created.id },
});

const metadata = await authowl.updateUserMetadata({
  path: { userId: created.id },
  body: {
    expected_version: created.metadata_version,
    public_metadata: { locale: 'ar' },
    private_metadata: { billingTier: 'pro' },
  },
});

await authowl.updateSessionMetadata({
  path: { sessionId: 'session-id' },
  body: { expected_version: 0, metadata: { checkout: 'review' } },
});

const message = await authowl.sendMessage({
  header: { 'Idempotency-Key': `order-${order.id}-shipped` },
  body: {
    to: customer.phone,
    channel: 'auto',
    template: 'order_shipped',
    locale: 'ar',
    variables: { orderNumber: order.number },
    customerReference: order.id,
  },
});
```

The client currently includes operations for:

- users, user metadata, sessions, and session metadata
- organizations, members, and custom roles
- invitations
- audit events and overview statistics
- webhook endpoints, secret rotation, pause/resume, and test delivery
- webhook delivery inspection and replay
- transactional SMS and WhatsApp send, status, and privacy-safe history

Messaging methods are server-only because they require a scoped `sk_*` key.
Create a dedicated key whose only scope is `messages:send` for sending. Every
send requires an idempotency key; reusing it with the same body returns the
original delivery, while reusing it with different content is rejected. The
provider, managed-versus-BYOK credentials, routing, and failover policy stay in
the AuthOwl dashboard, so application code does not change when providers do.
See the [AuthOwl Akedly integration guide](https://authowl.dev/docs/integrations/akedly)
for Shield and Utilities pipeline setup, recipient eligibility, template
approval, and the current production activation gate.

The named methods are also available through the typed dispatcher when an
operation ID is selected dynamically:

```ts
await authowl.request('getUser', { path: { userId: 'user_123' } });
```

## Handle errors

RFC 9457 problem responses become `AuthOwlAdminApiError`. Use the stable
`code` for application behavior and keep the request ID for support and
observability.

```ts
import { AuthOwlAdminApiError, AuthOwlAdminNetworkError } from '@authowl/core/server';

try {
  await authowl.createUser({ body: { email: 'mona@example.com' } });
} catch (error) {
  if (error instanceof AuthOwlAdminApiError) {
    if (error.status === 429) {
      console.warn('Rate limited', { retryAfter: error.retryAfter, requestId: error.requestId });
    }
    if (error.code === 'MAU_LIMIT_REACHED') {
      // Ask the workspace owner to raise the project limit.
    }
  } else if (error instanceof AuthOwlAdminNetworkError) {
    // kind: aborted | timeout | network | response_too_large | invalid_response
    // Retry only according to your application's operation and idempotency policy.
  }
}
```

All Admin calls require HTTPS except exact loopback development, refuse
redirects, use a 10-second total deadline, cap responses at 1 MiB, require a
JSON media type for successful bodies, and validate successful payloads against
the generated OpenAPI response schema. Transport failures never retain the
request URL, authorization header, body, or underlying error text.

Missing and cross-project resources both return `NOT_FOUND`. This prevents
tenant discovery. A publishable key returns `SECRET_KEY_REQUIRED`, an invalid
secret returns `INVALID_SECRET_KEY`, and a valid key without the operation's
scope returns `INSUFFICIENT_SCOPE`.

Metadata writes use optimistic versions. On `VERSION_CONFLICT`, fetch the user
or session again and retry with its current `metadata_version`. Never place
private metadata in browser code or send it through the publishable-key client.

## Contract generation

To sync a new server contract deliberately:

```bash
node scripts/generate-admin-api.mjs --source ../authowl/openapi/v1.json
pnpm admin:generate:check
```

The generated-file check is part of the test and CI gates. Review the OpenAPI
snapshot and generated changes together. Do not edit generated files directly.

The package exports `ADMIN_API_SPEC_SHA256` so diagnostics can identify the
exact contract used to build a deployed SDK without exposing credentials.
