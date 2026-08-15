import { decodePublishableKey, type DecodedPublishableKey } from './key-decode';
import { canonicalApiOrigin } from './url-policy';
import {
  createSessionTransport,
  type SessionBinding,
} from './session-transport';
import type { TransportFetch } from './transport';

export type AuthConfig = {
  publishableKey: string;
  apiUrl: string;
  /** Optional fetch override (e.g. for testing). */
  fetch?: typeof fetch;
};

export type ResolvedAuthConfig = Omit<AuthConfig, 'fetch'> & {
  decoded: DecodedPublishableKey;
  /** Fully-resolved base URL pointing at the per-project auth endpoint. */
  projectBaseURL: string;
  /**
   * THE fetch for this project - the caller's, wrapped in the session transport.
   *
   * Required rather than optional, and branded, so that `config.fetch ?? fetch`
   * cannot be written at all. See `TransportFetch` in `transport.ts` for what
   * the brand buys and which bug it closes.
   */
  fetch: TransportFetch;
  /**
   * The session itself, resolved here because this function is the only producer
   * of the fetch that carries it. Nothing else has to find the store by id, and
   * no request boundary has to grow a "but not this one" flag to reach the
   * detached fetch.
   *
   * A BROWSER SIGN-IN FLOW MUST GO THROUGH A CONSTRUCTED CLIENT, not through
   * `config.fetch` directly. Resolving a config builds the token store, but the
   * thing that SETTLES its cookie verdict is registered by the session
   * controller a client builds - so a hand-rolled integration that drives sign-in
   * off this fetch captures a token nothing will ever measure. The token is then
   * held in memory and never written, and the session dies at the next reload on
   * exactly the browsers this transport exists for. Every shipped surface
   * (`createAuthOwlClient`, the native client, the React provider) builds one;
   * this note is for anyone reaching below them. Moving the measurement onto
   * this binding is the queued fix that removes the hazard rather than
   * documenting it.
   */
  session: SessionBinding;
};

export type ResolvedAuthTarget = Readonly<{
  publishableKey: string;
  apiUrl: string;
  decoded: DecodedPublishableKey;
  projectBaseURL: string;
}>;

/** Resolve the shared, side-effect-free project endpoint contract. */
export function resolveAuthTarget(
  input: Pick<AuthConfig, 'publishableKey' | 'apiUrl'>,
): ResolvedAuthTarget {
  if (!input || typeof input !== 'object') {
    throw new Error('AuthConfig is required');
  }
  const decoded = decodePublishableKey(input.publishableKey);
  const apiUrl = canonicalApiOrigin(input.apiUrl, {
    allowHttpLoopback: decoded.env === 'test',
  });
  return {
    publishableKey: input.publishableKey,
    apiUrl,
    decoded,
    projectBaseURL: `${apiUrl}/api/projects/${decoded.projectId}/auth`,
  };
}

export function resolveConfig(input: AuthConfig): ResolvedAuthConfig {
  const target = resolveAuthTarget(input);
  // The host's fetch goes IN and is not reachable again: resolving a config is
  // the one moment the SDK gets to decide what every later request runs on.
  const { fetch: sessionFetch, ...session } = createSessionTransport(
    target.decoded.projectId,
    input.fetch,
  );
  return {
    ...input,
    ...target,
    fetch: sessionFetch,
    session,
  };
}
