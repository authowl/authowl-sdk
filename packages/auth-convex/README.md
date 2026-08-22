# @authowl/convex

**[Complete SDK guide](https://authowl.dev/docs/sdks/convex)** ·
**[JWT issuer setup](https://authowl.dev/docs/backend/convex)**

Use [Convex](https://convex.dev) with [AuthOwl](https://authowl.dev) the same
way it pairs with Clerk — `ConvexProviderWithAuthOwl` is a 1:1 mirror of
`ConvexProviderWithClerk`, so switching is a one-line provider swap. Convex
verifies AuthOwl's JWTs statelessly against your project's published JWKS and
makes **zero** AuthOwl calls at request time.

```bash
pnpm add @authowl/convex@^0.1.5 @authowl/react@^0.21.1 convex
```

These minimum AuthOwl versions include the React StrictMode session-remount fix.

## 1. Enable the JWT issuer and create the Convex template

In the project dashboard, open **Configure -> JWT templates**, enable the
environment's JWT issuer, and create the **Convex** preset with the template
name `convex`. The AuthOwl adapter requests this exact name and keeps its cache
separate from every other backend token.

Under **Configure -> Domains**, allow the exact application origin. The
publishable key must come from the same AuthOwl project whose issuer and
audience you configure in Convex.

Your project's public config carries the verifier values in its `jwtIssuer`
block: `{ issuer, jwksUrl, aud }`.

## 2. Point Convex at your project

```ts
// convex/auth.config.ts
export default {
  providers: [
    {
      type: "customJwt",
      issuer: "<jwtIssuer.issuer>",
      jwks: "<jwtIssuer.jwksUrl>",
      applicationID: "<jwtIssuer.aud>", // = your AuthOwl project id
      algorithm: "ES256",
    },
  ],
};
```

## 3. Wrap your app

```tsx
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuthOwl } from "@authowl/convex";
import { AuthOwlProvider, useAuth } from "@authowl/react";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

<AuthOwlProvider publishableKey="pk_live_…" apiUrl="https://…">
  <ConvexProviderWithAuthOwl client={convex} useAuth={useAuth}>
    <App />
  </ConvexProviderWithAuthOwl>
</AuthOwlProvider>;
```

Convex functions then see the AuthOwl user:

```ts
const identity = await ctx.auth.getUserIdentity();
// identity.subject = AuthOwl user id; identity.email, identity.name, …
```

On a fresh Convex deployment, link it first, set `AUTHOWL_ISSUER_URL` and
`AUTHOWL_PROJECT_ID`, then deploy the functions again. The first deployment may
stop after linking because those server variables do not exist yet.

Migrating from Clerk? Replace `ConvexProviderWithClerk` with
`ConvexProviderWithAuthOwl` and Clerk's `useAuth` with `@authowl/react`'s —
nothing else changes.
