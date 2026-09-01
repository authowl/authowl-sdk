/**
 * The session, attached to a request and harvested off a response, in ONE place.
 *
 * BOTH CARGOES, NO SECOND WIRE. The sign-in challenge - the `two_factor` ticket
 * and the `dont_remember` flag - travels on this same transport, and it needed
 * not one line here: `declareOn` and `observe` below each carry both, so a
 * request that gets the session gets the challenge by construction. That is
 * deliberate rather than incidental. Wiring the challenge at the call sites that
 * know about 2FA is precisely the bug class this file exists to make
 * unrepresentable - a door that gets one cargo and not the other - and the
 * server's own ingress is built the same way for the same reason
 * (`bearerTransportHeaders` does both translations in one function, and the
 * headers it returns are obtainable nowhere else, so no door can opt into the
 * session half and forget the challenge half). See `session-challenge.ts`.
 *
 * WHY THIS IS A `fetch` DECORATOR AND NOT A STEP IN A CLIENT
 *
 * Because this SDK used to reach the network through two independent doors and
 * the first version of this transport wired one and missed the other. See
 * `TransportFetch` in `transport.ts`, which owns that incident and the guard it
 * produced.
 *
 * The doors have since been collapsed into one (`requestPublishableJson`), but
 * the session does not ride THAT, because a door is a thing somebody can add.
 * It rides the `fetch`, which no door can make a request without, and the brand
 * on `TransportFetch` makes an undecorated one refuse to typecheck at the one
 * boundary every request passes through. A deliberate opt-out still compiles and
 * is meant to; what the brand removes is the SILENT version, where a client
 * somebody added simply never carries the session and nothing anywhere says so.
 *
 * `resolveConfig` is the single producer: `config.fetch` is ALWAYS the decorated
 * fetch, wrapped around the host's if one was supplied. There is no undecorated
 * fetch left on a resolved config to reach for by mistake.
 */
import { sessionTokenStore, type SessionTokenStore } from './session-token';
import type { SessionStart } from './session-token';
import type { SessionProofKey } from './session-proof-client';
import type { TransportFetch } from './transport';

const SESSION_PROOF_HEADER = 'x-authowl-session-proof';
const SESSION_BINDING_HEADER = 'x-authowl-session-binding';
const SESSION_BINDING_PROOF_HEADER = 'x-authowl-session-binding-proof';
const proofClient = () => import('./session-proof-client');

/**
 * Everything about this project's session that is NOT the ordinary fetch.
 *
 * Handed to the session controller directly rather than looked up from a project
 * id. The controller used to take that id and use it as BOTH the token store's
 * key and a BroadcastChannel name, which is only correct while the two strings
 * are the same string: pass a channel name and the controller silently measures
 * a private, permanently empty store. Two facts, two parameters.
 */
export type SessionBinding = {
  /**
   * The same transport with the session deliberately DETACHED - no token, no
   * challenge, no declaration, cookies only.
   *
   * Exactly one caller: the probe that measures whether this browser keeps our
   * cross-site cookie. Every other request attaches the token when we hold one,
   * which would make a session read succeed whether or not the cookie survived,
   * and the SDK would never learn the difference.
   */
  readonly probe: TransportFetch;
  /** The store the fetch above attaches from, and the lifecycle the doors drive. */
  readonly tokens: SessionTokenStore;
  /** Decide cookie-only or sender-bound bearer transport before a session mint. */
  prepareSession(start: SessionStart): Promise<void>;
};

export type SessionTransport = SessionBinding & {
  /** THE fetch for this project. */
  readonly fetch: TransportFetch;
};

/**
 * The headers this request will be sent with, starting from whatever the caller
 * already set.
 *
 * Always a COPY. `config.fetch` is public API (`ResolvedAuthConfig`), so a host
 * may hand it a long-lived `Headers` or a `Request` and reuse it; writing the
 * declaration into that object would leave the caller holding a token they never
 * asked for, and replay it after a sign-out has cleared ours.
 */
function inheritedHeaders(input: RequestInfo | URL, init: RequestInit | undefined): Headers {
  if (init?.headers) return new Headers(init.headers);
  if (typeof input === 'object' && input !== null && 'headers' in input) {
    return new Headers((input as Request).headers);
  }
  return new Headers();
}

/**
 * Build the fetch every project request in this SDK goes through, plus the two
 * things that only the session controller needs.
 *
 * `provided` is the host's own fetch - React Native's cookie jar, a test double.
 * It is resolved at CALL time, not here, so a runtime whose global `fetch`
 * arrives after configuration still works.
 */
export function createSessionTransport(
  target: {
    projectId: string;
    projectBaseURL: string;
    publishableKey: string;
  },
  provided?: typeof fetch,
): SessionTransport {
  const tokens = sessionTokenStore(target.projectId);
  const base = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    (provided ?? globalThis.fetch)(input, init);
  const clientOrigin = typeof globalThis.location === 'object'
    && typeof globalThis.location.origin === 'string'
    && globalThis.location.origin !== 'null'
    ? globalThis.location.origin
    : null;
  let pendingBinding: { key: SessionProofKey; nonce: string } | null = null;
  let pendingCookieOnly = false;

  const projectHeaders = (): Headers => new Headers({
    'x-publishable-key': target.publishableKey,
  });

  async function abandon(headers: Headers): Promise<void> {
    const authorization = headers.get('authorization');
    if (!authorization) return;
    await proofClient().then((proof) => proof.abandonSession(
      base,
      `${target.projectBaseURL}/session/abandon`,
      projectHeaders(),
      authorization,
    ));
  }

  async function prepareSession(start: SessionStart): Promise<void> {
    pendingBinding = null;
    pendingCookieOnly = false;
    const prepared = await proofClient().then((proof) => proof.prepareSenderConstrainedSession({
      tokens,
      start,
      clientOrigin,
      fetcher: base,
      projectBaseURL: target.projectBaseURL,
      headers: projectHeaders(),
    }));
    pendingBinding = prepared.binding;
    pendingCookieOnly = prepared.cookieOnly;
  }

  // Branded straight off `base`: "session detached" IS the undecorated fetch.
  const probe = base as TransportFetch;

  const withSession = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    // `credentials: 'omit'` is the caller stating this request carries no
    // credential at all - public config, the waitlist. The token and the cookie
    // are two spellings of the same session, so they have to be withheld
    // together; attaching one to a request that deliberately drops the other
    // would make the two transports mean different things, which is the single
    // invariant this whole feature rests on.
    if (init?.credentials === 'omit') return base(input, init);
    // Cookies proven to work here: `declareOn` would add nothing and no response
    // can carry either cargo back, so skip copying headers this branch cannot
    // change. That is the steady state for every Chrome and Firefox user, on
    // every request they ever make - until the next sign-in re-arms the
    // measurement. The challenge needs no exception: this browser keeps the
    // ticket in its jar, where it is HttpOnly and strictly safer than a header.
    if (!tokens.wantsToken()) return base(input, init);

    const headers = inheritedHeaders(input, init);
    const declared = tokens.declareOn(headers);
    const authorization = headers.get('authorization');
    const method = (init?.method
      ?? (typeof input === 'object' && input !== null && 'method' in input
        ? (input as Request).method
        : 'GET')).toUpperCase();
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (declared && clientOrigin) {
      let carriesAuthorization = Boolean(authorization);
      if (authorization) {
        const token = authorization.replace(/^Bearer\s+/i, '');
        const expected = tokens.bindingThumbprint();
        if (expected) {
          try {
            headers.set(SESSION_PROOF_HEADER, await proofClient().then(
              (proof) => proof.createStoredSessionProof({
                origin: clientOrigin,
                expectedThumbprint: expected,
                method,
                url,
                token,
              }),
            ));
          } catch {
            await abandon(headers);
            tokens.endSession();
            headers.delete('authorization');
            headers.delete(SESSION_PROOF_HEADER);
            headers.delete(SESSION_BINDING_HEADER);
            headers.delete(SESSION_BINDING_PROOF_HEADER);
            carriesAuthorization = false;
          }
        }
      }
      if (pendingBinding) {
        const binding = pendingBinding;
        headers.set(SESSION_BINDING_HEADER, binding.nonce);
        headers.set(
          carriesAuthorization ? SESSION_BINDING_PROOF_HEADER : SESSION_PROOF_HEADER,
          await proofClient().then(
            (proof) => proof.createSessionProof({
              key: binding.key,
              method,
              url,
              token: binding.nonce,
            }),
          ),
        );
      }
    }
    const response = await base(input, { ...init, headers });
    // Only a declared request can be answered with a token or a challenge, and
    // only a declared request should be trusted to hand us either.
    if (declared) {
      const recoveryResponse = response.status === 401
        && authorization
        && (
          new URL(url).pathname.endsWith('/get-session')
          || new URL(url).pathname.endsWith('/sign-out')
        );
      if (recoveryResponse) {
        await abandon(headers);
        tokens.endSession();
        pendingBinding = null;
        pendingCookieOnly = false;
      } else {
        tokens.observe(response.headers);
        if (response.headers.has('set-auth-token')) {
          if (pendingCookieOnly) tokens.completeCookieTransport();
          pendingBinding = null;
          pendingCookieOnly = false;
        }
      }
    }
    return response;
  };

  // The brand is minted here and nowhere else outside `withoutSessionTransport`,
  // in the module whose whole subject is what it means. See `TransportFetch`.
  return { fetch: withSession as TransportFetch, probe, tokens, prepareSession };
}
