# @authowl/convex

**[Complete SDK guide](https://authowl.dev/docs/sdks/convex)** ·
**[JWT issuer setup](https://authowl.dev/docs/backend/convex)**

Use [Convex](https://convex.dev) with [AuthOwl](https://authowl.dev) the same
way it pairs with Clerk — `ConvexProviderWithAuthOwl` is a 1:1 mirror of
`ConvexProviderWithClerk`, so switching is a one-line provider swap. Convex
verifies AuthOwl's JWTs statelessly against your project's published JWKS and
makes **zero** AuthOwl calls at request time.

```bash
pnpm add @authowl/convex @authowl/react convex
```

## 1. Enable the JWT issuer and create the Convex template

In the project dashboard, enable the JWT issuer, then open **Sessions → JWT
templates** and create the `convex` preset. The AuthOwl adapter requests this
named template and keeps its cache separate from every other backend token.

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

Migrating from Clerk? Replace `ConvexProviderWithClerk` with
`ConvexProviderWithAuthOwl` and Clerk's `useAuth` with `@authowl/react`'s —
nothing else changes.
