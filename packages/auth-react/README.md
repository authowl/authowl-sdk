# @authowl/react

**[Complete SDK guide](https://authowl.dev/docs/sdks/react)** ·
**[React quickstart](https://authowl.dev/docs/getting-started/quickstart-react)** ·
**[Error handling](https://authowl.dev/docs/sdks/errors)**

React provider, hooks, and drop-in components for [AuthOwl](https://authowl.dev),
the multi-tenant auth service. Publishable-key based, zero CSS setup.

```bash
pnpm add @authowl/react
```

```tsx
import { AuthOwlProvider, GoogleOneTap, SignIn, useUser } from '@authowl/react';
import '@authowl/react/styles.css';

function App() {
  return (
    <AuthOwlProvider publishableKey={import.meta.env.VITE_AUTHOWL_PK} apiUrl="https://auth.yourdomain.com">
      <GoogleOneTap />
      <Page />
    </AuthOwlProvider>
  );
}

function Page() {
  const { user, isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return null;
  return isSignedIn ? <p>Hi, {user.email ?? user.phoneNumber}</p> : <SignIn />;
}
```

**Components**: `<SignIn />`, `<SignUp />`, `<PhoneOTP />`, `<SocialButtons />`, `<MagicLinkForm />`,
`<EmailOtpForm />`, `<PasskeyButton />`, `<PasskeyManager />`, `<ForgotPassword />`,
`<ResetPassword />`, `<VerifyEmail />`, `<VerificationPending />`, `<MFAEnrollment />`,
`<MFAChallenge />`, `<Waitlist />`, `<ConsentGate />`, `<UserButton />`, `<SignOutButton />`,
`<SignedIn>`/`<SignedOut>`/`<Protect>`, `<AuthOwlBadge />`, `<UserProfile />`,
`<OrganizationSwitcher />`, `<OrganizationList />`, `<CreateOrganization />`,
`<OrganizationProfile />`, `<GoogleOneTap />`.

**Hooks**: `useUser`, `useSession`, `useSignIn`, `useSignUp`, `useSignOut`,
`usePasskeys`, `usePasswordReset`, `useEmailVerification`, `useMFA`, `useConsent`,
`usePublicConfig`, `useWaitlist`.

When the environment's acquisition mode is `waitlist`, `<SignUp />` automatically
renders email enrollment instead of account-creation methods. `<Waitlist />` is
also available as a standalone surface. Both use the same public endpoint,
privacy-safe accepted state, and action-bound Turnstile challenge.

The sign-up, sign-in, and account-management components also follow the
project's identity lifecycle policy. This includes separate sign-up and sign-in
permissions, username sign-in, optional username and first/last-name collection,
link or code email verification, passkey registration, email changes, account
deletion, and TOTP backup-code availability. Existing credentials remain
manageable even when creating another credential of that type is disabled.

Built-in controls use AuthOwl gold (`#F5B84C`) by default. A project color set
in the dashboard replaces it automatically, and an explicit provider override
wins over the project setting:

```tsx
<AuthOwlProvider appearance={{ primaryColor: '#0EA5A4' }} {...config} />
```

When phone OTP is enabled, `<SignIn />` adds the localized phone flow automatically.
`<PhoneOTP />` is also available as a standalone surface. Production hosts must allow
Cloudflare Turnstile's challenge script in their Content Security Policy. Local and CI
servers use AuthOwl's documented dummy-token path when no public site key is configured.
When the server selects an Akedly Shield V1.2 route, these components fetch a fresh
challenge and complete its proof-of-work and optional Turnstile ceremony automatically.
Provider API keys and pipeline credentials remain server-side. Custom phone UIs can call
`phoneOtp.prepare()` and `solvePhoneOtpChallenge()` to implement the same guarded flow.
See the [complete headless and retry guide](https://github.com/authowl/authowl-sdk/blob/main/docs/phone-otp.md).

`@akedly/shield` is installed with `@authowl/core` so every consumer bundler can
resolve the integration safely. It remains behind a dynamic import, so its
browser proof code is loaded only when the server selects a Shield route.

When broad auth protection is enabled, the sign-in, sign-up, magic-link, email
OTP, password-reset, and verification components automatically run an
action-bound Turnstile challenge. Each attempt receives a fresh single-use token,
including retries, and provider failures are announced accessibly in English or
Arabic. No extra component wiring is required.

`<GoogleOneTap />` reads the enabled Google provider and its public OAuth client id from
project config, renders no DOM, and does nothing for an existing session. Hosts with a
Content Security Policy must allow Google Identity Services as documented in Google's
[CSP guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#content_security_policy).

Publishable keys (`pk_test_…` in development, `pk_live_…` in production) are
safe to embed in client code. Durable session tokens live only in `HttpOnly` +
`Secure` + `SameSite=None` cookies. `useSession()` and `<UserProfile />` use
token-free session ids and safe device metadata.

See the [complete React guide](https://authowl.dev/docs/sdks/react) for provider
configuration, hooks, component contracts, localization, theming, and errors.

## License

MIT
