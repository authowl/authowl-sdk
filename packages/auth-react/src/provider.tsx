'use client';
import * as React from 'react';
import {
  createAuthOwlClient,
  directionFor,
  getPublicConfig,
  isLocale,
  resolveConfig,
  type AuthConfig,
  type AuthOwlClient,
  type Locale,
  type PublicConfig,
  type ResolvedAuthConfig,
} from '@authowl/core';
import { resolveAppearance } from './appearance';

// Dev-only, once-per-project warning for the silent config-failure fallback.
// When public-config can't be fetched, the drop-ins degrade to a password-only
// form regardless of the project's real methods (signin-methods.ts), which
// dead-ends if password sign-in isn't actually enabled. There was previously no
// signal at all. The `process.env.NODE_ENV` guard is inlined at the call site so
// consumer bundlers (Next/Vite/webpack) dead-code-eliminate this entirely from
// production - zero bytes, zero noise. The Set dedupes repeated mounts/retries.
const warnedConfigProjects = new Set<string>();
function warnPublicConfigFailed(resolved: ResolvedAuthConfig, error: unknown): void {
  let origin = resolved.apiUrl;
  try {
    origin = new URL(resolved.apiUrl).origin;
  } catch {
    /* apiUrl is validated upstream; fall back to the raw value defensively */
  }
  const key = `${origin}:${resolved.decoded.projectId}`;
  if (warnedConfigProjects.has(key)) return;
  warnedConfigProjects.add(key);
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(
    `[AuthOwl] Could not load this project's public config from ${origin} (${reason}). ` +
      'Falling back to a password-only sign-in form, regardless of the methods this ' +
      'project actually enabled. Likely causes: the API is unreachable, `apiUrl` is ' +
      'wrong, or the publishable key points at a missing/mismatched project. If password ' +
      'sign-in is not enabled for this project, the form will dead-end at submit - check ' +
      '`apiUrl` and `publishableKey` on <AuthOwlProvider>. (This warning is dev-only.)',
  );
}

export type Appearance = {
  theme?: 'light' | 'dark' | 'system';
  /** Primary accent color (CSS color). Falls back to project branding. */
  primaryColor?: string;
};

/** Loading state of the fetched public config. */
export type ConfigState = 'loading' | 'ready' | 'error';

type Ctx = {
  client: AuthOwlClient;
  appearance: Appearance | undefined;
  /** Project public config (methods, social providers, branding). */
  config: PublicConfig | null;
  configState: ConfigState;
  /** Resolved component locale (drives every t() call and the dir attribute). */
  locale: Locale;
};

const Context = React.createContext<Ctx | null>(null);

export type AuthOwlProviderProps = AuthConfig & {
  appearance?: Appearance;
  /**
   * Component locale. `'en' | 'ar'` forces it; `'auto'` detects from the host
   * page (`<html lang/dir>`, then `navigator.language`); omitted = the
   * project's default from public-config ('en' until the config loads).
   */
  locale?: Locale | 'auto';
  children: React.ReactNode;
};

/** Host-page locale detection for `locale="auto"`. SSR-safe ('en' on the server). */
function detectLocale(): Locale {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (root.lang?.toLowerCase().startsWith('ar') || root.dir === 'rtl') return 'ar';
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar')) {
    return 'ar';
  }
  return 'en';
}

/**
 * Locale precedence: explicit valid prop > 'auto' (host detection, resolved
 * post-mount - null until then) > the project's server default from
 * public-config > 'en'. Every input is isLocale-guarded: props often arrive
 * from plain JS or query strings (e.g. ?locale=fr), and an unsupported value
 * must fall through to the next source, never index a missing catalog.
 * Exported for tests.
 */
export function resolveLocale(
  prop: Locale | 'auto' | undefined,
  autoDetected: Locale | null,
  configLocale: string | undefined,
): Locale {
  if (prop !== 'auto' && isLocale(prop)) return prop;
  if (prop === 'auto') return autoDetected ?? 'en';
  return isLocale(configLocale) ? configLocale : 'en';
}

export function AuthOwlProvider({
  publishableKey,
  apiUrl,
  fetch,
  appearance,
  locale: localeProp,
  children,
}: AuthOwlProviderProps) {
  // Capture the optional `fetch` override in a ref so an inline `fetch` prop
  // (new identity every render) can't thrash the memo below - that would
  // recreate the client and refetch public-config on a loop. `fetch` is an
  // override set once in practice, so reading the latest at resolve time is fine.
  const fetchRef = React.useRef(fetch);
  fetchRef.current = fetch;

  // Resolution throws synchronously if the config is invalid - surface the
  // error eagerly during render rather than as silent network failures later.
  const resolved = React.useMemo(
    () => resolveConfig({ publishableKey, apiUrl, fetch: fetchRef.current }),
    [publishableKey, apiUrl],
  );
  const client = React.useMemo(() => createAuthOwlClient(resolved), [resolved]);

  const [config, setConfig] = React.useState<PublicConfig | null>(null);
  const [configState, setConfigState] = React.useState<ConfigState>('loading');

  // Fetch the project's public config once per resolved config. On failure the
  // components fall back to a sensible default (password), so a config hiccup
  // never bricks sign-in.
  React.useEffect(() => {
    let active = true;
    setConfigState('loading');
    getPublicConfig(resolved)
      .then((c) => {
        if (!active) return;
        setConfig(c);
        setConfigState('ready');
      })
      .catch((err: unknown) => {
        if (!active) return;
        setConfig(null);
        setConfigState('error');
        if (process.env.NODE_ENV !== 'production') warnPublicConfigFailed(resolved, err);
      });
    return () => {
      active = false;
    };
  }, [resolved]);

  const merged = resolveAppearance(appearance, config);

  // 'auto' resolves AFTER mount: document/navigator don't exist during SSR, so
  // resolving during render would hydrate 'en' markup against an 'ar' client
  // render (text + dir mismatch). First paint is 'en', then flips post-mount -
  // the same class of settle-in the config fetch already has.
  const [autoLocale, setAutoLocale] = React.useState<Locale | null>(null);
  React.useEffect(() => {
    if (localeProp === 'auto') setAutoLocale(detectLocale());
  }, [localeProp]);

  const locale = resolveLocale(localeProp, autoLocale, config?.locale);

  const ctxValue = React.useMemo<Ctx>(
    () => ({ client, appearance, config, configState, locale }),
    [client, appearance, config, configState, locale],
  );

  return (
    <Context.Provider value={ctxValue}>
      {/* display:contents keeps the wrapper out of layout while still scoping
          the theme custom-properties + data attribute to the subtree. The RAW
          theme goes in the attribute (light | dark | system) so it is identical
          on server and client - `system` is resolved by a CSS media query in
          styles.css, avoiding a hydration mismatch and a light->dark flash.
          `dir` works on a display:contents element too: directionality is an
          inherited property, independent of box generation. */}
      <div
        className="authowl-root"
        data-authowl-theme={merged.theme}
        // Not read by our CSS (RTL keys off [dir]) - a deliberate hook for
        // HOST stylesheets to target per-locale, like data-authowl-theme.
        data-authowl-locale={locale}
        dir={directionFor(locale)}
        style={{ display: 'contents', ...merged.style }}
      >
        {children}
      </div>
    </Context.Provider>
  );
}

export function useAuthOwlContext(): Ctx {
  const v = React.useContext(Context);
  if (!v) {
    throw new Error('AuthOwl hooks must be used inside <AuthOwlProvider>');
  }
  return v;
}
