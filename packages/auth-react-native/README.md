# @authowl/react-native

**[Complete SDK guide](https://authowl.dev/docs/sdks/react-native)** ·
**[Expo adapter](https://authowl.dev/docs/sdks/expo)**

React Native provider, hooks, and secure session storage for
[AuthOwl](https://authowl.dev).

Using **Expo**? Install [`@authowl/expo`](../auth-expo) instead - it re-exports
everything here and supplies the platform adapters for you.

```bash
npm install @authowl/react-native react-native-keychain
```

## Why this package exists

The browser SDK leans on things a phone does not have: a cookie jar, a
`BroadcastChannel`, and `window.location` redirects. This package supplies native
an explicit session jar and leaves the rest to `@authowl/core/native`:

1. **A session that survives an app restart.** React Native's `fetch` cookie
   behaviour differs between iOS and Android, is invisible to JS, and does not
   reliably persist. So the SDK keeps the one cookie it cares about itself, in
   the OS keychain, and replays it on every request. The server sees exactly what
   a browser would send - no native-only server mode.

The native client deliberately excludes redirect OAuth and enterprise SSO,
which depend on browser state unavailable to a React Native fetch client.
Passkeys are available when the app supplies its platform ceremony adapter.

## Setup

```tsx
import { AuthOwlProvider } from '@authowl/react-native';
import * as Keychain from 'react-native-keychain';

const storage = {
  async getItem(key) {
    const entry = await Keychain.getGenericPassword({ service: key });
    return entry ? entry.password : null;
  },
  setItem: (key, value) =>
    Keychain.setGenericPassword(key, value, { service: key }).then(() => undefined),
  removeItem: (key) => Keychain.resetGenericPassword({ service: key }).then(() => undefined),
};

export default function Root() {
  return (
    <AuthOwlProvider
      publishableKey={PUBLISHABLE_KEY}
      apiUrl="https://api.authowl.dev"
      storage={storage}
    >
      <App />
    </AuthOwlProvider>
  );
}
```

Use the OS keychain, **not** AsyncStorage. The session cookie is a bearer
credential - anything holding it *is* the signed-in user until it expires - and
AsyncStorage is unencrypted files readable by anything in the app sandbox.

There is deliberately no default storage: silently falling back to memory would
make sign-in appear to work and then drop the session on the next launch.

## Components

Drop-in screens built from React Native primitives, using the same localization
catalogs as the web components (`@authowl/core/i18n`) so the wording never
drifts between platforms.

```tsx
import { EmailOtpForm, SignIn, SignUp, SocialButtons } from '@authowl/react-native';

<SignIn
  onSignedIn={() => router.replace('/home')}
  onSecondFactorRequired={() => router.replace('/mfa')}
/>
<SignUp onSignedUp={({ sessionCreated }) =>
  router.replace(sessionCreated ? '/home' : '/check-your-email')} />
<EmailOtpForm onSignedIn={() => router.replace('/home')} />
```

`<SignIn />` reports success **only once a session exists**. A two-factor
challenge is neither a failure nor a session, so it calls
`onSecondFactorRequired` and leaves the form intact for the app to navigate to
its challenge screen.

`<SignUp />` reports whether a session was created. Projects that require email
verification return none, and "check your email" is a different screen from
"you're in".

The provider loads the project's public capabilities once. Built-in screens
hide disabled methods, enforce the configured password length, collect required
legal consent, and send the accepted consent version automatically.

Pass `locale="ar"` to `<AuthOwlProvider>` to render Arabic. It is not
auto-detected from the device: a phone set to Arabic does not mean the app is
localized, and switching only the auth screens is worse than defaulting.

Theming is a small token set, not a cascade:

```tsx
import { darkTheme } from '@authowl/react-native';

<SignIn theme={darkTheme} />
```

Both built-in themes use AuthOwl gold (`#F5B84C`) for primary controls by
default. Pass a custom `AuthOwlTheme` to a component only when the app should
replace that brand color; `link` can optionally provide a contrast-safe inline
link color distinct from the filled-control `accent`.

Want a different look entirely? Compose the hooks instead of fighting the
components — that is what they are for.

### Organizations

```tsx
<OrganizationSwitcher onSwitched={(org) => refetch(org)} />
```

Reads the active organization from the session rather than tracking it locally,
because switching re-mints the session claim server-side. The "personal account"
row is off by default — many apps require an organization context to function.

### Passkeys

React Native has no `navigator.credentials`, but both platforms have passkey
APIs. Supply the ceremony from a native library and the SDK keeps the protocol:

```tsx
import { Passkey } from 'react-native-passkey';
import { AuthOwlProvider, createNativePasskeys } from '@authowl/react-native';

const passkeys = createNativePasskeys({
  register: (options) => Passkey.create(options as never),
  authenticate: (options) => Passkey.get(options as never),
  // Users cancel far more often than anything breaks, so map it.
  errorCode: (error) =>
    (error as { error?: string })?.error === 'UserCancelled'
      ? 'REGISTRATION_CANCELLED'
      : undefined,
});

<AuthOwlProvider {...config} passkeys={passkeys}>
```

Then:

```tsx
<PasskeyEnrollment name="iPhone" onEnrolled={next} onSkip={next} />
<PasskeySignInButton onSignedIn={() => router.replace('/home')} />
```

**Without a `passkeys` adapter these components render nothing, and the passkey
methods are absent from the client's type entirely** — so an app cannot call a
prompt the platform could never show. That also means it is safe to drop
`<PasskeyEnrollment />` into a post-sign-up flow that runs on projects with
passkeys disabled.

Both need associated-domain configuration (`webcredentials:` on iOS, Digital
Asset Links on Android) that the SDK cannot do on your behalf.

### Social buttons

`<SocialButtons />` takes the provider SDKs from your app, because they differ
per provider and platform and bundling one would force it on every consumer:

```tsx
<SocialButtons
  providers={[{
    id: 'google',
    label: 'Google',
    // Return null when the user cancels - that is not an error.
    getIdToken: async () => {
      const result = await GoogleSignin.signIn();
      return result.idToken ? { token: result.idToken } : null;
    },
  }]}
  onSignedIn={() => router.replace('/home')}
/>
```

## Hooks

```tsx
const { isLoaded, isSignedIn, user, signOut, has } = useAuth();

if (!isLoaded) return <Splash />;
if (!isSignedIn) return <SignInScreen />;

// Advisory only - for hiding UI the user cannot use. The real boundary is
// server-side, over a verified token.
if (has({ permission: 'org:billing:read' })) return <Billing />;
```

- `useAuth()` - the primary hook: user, session, `signOut`, `has`, `hasPermission`
- `useUser()` - the signed-in user, or `null`
- `useSession()` - raw session state (`isPending`, `error`, `refetch`)
- `useAuthOwlClient()` - native-safe sign-in, account, organization, and passkey management actions
- `useSocialSignIn()` - exchanges a provider-issued ID token for an AuthOwl session

## Social sign-in

Obtain an ID token with the provider's native SDK, then exchange it through the
hook. The request and session response use the same secure cookie jar.

```tsx
const signInWith = useSocialSignIn();
const result = await signInWith({
  provider: 'google',
  idToken: { token: googleResult.idToken },
});
```

Redirect OAuth is not exposed because the AuthOwl fetch cookie jar and a system
browser do not share the OAuth state cookie. A deep link alone cannot establish
the app session safely.

## License

MIT
