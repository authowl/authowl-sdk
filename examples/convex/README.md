# AuthOwl + Convex example

The plan-17 acceptance rig: sign in with `<SignIn/>`, and a Convex query
(`convex/me.ts`) returns the identity Convex verified **statelessly** from the
AuthOwl JWT. Convex needs only the public JWKS for local signature verification;
it never calls AuthOwl for session introspection or private user state.

## Run it

1. **AuthOwl side** — create a project, enable **Settings → JWT issuer**,
   issue a publishable key, and allow `http://localhost:5174` as an origin.
2. **Convex side** - anonymous local deployments need no Convex account:

   ```sh
   pnpm dev:convex
   # In another terminal, after the local backend is ready:
   pnpm configure:local -- <jwtIssuer.issuer> <jwtIssuer.aud>
   ```

   The helper configures the local deployment's environment and pushes the
   verifier without printing its local admin credential. `jwtIssuer` values
   come from your project's public config. Copy the issuer exactly: even
   equivalent local hostnames such as `localhost` and `127.0.0.1` are different
   JWT issuers.

   For a linked Convex cloud deployment, use the normal commands instead:

   ```sh
   npx convex env set AUTHOWL_ISSUER_URL <jwtIssuer.issuer>
   npx convex env set AUTHOWL_PROJECT_ID <jwtIssuer.aud>
   ```
3. **App side** — `.env.local`:

   ```sh
   VITE_AUTHOWL_PK=pk_live_…
   VITE_AUTHOWL_API_URL=http://localhost:3010
   VITE_CONVEX_URL=https://<deployment>.convex.cloud
   ```

4. `pnpm dev` (with `npx convex dev` still running) → sign in → the page
   shows the identity Convex extracted from the verified token.

> Convex Cloud must be able to reach the JWKS URL, so a cloud deployment still
> needs a tunnel or deployed AuthOwl instance. The anonymous local backend can
> reach local AuthOwl directly and is the repository's zero-cost acceptance
> path.
