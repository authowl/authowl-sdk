/** React context and hooks for a native AuthOwl app. */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createMembershipHas, type HasParams } from '@authowl/core/native';
import type { Locale } from '@authowl/core/i18n';
import type {
  AuthSession,
  AuthUser,
  NativeAuthClient,
  NativePasskeyCapableClient,
  NativeSocialSignInOptions,
  SessionState,
  SocialAuthData,
  AuthActionResult,
  PublicConfig,
  PrivacyClient,
} from '@authowl/core/native';

import { createAuthOwlNative, type AuthOwlNativeConfig } from './client';
import { signInWithSocialIdToken } from './oauth';

interface AuthOwlContextValue {
  client: NativeAuthClient | NativePasskeyCapableClient;
  projectId: string;
  locale: Locale;
  publicConfig: PublicConfig | null;
  publicConfigState: PublicConfigState;
}

export type PublicConfigState = 'loading' | 'ready' | 'error';

const AuthOwlContext = createContext<AuthOwlContextValue | null>(null);

export interface AuthOwlProviderProps extends AuthOwlNativeConfig {
  children?: ReactNode;
  /**
   * Locale for the built-in components. Defaults to English.
   *
   * Not auto-detected from the device: a phone set to Arabic does not imply the
   * app is localized to Arabic, and silently switching the auth screens away
   * from the rest of the app is worse than defaulting. Pass the locale the app
   * has already resolved.
   */
  locale?: Locale;
}

/** Provides the AuthOwl client to a native React tree. */
export function AuthOwlProvider(props: AuthOwlProviderProps): ReactNode {
  const {
    children,
    publishableKey,
    apiUrl,
    storage,
    fetchImpl,
    onSessionMutation,
    passkeys,
    locale = 'en',
  } = props;

  // Rebuild only when the identity-bearing configuration changes. Recreating the
  // client on every render would drop the in-flight session request and restart
  // it forever.
  const native = useMemo(() => {
    return createAuthOwlNative({
      publishableKey,
      apiUrl,
      storage,
      fetchImpl,
      onSessionMutation,
      passkeys,
    });
  }, [publishableKey, apiUrl, storage, fetchImpl, onSessionMutation, passkeys]);

  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [publicConfigState, setPublicConfigState] = useState<PublicConfigState>('loading');

  useEffect(() => {
    let active = true;
    setPublicConfig(null);
    setPublicConfigState('loading');
    native.getPublicConfig()
      .then((config) => {
        if (!active) return;
        setPublicConfig(config);
        setPublicConfigState('ready');
      })
      .catch(() => {
        if (!active) return;
        setPublicConfig(null);
        setPublicConfigState('error');
      });
    return () => {
      active = false;
    };
  }, [native]);

  const value = useMemo<AuthOwlContextValue>(() => ({
    client: native.client,
    projectId: native.projectId,
    locale,
    publicConfig,
    publicConfigState,
  }), [native, locale, publicConfig, publicConfigState]);

  return createElement(AuthOwlContext.Provider, { value }, children);
}

function useAuthOwlContext(): AuthOwlContextValue {
  const value = useContext(AuthOwlContext);
  if (value === null) {
    throw new Error('AuthOwl hooks must be used inside an <AuthOwlProvider>.');
  }
  return value;
}

/** The locale the provider resolved, for the built-in components. */
export function useAuthOwlLocale(): Locale {
  return useAuthOwlContext().locale;
}

/** Native-safe sign-in, account, organization, and passkey-management actions. */
export function useAuthOwlClient(): NativeAuthClient | NativePasskeyCapableClient {
  return useAuthOwlContext().client;
}

/** Project capabilities and legal policy used by the built-in components. */
export function usePublicConfig(): {
  data: PublicConfig | null;
  state: PublicConfigState;
  isLoading: boolean;
} {
  const { publicConfig, publicConfigState } = useAuthOwlContext();
  return {
    data: publicConfig,
    state: publicConfigState,
    isLoading: publicConfigState === 'loading',
  };
}

/** Typed consent preferences and data-rights actions for the signed-in user. */
export function usePrivacy(): PrivacyClient {
  return useAuthOwlContext().client.privacy;
}

/** The live session state, re-rendering whenever the session changes. */
export function useSession(): SessionState {
  const { client } = useAuthOwlContext();
  const store = client.sessionStore;
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );
}

export interface UseAuthResult {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: AuthUser | null;
  session: AuthSession | null;
  signOut: () => Promise<void>;
  /**
   * Advisory permission check over the CURRENT session claim.
   *
   * Advisory only: this is for hiding UI the user cannot use. The real boundary
   * is server-side, over a verified token - never gate anything that matters on
   * a client-side answer.
   */
  has: (params: HasParams) => boolean;
  hasPermission: (params: { permission: string }) => boolean;
}

/** The primary hook: who is signed in, and what may they do. */
export function useAuth(): UseAuthResult {
  const { client } = useAuthOwlContext();
  const state = useSession();
  const membership = state.data?.session.membership ?? null;
  const { has, hasPermission } = useMemo(
    () => createMembershipHas(membership),
    [membership],
  );

  return {
    isLoaded: !state.isPending,
    isSignedIn: state.data !== null,
    user: state.data?.user ?? null,
    session: state.data?.session ?? null,
    signOut: async () => {
      await client.signOut();
    },
    has,
    hasPermission,
  };
}

/** The signed-in user, or null. */
export function useUser(): AuthUser | null {
  return useSession().data?.user ?? null;
}

/** Exchange an ID token from a provider's native SDK for an AuthOwl session. */
export function useSocialSignIn(): (
  options: NativeSocialSignInOptions,
) => Promise<AuthActionResult<SocialAuthData>> {
  const { client } = useAuthOwlContext();
  return useCallback(
    (options) => signInWithSocialIdToken(client, options),
    [client],
  );
}
