import type {
  AuthActionResult,
  AuthOwlClient,
  AuthPasskey,
  DeletePasskeyData,
  EmailAuthData,
  EmailOtpAuthData,
  EmailSignUpData,
  MagicLinkData,
  PhoneOtpStartData,
  PhoneOtpChallengeData,
  PhoneOtpVerifyData,
  PasswordResetData,
  SendOtpData,
  SendTwoFactorOtpData,
  SocialAuthData,
  SocialIdTokenOptions,
  SsoAuthData,
  SignOutData,
  TwoFactorBackupCodesData,
  TwoFactorEnableData,
  TwoFactorRedirectData,
  TwoFactorStatusData,
  TwoFactorVerifyData,
  UpdatePasskeyData,
  VerificationEmailData,
  VerifyEmailOtpData,
} from './client';
import type { ResolvedAuthConfig } from './config';
import {
  createAuthActionHelpers,
  createAuthHttpClient,
  type AuthHttpClient,
} from './http-client';
import { createSessionController } from './session-store';
import type { SessionBinding } from './session-transport';
import { isBrowserRuntime } from './browser-runtime';

/**
 * Hold every request until the handoff exchange settles.
 *
 * Cleared only AFTER it settles, so a caller arriving in the same tick still
 * awaits it rather than slipping past a flag that was reset too early. The
 * exchange itself must bypass the gate - it IS the thing being waited on - which
 * is why it is handed the ungated client.
 */
function gateOnHandoff(
  http: AuthHttpClient,
  handoff: Promise<unknown> | undefined,
): AuthHttpClient {
  if (!handoff) return http;
  let pending: Promise<unknown> | null = handoff.catch(() => undefined);
  void pending.then(() => { pending = null; });
  return {
    async request(path, options) {
      if (pending) await pending;
      return http.request(path, options);
    },
  };
}

/**
 * The handoff code lives in the DOCUMENT's URL, so it is redeemed once per
 * document, not once per client. `AuthOwlProvider` builds its client inside a
 * `useMemo`, which React StrictMode double-invokes: without this the first
 * invocation would consume the fragment and the second - whose client is the one
 * actually committed - would find nothing and start signed out, in dev only.
 */
const documentHandoffs = new Map<string, Promise<boolean>>();
function redeemHandoffOnce(
  http: AuthHttpClient,
  binding: SessionBinding,
  projectId: string,
): Promise<boolean> | undefined {
  // Keyed by project, not global: two providers for different projects on one
  // page would otherwise share one promise, and the second would await an
  // exchange posted to the FIRST project's endpoint - where the code does not
  // exist, since redemption is project-scoped.
  let handoff = documentHandoffs.get(projectId);
  if (!handoff) {
    // Bind the fragment to this client before the lazy module loads. An older
    // provider created without a code must not consume a callback that arrives
    // later, and a page with no callback needs no handoff gate or chunk.
    const code = new URLSearchParams(window.location.hash.slice(1)).get('authowl_code');
    if (!code) return undefined;
    handoff = import('./session-handoff').then(
      (module) => module.completeCrossSiteSignIn(http, binding, code),
    );
    documentHandoffs.set(projectId, handoff);
  }
  return handoff;
}

/**
 * Which transport a redirect sign-in uses.
 *
 * `first-party` navigates to `/auth/session/start` so the OAuth `state` cookie
 * is written in the context the callback reads it from - the whole point of the
 * transport. `legacy` posts `/sign-in/social` as before, and is chosen only when
 * the flow has no redirect to fix: the ID-token variant mints in place, and
 * `disableRedirect` means the caller wants the URL rather than the navigation.
 *
 * `beginCrossSiteSignIn` can also decline a call it cannot serve (a destination
 * on another origin), which falls through to the same legacy path.
 */
function redirectTransport(params: {
  idToken?: unknown;
  disableRedirect?: boolean;
  scopes?: string[];
  loginHint?: string;
  requestSignUp?: boolean;
}): 'first-party' | 'legacy' {
  if (!isBrowserRuntime()) return 'legacy';
  // Neither of these involves a redirect, so neither has the problem.
  if (params.idToken || params.disableRedirect) return 'legacy';
  return 'first-party';
}
import { createIdempotencyKey } from './idempotency';
import { createAccountClient } from './account-client';
import { createOrganizationClient } from './organization-client';
import { createPrivacyClient } from './privacy-client';
import {
  decodeEmailOtpSignIn,
  decodeEmailSignIn,
  decodeEmailSignUp,
  decodeMagicLink,
  decodePasswordReset,
  decodePhoneOtpStart,
  decodePhoneOtpChallenge,
  decodePhoneOtpVerify,
  decodeSendOtp,
  decodeSendTwoFactorOtp,
  decodeSignOut,
  decodeSocialSignIn,
  decodeSsoSignIn,
  decodeTwoFactorBackupCodes,
  decodeTwoFactorEnable,
  decodeTwoFactorStatus,
  decodeTwoFactorVerify,
  decodeVerificationEmail,
  decodeVerifyEmailOtp,
} from './auth-action-response';
import {
  decodeDeletedPasskey,
  decodePasskeys,
  decodeUpdatedPasskey,
} from './passkey-response';
import {
  invalidPasskeyName,
  validatePasskeyName,
} from './passkey-name';

type AuthActionClient = Omit<
  AuthOwlClient,
  'getToken' | 'getConsentStatus' | 'acceptConsent' | 'waitlist'
>;

/** Native social sign-in uses an ID token obtained from the provider SDK. */
export interface NativeSocialSignInOptions {
  provider: string;
  idToken: SocialIdTokenOptions;
  requestSignUp?: boolean;
}

type NativeSignInClient = Omit<
  AuthActionClient['signIn'],
  'social' | 'sso' | 'passkey'
> & {
  social(
    params: NativeSocialSignInOptions,
    fetchOptions?: Parameters<AuthActionClient['signIn']['social']>[1],
  ): ReturnType<AuthActionClient['signIn']['social']>;
};

type NativePasskeyClient = Omit<
  AuthActionClient['passkey'],
  'addPasskey'
>;

interface PasskeyCeremonyClient {
  signIn: AuthActionClient['signIn']['passkey'];
  add: AuthActionClient['passkey']['addPasskey'];
}

export type PasskeyCeremonyClientFactory = (
  http: ReturnType<typeof createAuthHttpClient>,
  sessionChanged: () => void,
) => PasskeyCeremonyClient;

/**
 * Auth actions that can execute without browser navigation or WebAuthn.
 *
 * Social sign-in requires a provider ID token. Redirect OAuth, enterprise SSO,
 * passkey sign-in, and passkey registration need browser state or WebAuthn and
 * are deliberately absent from the native surface.
 */
export type NativeAuthClient = Omit<
  AuthActionClient,
  'signIn' | 'passkey'
> & {
  signIn: NativeSignInClient;
  passkey: NativePasskeyClient;
};

/** Internal browser-capable action client composed by createAuthOwlClient. */
export function createAuthActionClient(
  config: ResolvedAuthConfig,
  onSessionMutation: () => void = () => undefined,
  createPasskeys: PasskeyCeremonyClientFactory = unavailablePasskeyClient,
): AuthActionClient {
  const rawHttp = createAuthHttpClient(config);
  const tokens = config.session.tokens;
  // A social or magic-link return leg carries a one-time code in the fragment.
  // Redeem it BEFORE the first `/get-session`, or that fetch reports "signed
  // out" for a user who just finished signing in. Started here rather than
  // awaited: the controller only fetches once something subscribes, and it
  // awaits this first.
  // Loaded on demand, so React Native never pulls it in: `native.ts` is kept
  // separate precisely to keep browser-only modules out of a bundle that cannot
  // run them, and `canUseCrossSiteTransport()` is false there anyway.
  const handoff = isBrowserRuntime()
    ? redeemHandoffOnce(rawHttp, config.session, config.decoded.projectId)
    : undefined;
  // Gated at the CLIENT, not just at the session fetch. Everything that depends
  // on the session cookie shares this instance - `account.*`, `organization.*`,
  // passkeys - and any of them firing on the return leg before the exchange
  // lands gets a 401 for a user who has just signed in.
  const http = gateOnHandoff(rawHttp, handoff);
  const session = createSessionController({
    http,
    // The same endpoint reached through the DETACHED fetch. Built here because
    // this is where a config becomes a client, and the probe is a client like
    // any other - it just carries no session, which is the entire point of it.
    probe: createAuthHttpClient({ ...config, fetch: config.session.probe }),
    tokens,
    channelName: `authowl:${config.decoded.projectId}`,
  });
  const passkeys = createPasskeys(http, session.notifyMutation);
  const notifyMutation = () => {
    session.notifyMutation();
    onSessionMutation();
  };

  const { post, mutation: sessionMutation } = createAuthActionHelpers(
    http,
    notifyMutation,
  );
  const allowHttpLoopback = config.decoded.env === 'test';

  /**
   * Declare that a session BEGINS at this call, before the request goes out.
   *
   * IT HAS TO BE HERE, NOT IN THE TRANSPORT. The obvious alternative is for the
   * fetch decorator to notice the minting paths by URL, and it is wrong for the
   * reason this whole track keeps failing: the server mints on ANY response
   * carrying a live session `Set-Cookie` - both credential sign-ins, email OTP,
   * phone OTP verification, email verification, the 2FA verifies, passkey,
   * social ID-token, and the cross-site exchange - so a hardcoded path list
   * silently misses one, and a missed minting door is a 200 with a signed-out
   * user. This layer is also the only one that knows BOTH facts a door carries -
   * that it mints at all, and what the user answered about being remembered.
   * Only two of the eight can answer the second, and nothing below here can see
   * either.
   *
   * Pre-dispatch rather than on the response: `beginSession` in
   * `session-token.ts` owns which two facts that buys, and why each has to be
   * true before the request goes out rather than after it comes back.
   *
   * Absent means remembered: that is the server contract, and guessing the
   * other way would silently sign people out on every reload.
   */
  const beginSession = (params?: { rememberMe?: boolean }): Promise<void> => {
    return config.session.prepareSession({ remember: params?.rememberMe !== false });
  };

  return {
    sessionStore: session.store,
    getSession: session.getSession,
    account: createAccountClient(http, notifyMutation),
    organization: createOrganizationClient(
      http,
      notifyMutation,
      // Read the freshest membership off the live session snapshot so the pure
      // client `has()`/`hasPermission()` reflect the current active org.
      () => session.store.getSnapshot().data?.session.membership ?? null,
    ),
    privacy: createPrivacyClient(http),
    signIn: {
      email: async (params, fetchOptions) => {
        await beginSession(params);
        return sessionMutation<EmailAuthData | TwoFactorRedirectData>(
          post('/sign-in/email', params, fetchOptions, decodeEmailSignIn),
          (data) => !('twoFactorRedirect' in data),
        );
      },
      username: async (params, fetchOptions) => {
        await beginSession(params);
        return sessionMutation<EmailAuthData | TwoFactorRedirectData>(
          post('/sign-in/username', params, fetchOptions, decodeEmailSignIn),
          (data) => !('twoFactorRedirect' in data),
        );
      },
      social: async (params, fetchOptions) => {
        // Both variants: the ID-token one mints in place, and the redirect one
        // comes back through `/session/exchange`, which begins it again on the
        // return leg. Beginning here as well costs at most one measurement if
        // the user abandons the provider.
        await beginSession();
        // The cross-site transport. Posting `/sign-in/social` writes the OAuth
        // `state` cookie from THIS page's context, and the provider's callback
        // reads it from the auth host's - two different cookie contexts in every
        // browser that partitions or blocks third-party cookies, which is why
        // social sign-in fails there with `state_mismatch`. Navigating to the
        // first-party start instead writes it where the callback will read it.
        //
        // The ID-token variant mints a session in place with no redirect and no
        // state cookie, and `disableRedirect` means the caller wants the URL
        // rather than the navigation - neither has the problem, so both keep the
        // original path.
        if (redirectTransport(params) === 'first-party') {
          const { beginCrossSiteSignIn } = await import('./session-handoff');
          const url = await beginCrossSiteSignIn(config, {
            kind: 'social',
            provider: params.provider,
            callbackURL: params.callbackURL,
            errorCallbackURL: params.errorCallbackURL,
            newUserCallbackURL: params.newUserCallbackURL,
            scopes: params.scopes,
            loginHint: params.loginHint,
            requestSignUp: params.requestSignUp,
          });
          // `null` means the transport cannot serve this call (a destination on
          // another origin, which could not read the verifier). Fall through to
          // the original path rather than fail: it still works wherever it works
          // today.
          if (url) {
            window.location.assign(url);
            return { data: { redirect: true, url }, error: null };
          }
        }
        const result = await sessionMutation<SocialAuthData>(
          post(
            '/sign-in/social',
            params,
            fetchOptions,
            (value) => decodeSocialSignIn(value, allowHttpLoopback),
          ),
          (data) => 'user' in data,
        );
        if (result.error !== null || result.data === null) return result;

        if ('url' in result.data) {
          if (result.data.redirect && !params.disableRedirect && typeof window !== 'undefined') {
            window.location.assign(result.data.url);
          }
          return result;
        }
        return result;
      },
      sso: async (params, fetchOptions) => {
        // No `beginSession` here, and the type is why: `SsoAuthData` is
        // redirect-only, so this call cannot mint. The session is established on
        // the provider callback's fresh page and reaches this app through
        // `/session/exchange`, which begins it there.
        //
        // Same defect, same fix: OIDC SSO shares the engine's state handling, so
        // its callback reads a cookie this page's fetch could not write.
        if (redirectTransport(params) === 'first-party') {
          const { beginCrossSiteSignIn } = await import('./session-handoff');
          const url = await beginCrossSiteSignIn(config, {
            kind: 'sso',
            email: params.email,
            providerId: params.providerId,
            domain: params.domain,
            organizationSlug: params.organizationSlug,
            callbackURL: params.callbackURL,
            errorCallbackURL: params.errorCallbackURL,
            newUserCallbackURL: params.newUserCallbackURL,
          });
          if (url) {
            window.location.assign(url);
            return { data: { url, redirect: true as const }, error: null };
          }
        }
        const result = await post<SsoAuthData>(
          '/sign-in/sso',
          params,
          fetchOptions,
          (value) => decodeSsoSignIn(value, allowHttpLoopback),
        );
        if (result.error !== null || result.data === null) return result;

        // SSO is redirect-only: the session is minted on the provider callback's
        // fresh page, never in place - so there is no notifyMutation here.
        if (typeof window !== 'undefined') {
          window.location.assign(result.data.url);
        }
        return result;
      },
      magicLink: (params, fetchOptions) =>
        post<MagicLinkData>(
          '/sign-in/magic-link',
          params,
          fetchOptions,
          decodeMagicLink,
        ),
      emailOtp: async (params, fetchOptions) => {
        await beginSession();
        return sessionMutation<EmailOtpAuthData>(
          post('/sign-in/email-otp', params, fetchOptions, decodeEmailOtpSignIn),
        );
      },
      passkey: async (params, fetchOptions) => {
        // Before the ceremony, not after it: the WebAuthn prompt sits between
        // this call and `/passkey/verify-authentication`, and that verify is the
        // request that has to declare the transport.
        await beginSession();
        return passkeys.signIn(params, fetchOptions);
      },
    },
    signUp: {
      email: async (params, fetchOptions) => {
        await beginSession();
        return sessionMutation<EmailSignUpData>(
          post('/sign-up/email', params, fetchOptions, decodeEmailSignUp),
          (data) => data.sessionCreated,
        );
      },
    },
    emailOtp: {
      sendVerificationOtp: (params, fetchOptions) =>
        post<SendOtpData>(
          '/email-otp/send-verification-otp',
          params,
          fetchOptions,
          decodeSendOtp,
        ),
      // Verifying an email with an OTP signs the user in, so it mints like any
      // other door - including for a user who had no session before it.
      verifyEmail: async (params, fetchOptions) => {
        await beginSession();
        return sessionMutation<VerifyEmailOtpData>(
          post(
            '/email-otp/verify-email',
            params,
            fetchOptions,
            decodeVerifyEmailOtp,
          ),
        );
      },
    },
    phoneOtp: {
      prepare: (fetchOptions) =>
        post<PhoneOtpChallengeData>(
          '/phone-otp/challenge',
          {},
          fetchOptions,
          decodePhoneOtpChallenge,
        ),
      start: (params, fetchOptions) =>
        post<PhoneOtpStartData>(
          '/phone-otp/start',
          {
            ...params,
            idempotencyKey: params.idempotencyKey ?? createIdempotencyKey(),
          },
          fetchOptions,
          decodePhoneOtpStart,
        ),
      // `PhoneOtpVerifyData.sessionCreated` is `true` in the type: this door
      // always mints, so it always begins a session.
      verify: async (params, fetchOptions) => {
        await beginSession();
        return sessionMutation<PhoneOtpVerifyData>(
          post('/phone-otp/verify', params, fetchOptions, decodePhoneOtpVerify),
        );
      },
    },
    requestPasswordReset: (params, fetchOptions) =>
      post<PasswordResetData>(
        '/request-password-reset',
        params,
        fetchOptions,
        decodePasswordReset,
      ),
    resetPassword: (params, fetchOptions) =>
      post<PasswordResetData>(
        '/reset-password',
        params,
        fetchOptions,
        decodePasswordReset,
      ),
    sendVerificationEmail: (params, fetchOptions) =>
      post<VerificationEmailData>(
        '/send-verification-email',
        params,
        fetchOptions,
        decodeVerificationEmail,
      ),
    passkey: {
      addPasskey: (params, fetchOptions) => passkeys.add(params, fetchOptions),
      listUserPasskeys: () =>
        http.request<AuthPasskey[]>('/passkey/list-user-passkeys', {
          decode: decodePasskeys,
        }),
      updatePasskey: async (params, fetchOptions) => {
        const name = validatePasskeyName(params.name);
        if (!name.valid || name.value === undefined) {
          return invalidPasskeyName<UpdatePasskeyData>();
        }
        const normalizedName = name.value;
        return post<UpdatePasskeyData>(
          '/passkey/update-passkey',
          { ...params, name: normalizedName },
          fetchOptions,
          (value) => decodeUpdatedPasskey(value, params.id, normalizedName),
        );
      },
      deletePasskey: (params, fetchOptions) =>
        post<DeletePasskeyData>(
          '/passkey/delete-passkey',
          params,
          fetchOptions,
          decodeDeletedPasskey,
        ),
    },
    twoFactor: {
      enable: (params, fetchOptions) =>
        post<TwoFactorEnableData>(
          '/two-factor/enable',
          params,
          fetchOptions,
          decodeTwoFactorEnable,
        ),
      disable: (params, fetchOptions) =>
        sessionMutation<TwoFactorStatusData>(
          post(
            '/two-factor/disable',
            params,
            fetchOptions,
            decodeTwoFactorStatus,
          ),
          (data) => data.status,
        ),
      // No `beginSession` on this verify or the two below it, although all three
      // do mint.
      //
      // They CONTINUE a session begun at the credential sign-in that returned
      // `twoFactorRedirect`, and that call already began it with the user's
      // actual "remember me" answer. Beginning it again here would default that
      // answer back to "remembered" - a user who asked not to be remembered,
      // promoted to a durable session by the act of clearing their own 2FA
      // challenge.
      verifyTotp: (params, fetchOptions) =>
        sessionMutation<TwoFactorVerifyData>(
          post(
            '/two-factor/verify-totp',
            params,
            fetchOptions,
            decodeTwoFactorVerify,
          ),
        ),
      verifyBackupCode: (params, fetchOptions) =>
        sessionMutation<TwoFactorVerifyData>(
          post(
            '/two-factor/verify-backup-code',
            params,
            fetchOptions,
            decodeTwoFactorVerify,
          ),
        ),
      sendOtp: (params = {}, fetchOptions) =>
        post<SendTwoFactorOtpData>(
          '/two-factor/send-otp',
          params,
          fetchOptions,
          decodeSendTwoFactorOtp,
        ),
      verifyOtp: (params, fetchOptions) =>
        sessionMutation<TwoFactorVerifyData>(
          post(
            '/two-factor/verify-otp',
            params,
            fetchOptions,
            decodeTwoFactorVerify,
          ),
        ),
      generateBackupCodes: (params, fetchOptions) =>
        post<TwoFactorBackupCodesData>(
          '/two-factor/generate-backup-codes',
          params,
          fetchOptions,
          decodeTwoFactorBackupCodes,
        ),
    },
    signOut: (fetchOptions) =>
      sessionMutation<SignOutData>(
        http.request('/sign-out', {
          method: 'POST',
          body: {},
          fetchOptions,
          decode: decodeSignOut,
        }).then((result) => {
          // Drop the local token whatever the server said. A revoked session is
          // already dead, and a sign-out that FAILED still means this page should
          // stop presenting the credential - keeping it because the request
          // errored is how "sign out" becomes a lie on the one transport where
          // the browser is not clearing a cookie for us.
          //
          // Unconditional, with no generation: sign-out means "end whatever is
          // in play". It is also the ONLY ending a response states plainly.
          // Every other one is caught where the session read observes it, in
          // `session-store.ts`, which owns that list and why none of them can be
          // acted on from the response to the call that caused them.
          tokens.endSession();
          return result;
        }),
        (data) => data.success,
      ),
  };
}

/**
 * A native client whose host supplied a platform passkey ceremony.
 *
 * The passkey methods appear in the TYPE only when an adapter is passed, so an
 * app without one cannot call a ceremony that would fail at runtime.
 */
export type NativePasskeyCapableClient = Omit<NativeAuthClient, 'passkey' | 'signIn'> & {
  passkey: NativePasskeyClient & Pick<AuthActionClient['passkey'], 'addPasskey'>;
  signIn: NativeSignInClient & Pick<AuthActionClient['signIn'], 'passkey'>;
};

/** Build the runtime-native subset without leaving browser-only methods reachable. */
export function createNativeAuthClient(
  config: ResolvedAuthConfig,
  onSessionMutation?: () => void,
): NativeAuthClient;
export function createNativeAuthClient(
  config: ResolvedAuthConfig,
  onSessionMutation: (() => void) | undefined,
  createPasskeys: PasskeyCeremonyClientFactory,
): NativePasskeyCapableClient;
export function createNativeAuthClient(
  config: ResolvedAuthConfig,
  onSessionMutation: () => void = () => undefined,
  createPasskeys?: PasskeyCeremonyClientFactory,
): NativeAuthClient | NativePasskeyCapableClient {
  const client = createAuthActionClient(config, onSessionMutation, createPasskeys);

  // React Native has no `navigator.credentials`, but it does have platform
  // passkey APIs. When the host wires one up, the ceremony becomes reachable;
  // without one it stays absent rather than failing at the prompt.
  if (createPasskeys) {
    return {
      ...client,
      signIn: {
        email: client.signIn.email,
        username: client.signIn.username,
        social: nativeSocialSignIn(client),
        magicLink: client.signIn.magicLink,
        emailOtp: client.signIn.emailOtp,
        passkey: client.signIn.passkey,
      },
      passkey: {
        listUserPasskeys: client.passkey.listUserPasskeys,
        updatePasskey: client.passkey.updatePasskey,
        deletePasskey: client.passkey.deletePasskey,
        addPasskey: client.passkey.addPasskey,
      },
    };
  }

  return {
    ...client,
    signIn: {
      email: client.signIn.email,
      username: client.signIn.username,
      social: nativeSocialSignIn(client),
      magicLink: client.signIn.magicLink,
      emailOtp: client.signIn.emailOtp,
    },
    passkey: {
      listUserPasskeys: client.passkey.listUserPasskeys,
      updatePasskey: client.passkey.updatePasskey,
      deletePasskey: client.passkey.deletePasskey,
    },
  };
}

/** ID-token-only social sign-in, shared by both native client shapes. */
function nativeSocialSignIn(client: AuthActionClient): NativeSignInClient['social'] {
  return async (params, fetchOptions) => {
    if (
      !params?.idToken
      || typeof params.idToken.token !== 'string'
      || params.idToken.token === ''
    ) {
      return invalidNativeSocialRequest();
    }
    const result = await client.signIn.social(
      { ...params, disableRedirect: true },
      fetchOptions,
    );
    if (result.data !== null && 'url' in result.data) {
      return invalidNativeSocialResponse();
    }
    return result;
  };
}

function invalidNativeSocialRequest(): ReturnType<NativeSignInClient['social']> {
  return Promise.resolve({
    data: null,
    error: {
      status: 400,
      statusText: 'BAD_REQUEST',
      code: 'NATIVE_SOCIAL_ID_TOKEN_REQUIRED',
      message: 'Native social sign-in requires a provider ID token.',
    },
  });
}

function invalidNativeSocialResponse(): ReturnType<NativeSignInClient['social']> {
  return Promise.resolve({
    data: null,
    error: {
      status: 502,
      statusText: 'BAD_GATEWAY',
      code: 'INVALID_NATIVE_SOCIAL_RESPONSE',
      message: 'The server returned a redirect for native ID-token sign-in.',
    },
  });
}

function unavailablePasskeyClient(): PasskeyCeremonyClient {
  return {
    signIn: () => unavailablePasskeyCeremony(),
    add: () => unavailablePasskeyCeremony(),
  };
}

function unavailablePasskeyCeremony<T>(): Promise<AuthActionResult<T>> {
  return Promise.resolve({
    data: null,
    error: {
      status: 400,
      statusText: 'BAD_REQUEST',
      code: 'PASSKEY_BROWSER_REQUIRED',
      message: 'This passkey ceremony requires a browser with WebAuthn.',
    },
  });
}
