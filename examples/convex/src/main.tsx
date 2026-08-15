import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexReactClient, useConvexAuth, useQuery } from 'convex/react';
import { ConvexProviderWithAuthOwl } from '@authowl/convex';
import { AuthOwlProvider, SignIn, UserButton, useAuth, useUser } from '@authowl/react';
import '@authowl/react/styles.css';
// Committed boilerplate; `npx convex dev` refreshes it (needs a Convex account).
import { api } from '../convex/_generated/api';

const PK = import.meta.env.VITE_AUTHOWL_PK as string | undefined;
const API_URL = (import.meta.env.VITE_AUTHOWL_API_URL as string | undefined) ?? 'http://localhost:3010';
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;

function Page() {
  const { user, isLoaded, isSignedIn } = useUser();
  const convexAuth = useConvexAuth();
  // The acceptance probe: Convex runs this query with the AuthOwl JWT and
  // returns the identity it verified against the project's JWKS.
  const me = useQuery(api.me.me, convexAuth.isAuthenticated ? {} : 'skip');

  if (!isLoaded) return <p>Loading…</p>;
  if (!isSignedIn || !user) {
    return (
      <div style={{ maxWidth: 360, margin: '64px auto', fontFamily: 'system-ui' }}>
        <SignIn />
      </div>
    );
  }
  return (
    <div style={{ padding: 32, fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Hello, {user.email ?? user.phoneNumber ?? user.name ?? 'there'}</h1>
        <UserButton />
      </header>
      <h2>What Convex sees</h2>
      {convexAuth.isLoading ? (
        <p>Authenticating with Convex…</p>
      ) : !convexAuth.isAuthenticated ? (
        <p>Convex rejected the token — check convex/auth.config.ts against your project&apos;s jwtIssuer config.</p>
      ) : me === undefined ? (
        <p>Loading identity…</p>
      ) : (
        <pre>{JSON.stringify(me, null, 2)}</pre>
      )}
    </div>
  );
}

if (!PK || !CONVEX_URL) {
  document.getElementById('root')!.innerHTML =
    '<p style="font-family:system-ui;padding:32px">Set <code>VITE_AUTHOWL_PK</code> and <code>VITE_CONVEX_URL</code> in <code>.env.local</code>.</p>';
} else {
  const convex = new ConvexReactClient(CONVEX_URL);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AuthOwlProvider publishableKey={PK} apiUrl={API_URL}>
        <ConvexProviderWithAuthOwl client={convex} useAuth={useAuth}>
          <Page />
        </ConvexProviderWithAuthOwl>
      </AuthOwlProvider>
    </React.StrictMode>,
  );
}
