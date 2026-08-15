import type { ResolvedAuthConfig } from './config';
import { requestPublishableJson, requireOk } from './http';
import { asRecord, asString } from './response-schema';

/**
 * Short-lived JWTs for third-party backends (Convex, Supabase, Hasura - server
 * contract CONTRACTS §8, `GET <issuer>/token`). The server signs a ~15-minute
 * ES256 token for the signed-in user; verifiers check it statelessly against
 * the project's published JWKS.
 *
 * Contract (recorded from the convex@1.42.1 source, evidence 17-B.9):
 *  - `forceRefresh: true` MUST bypass only the selected template cache and hit
 *    the network. A stale token served to a verifier retry is a hard failure
 *    loop.
 *  - Tokens are cached in MEMORY ONLY (never localStorage - PLAN.md security
 *    model), and served only while comfortably inside their `exp`. Named cache
 *    keys include the client environment, token subject, active organization,
 *    normalized template name, and server template policy version. The client
 *    wrapper clears all entries when the auth identity changes.
 *  - "Not signed in" (401) resolves to `null`; other failures throw (adapters
 *    map them to null per Convex's error contract).
 */
export type GetTokenOptions = {
  /** Named JWT template configured for this environment. */
  template?: string;
  /** Bypass the in-memory cache and mint a fresh token from the server. */
  forceRefresh?: boolean;
};

export type GetToken = (options?: GetTokenOptions) => Promise<string | null>;

export type TokenClient = {
  getToken: GetToken;
  /** Drop the cached token (call on any auth-identity change, e.g. sign-out). */
  clear: () => void;
};

/** Don't serve a cached token within this window of its expiry. */
const EXPIRY_LEEWAY_SECONDS = 30;
type CachedToken = { token: string; exp: number };
type JwtClaims = { exp?: unknown; sub?: unknown; org_id?: unknown };
type SelectorState = {
  activeKey: string | null;
  cachedByKey: Map<string, CachedToken>;
  inflight: Promise<string | null> | null;
  sequence: number;
};

/**
 * Decode the `exp` claim (unix seconds) from a JWT without verifying it - the
 * client only needs it for cache freshness; verification is the backend's job.
 * Returns null for anything that doesn't parse as a JWT with a numeric exp.
 */
export function decodeJwtExpiry(token: string): number | null {
  return claimExpiry(decodeJwtClaims(token));
}

function claimExpiry(claims: JwtClaims | null): number | null {
  // JSON numbers are finite by grammar, so a numeric parsed claim is enough.
  return typeof claims?.exp === 'number' ? claims.exp : null;
}

function decodeJwtClaims(token: string): JwtClaims | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64)) as unknown;
    return typeof claims === 'object' && claims !== null ? claims as JwtClaims : null;
  } catch {
    return null;
  }
}

/**
 * Build a token client bound to one config. `getToken` is cheap to call
 * repeatedly: fresh cached tokens return without a request, and concurrent
 * non-forced calls share one in-flight request.
 */
export function createTokenClient(config: ResolvedAuthConfig): TokenClient {
  const states = new Map<string, SelectorState>();

  async function getToken(options: GetTokenOptions = {}): Promise<string | null> {
    const template = options.template === undefined
      ? null
      : options.template.trim().toLowerCase();
    if (template === '') throw new TypeError('Template missing');
    // Empty is impossible for a named template, so it safely identifies the
    // backward-compatible unnamed token without colliding with `default`.
    const selector = template ?? '';
    let state = states.get(selector);
    if (!state) {
      state = {
        activeKey: null,
        cachedByKey: new Map(),
        inflight: null,
        sequence: 0,
      };
      states.set(selector, state);
    }
    const force = options.forceRefresh === true;
    if (!force) {
      const cached = state.activeKey ? state.cachedByKey.get(state.activeKey) : null;
      if (cached && cached.exp - Date.now() / 1000 > EXPIRY_LEEWAY_SECONDS) {
        return cached.token;
      }
      if (state.inflight) return state.inflight;
    }

    const myMint = ++state.sequence;
    const mayWrite = () => states.get(selector) === state && state.sequence === myMint;
    const request = (async () => {
      const endpoint = template
        ? `${config.projectBaseURL}/token/${encodeURIComponent(template)}`
        : `${config.projectBaseURL}/token`;
      const result = await requestPublishableJson(config, endpoint, {
        init: {
          method: 'GET',
          credentials: 'include',
        },
        maxResponseBytes: 64 * 1024,
        decode: (value) => decodeTokenResponse(value, template !== null),
      });
      if (result.response.status === 401) {
        // No session: signed out is a state, not an error.
        if (mayWrite()) clearAll();
        return null;
      }
      const body = requireOk(result, 'token');
      const policyVersion = body.policyVersion;
      const token = body.token;
      const claims = decodeJwtClaims(token);
      const exp = claimExpiry(claims);
      // Only cache what we can expire; an undecodable token is still returned
      // (the verifier decides its fate) but never served stale from cache.
      if (mayWrite()) {
        if (exp !== null) {
          const subject = typeof claims?.sub === 'string' ? claims.sub : null;
          const organization = typeof claims?.org_id === 'string' ? claims.org_id : null;
          // Named server tokens always carry a subject. Without one, return the
          // response to its caller but do not let it enter an identity cache.
          if (!template || subject) {
            const cacheKey = JSON.stringify([
              config.projectBaseURL,
              subject,
              organization,
              template,
              policyVersion,
            ]);
            state.cachedByKey.clear();
            state.cachedByKey.set(cacheKey, { token, exp });
            state.activeKey = cacheKey;
          } else {
            clearState(state);
          }
        } else {
          clearState(state);
        }
      }
      return token;
    })();

    // A forced mint still refreshes the shared cache (inside the request body)
    // but is never registered as the shared in-flight request - "must hit the
    // network" shouldn't be dilutable by later callers piling onto it.
    if (force) return request;

    const tracked = request.finally(() => {
      if (state.inflight === tracked) state.inflight = null;
    });
    state.inflight = tracked;
    return tracked;
  }

  function clearAll(): void {
    // Clearing the state map drops cached and in-flight entries together. Old
    // closures retain only orphaned state and fail the state-identity check.
    states.clear();
  }

  function clearState(state: SelectorState): void {
    state.cachedByKey.clear();
    state.activeKey = null;
  }

  return {
    getToken,
    clear: clearAll,
  };
}

function decodeTokenResponse(
  value: unknown,
  named: boolean,
): { token: string; policyVersion: number } {
  const row = asRecord(value);
  const token = asString(row.token);
  if (token.length === 0 || token.length > 32 * 1024) {
    throw new TypeError('Invalid token response.');
  }
  if (!named) return { token, policyVersion: 0 };
  const template = asRecord(row.template);
  if (
    !Number.isSafeInteger(template.policyVersion)
    || (template.policyVersion as number) < 1
  ) {
    throw new TypeError('Invalid token response.');
  }
  return {
    token,
    policyVersion: template.policyVersion as number,
  };
}
