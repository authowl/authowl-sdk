# @authowl/expo

**[Complete SDK guide](https://authowl.dev/docs/sdks/expo)** ·
**[React Native reference](https://authowl.dev/docs/sdks/react-native)**

Expo adapters for [AuthOwl](https://authowl.dev), with keychain-backed session
storage and React Native hooks.

```bash
npx expo install @authowl/expo expo-secure-store
```

This package re-exports all of [`@authowl/react-native`](../auth-react-native)
and supplies secure session storage, so an Expo app installs one package and
passes no storage adapter of its own.

## Setup

```tsx
import {
  AuthOwlProvider,
  expoStorage,
} from '@authowl/expo';

export default function Root() {
  return (
    <AuthOwlProvider
      publishableKey={process.env.EXPO_PUBLIC_AUTHOWL_PUBLISHABLE_KEY!}
      apiUrl={process.env.EXPO_PUBLIC_AUTHOWL_API_URL!}
      storage={expoStorage}
    >
      <App />
    </AuthOwlProvider>
  );
}
```

`expoStorage` is backed by `expo-secure-store` (iOS Keychain / Android Keystore).
The session cookie is a bearer credential, so it does not belong in AsyncStorage.

Expo reuses the React Native component themes. Primary controls therefore use
AuthOwl gold (`#F5B84C`) by default; pass a custom `AuthOwlTheme` to a built-in
component when the app intentionally uses another brand color.

Only `EXPO_PUBLIC_`-prefixed variables reach the app bundle - and only ever the
**publishable** key. A `sk_` key is refused at startup rather than shipped inside
a binary you cannot rotate out of users' hands.

## Social sign-in

```tsx
import { useSocialSignIn } from '@authowl/expo';

const signInWith = useSocialSignIn();
const result = await signInWith({
  provider: 'google',
  idToken: { token: googleResult.idToken },
});

if (result.error === null) router.replace('/home');
```

Obtain the ID token with the provider's supported Expo or React Native SDK. The
native AuthOwl client does not advertise redirect OAuth because the system
browser cannot share its OAuth state cookie with the SDK's secure fetch jar.

## Hooks

Everything from `@authowl/react-native` is re-exported: `useAuth`, `useUser`,
`useSession`, `useAuthOwlClient`, and `useSocialSignIn`.

```tsx
const { isLoaded, isSignedIn, user, signOut, has } = useAuth();
```

`has()` is advisory - for hiding UI the user cannot use. The real boundary is
server-side, over a verified token.

## License

MIT
